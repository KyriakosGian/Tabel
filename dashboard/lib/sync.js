/**
 * Tabel - Sync Engine
 * Syncs tab groups and items across devices via chrome.storage.sync
 * (which is backed by the user's own Google account).
 *
 * chrome.storage.sync constraints we work around:
 *   - QUOTA_BYTES_PER_ITEM = 8,192 bytes  → chunks use at most 8,000 bytes
 *   - QUOTA_BYTES (total)   = 102,400 bytes
 *   - MAX_ITEMS             = 512 keys
 *
 * Merge is non-destructive (union of local + remote, newest wins per id),
 * so concurrent edits on multiple devices converge instead of clobbering.
 */

import { db } from './db.js';
import {
  getPrunableTombstoneKeys,
  maxDeletedAt
} from './tombstoneCleanup.js';

const SYNC_META_KEY = 'tabel_sync_meta';
const CHUNK_PREFIX  = 'tabel_sync_chunk_';
const DEVICE_ID_KEY = 'tabelDeviceId';
export const DEVICE_STATE_PREFIX = 'tabel_sync_device_';
export const SYNC_STATUS_KEY = 'tabelSyncStatus';

// Include the storage key and JSON escaping in the UTF-8 byte budget.
const MAX_CHUNK_BYTES = 8000;
const PUSH_DEBOUNCE_MS = 2000;
const DEVICE_HEARTBEAT_MS = 24 * 60 * 60 * 1000;
// Coalesce bursts of remote change events (e.g. chunks arriving separately over a
// slow/VPN connection) into a single pull instead of one pull per event.
const PULL_DEBOUNCE_MS = 400;

export class SyncManager {
  /**
   * @param {Object} callbacks
   *   onRemoteUpdate(mergeResult) — called after remote data is merged in
   *   onError(messageKey)         — called on quota/other failures
   */
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.deviceId = null;
    this._pushTimer = null;
    this._pullTimer = null;
    this._operations = Promise.resolve();
  }

  /** Set up the device id, do an initial pull, and listen for remote changes. */
  async init() {
    this.deviceId = await this._getDeviceId();

    const hadRemote = await this.pull();
    if (!hadRemote) {
      const remote = await chrome.storage.sync.get(SYNC_META_KEY);
      // Cloud is empty — seed it with whatever we have locally.
      const data = await db.exportAll();
      if (
        !remote[SYNC_META_KEY] && (
          data.groups.length > 0 ||
          data.items.length > 0 ||
          data.tombstones.length > 0
        )
      ) {
        this.schedulePush();
      }
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      // Ignore the echo of our own writes (our pushes always include meta with our id).
      const meta = changes[SYNC_META_KEY]?.newValue;
      if (meta && meta.deviceId === this.deviceId) return;
      // React to remote writes to either the meta key or any data chunk — chunks can
      // arrive in a later event than the meta, so we must not key off meta alone.
      const touchesSync = changes[SYNC_META_KEY] ||
        Object.keys(changes).some(k => k.startsWith(CHUNK_PREFIX));
      if (touchesSync) this.schedulePull();
    });
  }

  /** Debounced push — call after any local mutation. */
  schedulePush() {
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.push(), PUSH_DEBOUNCE_MS);
  }

  /** Push immediately without pulling first. Used by import and delete-all actions. */
  async pushNow() {
    clearTimeout(this._pushTimer);
    if (!this.deviceId) this.deviceId = await this._getDeviceId();
    return this.push();
  }

  /** Debounced pull — coalesces a burst of remote change events into one merge. */
  schedulePull() {
    clearTimeout(this._pullTimer);
    this._pullTimer = setTimeout(() => this.pull(), PULL_DEBOUNCE_MS);
  }

  /** Serialize local data, chunk it, and write it to chrome.storage.sync. */
  push() {
    return this._enqueue(() => this._push());
  }

  _enqueue(operation) {
    const run = () => globalThis.navigator?.locks
      ? navigator.locks.request('tabel-sync', operation)
      : operation();
    const pending = this._operations.then(run, run);
    this._operations = pending.catch(() => {});
    return pending;
  }

  async _push() {
    try {
      const existing = await chrome.storage.sync.get(null);
      const data = await db.exportAll();
      const now = Date.now();
      const currentDeviceState = this._currentDeviceState(existing, data.tombstones, now);
      const {
        states: knownDeviceStates,
        placeholderWrites
      } = this._collectDeviceStates(existing, currentDeviceState);
      const prunableKeys = getPrunableTombstoneKeys(
        data.tombstones,
        knownDeviceStates,
        { now }
      );
      const prunableSet = new Set(prunableKeys);
      const retainedTombstones = data.tombstones.filter(
        tombstone => !prunableSet.has(tombstone.key)
      );
      const payload = JSON.stringify({
        groups: data.groups,
        items: data.items,
        tombstones: retainedTombstones
      });
      const chunks = this._chunk(payload);

      const writeObj = { [SYNC_META_KEY]: {
        deviceId: this.deviceId,
        updatedAt: now,
        chunkCount: chunks.length,
        version: data.version
      } };
      chunks.forEach((c, i) => { writeObj[CHUNK_PREFIX + i] = c; });
      writeObj[this._deviceStateKey(this.deviceId)] = currentDeviceState;
      Object.assign(writeObj, placeholderWrites);

      // Identify stale chunk keys left over from a previous, larger payload.
      const staleKeys = Object.keys(existing).filter(k =>
        k.startsWith(CHUNK_PREFIX) &&
        parseInt(k.slice(CHUNK_PREFIX.length), 10) >= chunks.length
      );

      await chrome.storage.sync.set(writeObj);

      // Save the compacted cloud snapshot before removing local tombstones.
      // A local cleanup failure can only delay cleanup.
      if (prunableKeys.length > 0) {
        try {
          await db.deleteTombstones(prunableKeys);
        } catch (cleanupError) {
          console.warn('[Sync] Local tombstone cleanup failed:', cleanupError);
        }
      }

      if (staleKeys.length) await chrome.storage.sync.remove(staleKeys);
      await this._recordSuccess('push', now);
      return true;
    } catch (e) {
      console.error('[Sync] Push failed:', e);
      // Most likely the total sync quota was exceeded.
      this.callbacks.onError?.('syncQuotaError');
      return false;
    }
  }

  /**
   * Read remote chunks, reassemble, and merge into the local DB.
   * @returns {boolean} true if remote data existed and was applied.
   */
  pull() {
    return this._enqueue(() => this._pull());
  }

  async _pull() {
    try {
      const all = await chrome.storage.sync.get(null);
      const meta = all[SYNC_META_KEY];
      if (!meta) return false;
      if (!Number.isInteger(meta.chunkCount) || meta.chunkCount < 1 || meta.chunkCount > 512) {
        throw new Error('Invalid sync metadata');
      }

      let payload = '';
      for (let i = 0; i < meta.chunkCount; i++) {
        const part = all[CHUNK_PREFIX + i];
        if (typeof part !== 'string') {
          // A chunk is still propagating — bail and retry on the next change event.
          console.warn('[Sync] Missing chunk', i, '— skipping this pull');
          return false;
        }
        payload += part;
      }

      const remoteData = JSON.parse(payload);

      const result = await db.mergeAll(remoteData);

      const localData = await db.exportAll();
      const now = Date.now();
      const currentDeviceState = this._currentDeviceState(all, localData.tombstones, now);
      const {
        states: knownDeviceStates,
        placeholderWrites
      } = this._collectDeviceStates(all, currentDeviceState);
      const stateWrites = { ...placeholderWrites };
      const previousState = all[this._deviceStateKey(this.deviceId)];
      if (this._shouldWriteDeviceState(previousState, currentDeviceState, now)) {
        stateWrites[this._deviceStateKey(this.deviceId)] = currentDeviceState;
      }
      if (Object.keys(stateWrites).length > 0) {
        try {
          await chrome.storage.sync.set(stateWrites);
        } catch (stateError) {
          console.warn('[Sync] Device acknowledgement failed:', stateError);
        }
      }

      // Push performs the cleanup so the compacted cloud snapshot is durable
      // before any local tombstone is removed.
      const hasPrunableTombstones = getPrunableTombstoneKeys(
        localData.tombstones,
        knownDeviceStates,
        { now }
      ).length > 0;

      // Only re-render when the merge actually brought in remote changes — avoids
      // needless redraws when a pull turns out to be identical to local data.
      if (result.remoteOnlyCount > 0 || result.updatedCount > 0) {
        this.callbacks.onRemoteUpdate?.(result);
      }

      // We hold data the cloud doesn't have yet → push it so other devices receive it.
      if (result.localOnlyCount > 0 || hasPrunableTombstones) this.schedulePush();

      await this._recordSuccess('pull', now);
      return true;
    } catch (e) {
      console.error('[Sync] Pull failed:', e);
      return false;
    }
  }

  /** Split a string into chunks small enough for the per-item quota. */
  _chunk(str) {
    const encoder = new TextEncoder();
    const chunks = [];
    let chunk = '';
    let bytes = encoder.encode(CHUNK_PREFIX + '0').length + 2;
    for (const character of str) {
      const size = encoder.encode(JSON.stringify(character)).length - 2;
      if (bytes + size > MAX_CHUNK_BYTES) {
        chunks.push(chunk);
        chunk = '';
        bytes = encoder.encode(CHUNK_PREFIX + chunks.length).length + 2;
      }
      chunk += character;
      bytes += size;
    }
    if (chunk || !chunks.length) chunks.push(chunk);
    return chunks;
  }

  _deviceStateKey(deviceId) {
    return `${DEVICE_STATE_PREFIX}${deviceId}`;
  }

  _currentDeviceState(all, tombstones, now) {
    const previous = all[this._deviceStateKey(this.deviceId)];
    return {
      deviceId: this.deviceId,
      lastSeenAt: now,
      acknowledgedThrough: Math.max(
        Number(previous?.acknowledgedThrough) || 0,
        maxDeletedAt(tombstones)
      )
    };
  }

  _collectDeviceStates(all, currentDeviceState) {
    const states = new Map();
    const placeholderWrites = {};

    for (const [key, value] of Object.entries(all)) {
      if (
        key.startsWith(DEVICE_STATE_PREFIX) &&
        typeof value?.deviceId === 'string' &&
        value.deviceId
      ) {
        states.set(value.deviceId, value);
      }
    }

    // Legacy versions exposed only the last writer's id in sync metadata.
    // Preserve that device as unacknowledged until it upgrades and confirms
    // the tombstones it has received.
    const legacyDeviceId = all[SYNC_META_KEY]?.deviceId;
    if (
      typeof legacyDeviceId === 'string' &&
      legacyDeviceId &&
      legacyDeviceId !== this.deviceId &&
      !states.has(legacyDeviceId)
    ) {
      const placeholder = {
        deviceId: legacyDeviceId,
        lastSeenAt: Number(all[SYNC_META_KEY]?.updatedAt) || 0,
        acknowledgedThrough: 0,
        legacy: true
      };
      states.set(legacyDeviceId, placeholder);
      placeholderWrites[this._deviceStateKey(legacyDeviceId)] = placeholder;
    }

    states.set(this.deviceId, currentDeviceState);
    return {
      states: [...states.values()],
      placeholderWrites
    };
  }

  _shouldWriteDeviceState(previous, current, now) {
    if (!previous) return true;
    if (
      Number(current.acknowledgedThrough) >
      (Number(previous.acknowledgedThrough) || 0)
    ) {
      return true;
    }
    return now - (Number(previous.lastSeenAt) || 0) >= DEVICE_HEARTBEAT_MS;
  }

  async _recordSuccess(operation, timestamp = Date.now()) {
    if (!chrome.storage?.local?.set) return;
    try {
      await chrome.storage.local.set({
        [SYNC_STATUS_KEY]: {
          lastSuccessfulSyncAt: timestamp,
          operation
        }
      });
    } catch (error) {
      console.warn('[Sync] Failed to save sync status:', error);
    }
  }

  /** Get (or lazily create) a stable per-device identifier. */
  async _getDeviceId() {
    const stored = await chrome.storage.local.get(DEVICE_ID_KEY);
    if (stored[DEVICE_ID_KEY]) return stored[DEVICE_ID_KEY];
    const id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await chrome.storage.local.set({ [DEVICE_ID_KEY]: id });
    return id;
  }
}
