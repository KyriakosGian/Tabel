import { db } from './db.js';
import { ChromeSyncStore, CHUNK_PREFIX, DEVICE_STATE_PREFIX, SYNC_META_KEY } from './chromeSync.js';
import { createBackup, verifyBackup } from './backups.js';
import { getPrunableTombstoneKeys, maxDeletedAt } from './tombstoneCleanup.js';
import {
  byteSize, checkedData, checksum, INITIAL_GENERATION, readConfig, snapshotData,
  storageBytes, SYNC_CONFIG_KEY, SYNC_STATUS_KEY, SyncError, syncErrorCode, uniqueId, updateConfig
} from './syncCommon.js';

export const SYNC_CONTROL_KEY = 'tabel_sync_control';
const isChromeKey = key => key === SYNC_META_KEY || key === SYNC_CONTROL_KEY ||
  key.startsWith(CHUNK_PREFIX) || key.startsWith(DEVICE_STATE_PREFIX);

export class SyncManager extends ChromeSyncStore {
  constructor(callbacks = {}) {
    super(callbacks);
    this._dirtyWrites = Promise.resolve();
    this.lastError = null;
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;
    this._initialized = true;
    this.deviceId = await this._getDeviceId();
    this._changeListener = (changes, area) => {
      if (area === 'local' && changes[SYNC_CONFIG_KEY]) {
        const relevant = config => JSON.stringify([
          config?.provider, config?.generations, config?.chromeRecovery?.id
        ]);
        const change = changes[SYNC_CONFIG_KEY];
        this._activeProvider = change.newValue?.provider || 'chrome';
        if (relevant(change.oldValue) !== relevant(change.newValue)) this.schedulePull();
      } else if (area === 'sync' && Object.keys(changes).some(isChromeKey)) {
        if (this._activeProvider === 'chrome' && changes[SYNC_META_KEY]?.newValue?.deviceId !== this.deviceId) this.schedulePull();
      }
    };
    chrome.storage.onChanged?.addListener(this._changeListener);
    const config = await readConfig();
    this._activeProvider = config.provider;
    if (config.provider === 'local') return;
    const exists = await this.pull();
    if (!exists && !this.lastError) {
      const data = await db.exportAll();
      if (data.groups.length || data.items.length || data.tombstones.length) this.schedulePush();
    }
  }

  dispose() {
    clearTimeout(this._pushTimer);
    clearTimeout(this._pullTimer);
    if (this._changeListener) chrome.storage.onChanged?.removeListener(this._changeListener);
    this._initialized = false;
  }

  schedulePush() {
    clearTimeout(this._pushTimer);
    this._dirtyWrites = this._dirtyWrites.then(async () => {
      const config = await readConfig();
      const stored = await chrome.storage.local.get(SYNC_STATUS_KEY);
      await chrome.storage.local.set({ [SYNC_STATUS_KEY]: {
        ...stored[SYNC_STATUS_KEY], pending: config.provider !== 'local', dirtyId: uniqueId()
      } });
    }).catch(() => {});
    this._pushTimer = setTimeout(() => this.push(), 2000);
  }

  async pushNow() {
    clearTimeout(this._pushTimer);
    await this._dirtyWrites;
    if (!this.deviceId) this.deviceId = await this._getDeviceId();
    return this.push();
  }

  push() {
    this._pushPending ||= this._enqueue(() => this._attempt('push')).finally(() => { this._pushPending = null; });
    return this._pushPending;
  }
  pull() {
    this._pullPending ||= this._enqueue(() => this._attempt('pull')).finally(() => { this._pullPending = null; });
    return this._pullPending;
  }

  syncNow({ automatic = false } = {}) {
    return this._enqueue(async () => {
      if (!this.deviceId) this.deviceId = await this._getDeviceId();
      if (automatic) {
        const previous = (await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] || {};
        if (previous.nextRetryAt > Date.now()) return false;
      }
      await this._attempt('pull');
      if (this.lastError) return false;
      if (automatic) {
        const stored = (await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] || {};
        if (stored.nextRetryAt > Date.now()) return false;
        if (stored.failedFingerprint && stored.failedFingerprint === await checksum(snapshotData(await db.exportAll())) &&
            ['syncCapacityError', 'syncIntegrityError', 'syncResetRequired',
              'syncLegacyClientError', 'syncMissingCloudError'].includes(stored.error)) {
          return false;
        }
        const data = await db.exportAll();
        if (!stored.pending && stored.lastPublishedFingerprint === await checksum(snapshotData(data)) &&
            Date.now() - (stored.lastPushAt || 0) < 24 * 60 * 60 * 1000) {
          const devices = Object.entries(await chrome.storage.sync.get(null))
            .filter(([key]) => key.startsWith(DEVICE_STATE_PREFIX)).map(([, value]) => value);
          if (!getPrunableTombstoneKeys(data.tombstones, devices).length) return true;
        }
      }
      return this._attempt('push');
    });
  }

  async _attempt(operation) {
    this.lastError = null;
    try {
      if (!this.deviceId) this.deviceId = await this._getDeviceId();
      const config = await readConfig();
      this._activeProvider = config.provider;
      if (config.chromeRecovery?.kind === 'clear') return await this._resumeChromeReset(config.chromeRecovery);
      if (config.provider === 'local') {
        await this._updateStatus({ pending: false, error: null, nextRetryAt: 0 });
        return true;
      }
      this._activeDirtyId = ((await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] || {}).dirtyId;
      if (config.chromeRecovery?.kind === 'reset') {
        return await this._resumeChromeReset(config.chromeRecovery);
      }
      const all = await chrome.storage.sync.get(null);
      await this._guardChrome(all, config);
      if (operation === 'push') {
        // Keep the latest remote changes before publishing a complete snapshot.
        const remote = await this._readChromeData(all);
        if (remote) await this._mergeRemote(remote);
        return await super._push();
      }
      return await super._pull();
    } catch (error) {
      await this._recordError(error, operation);
      return false;
    }
  }

  async _updateStatus(updates) {
    const previous = (await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] || {};
    await chrome.storage.local.set({ [SYNC_STATUS_KEY]: { ...previous, ...updates } });
  }

  async _recordSuccess(operation, timestamp = Date.now()) {
    if (this._activeProvider === 'chrome') await updateConfig({ chromeEstablished: true });
    const previous = (await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] || {};
    const updates = {
      lastSuccessfulSyncAt: timestamp, operation, provider: this._activeProvider,
      [operation === 'push' ? 'lastPushAt' : 'lastPullAt']: timestamp
    };
    if (operation === 'push') {
      const currentHash = await checksum(snapshotData(await db.exportAll()));
      updates.pending = previous.dirtyId !== this._activeDirtyId || currentHash !== this._lastPublishedHash;
      Object.assign(updates, {
        error: null, errorOperation: null, nextRetryAt: 0, retryAttempts: 0,
        failedFingerprint: null, lastPublishedFingerprint: this._lastPublishedHash
      });
    } else if (previous.errorOperation === 'pull') {
      Object.assign(updates, { error: null, errorOperation: null, nextRetryAt: 0, retryAttempts: 0 });
    }
    await this._updateStatus(updates);
    if (operation === 'push' && updates.pending) this.schedulePush();
  }

  async _recordError(error, operation) {
    const code = syncErrorCode(error);
    this.lastError = code;
    try {
      const previous = (await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] || {};
      const attempts = Math.min((previous.retryAttempts || 0) + 1, 10);
      const retryable = ['syncNetworkError', 'syncRateError', 'syncCloudBusy', 'syncChangedError'].includes(code);
      await this._updateStatus({
        provider: this._activeProvider, pending: true, error: code, errorOperation: operation,
        failedFingerprint: await checksum(snapshotData(await db.exportAll())),
        retryAttempts: attempts,
        nextRetryAt: retryable ? Date.now() + Math.min(300000, 2000 * 2 ** attempts) : 0
      });
    } catch {}
    this.callbacks.onError?.(code);
  }

  async _readChromeData(all) {
    const meta = all[SYNC_META_KEY];
    if (!meta) return null;
    if (meta.recoveryId && meta.chunkCount === 0) return null;
    if (!Number.isInteger(meta.chunkCount) || meta.chunkCount < 1 || meta.chunkCount > 512) {
      throw new SyncError('syncIntegrityError');
    }
    let text = '';
    for (let i = 0; i < meta.chunkCount; i++) {
      if (typeof all[CHUNK_PREFIX + i] !== 'string') throw new SyncError('syncCloudBusy');
      text += all[CHUNK_PREFIX + i];
    }
    if (meta.checksum && await checksum(text) !== meta.checksum) throw new SyncError('syncIntegrityError');
    return checkedData(text);
  }

  async _guardChrome(all, config) {
    const meta = all[SYNC_META_KEY];
    const control = all[SYNC_CONTROL_KEY];
    if (control && (control.schema !== 2 || typeof control.generation?.id !== 'string' ||
      !control.generation.id || !Number.isSafeInteger(control.generation.rank) || control.generation.rank < 0)) {
      throw new SyncError('syncIntegrityError');
    }
    if (!meta && config.chromeEstablished) throw new SyncError('syncMissingCloudError');
    if (meta?.recoveryId && config.chromeRecovery?.id !== meta.recoveryId) throw new SyncError('syncCloudBusy');
    const generation = control?.generation?.id || meta?.generation || INITIAL_GENERATION;
    const expected = config.generations.chrome;
    if (expected && expected !== generation) throw new SyncError('syncResetRequired');
    if (!expected && generation !== INITIAL_GENERATION) {
      const local = await db.exportAll();
      if (local.groups.length || local.items.length || local.tombstones.length) throw new SyncError('syncResetRequired');
    }
    if (control && meta && !meta.recoveryId && meta.generation !== generation) {
      throw new SyncError('syncLegacyClientError');
    }
    if (!expected) await updateConfig({ generations: { ...config.generations, chrome: generation } });
    this._chromeGeneration = generation;
  }

  async _mergeRemote(data) {
    const result = await db.mergeAll(data);
    if (result.remoteOnlyCount || result.updatedCount) this.callbacks.onRemoteUpdate?.(result);
    return result;
  }

  async _writeChromeSnapshot(existing, writeObj, staleKeys) {
    const quota = Number(chrome.storage.sync.QUOTA_BYTES) || 102400;
    const final = { ...existing, ...writeObj };
    for (const key of staleKeys) delete final[key];
    if (storageBytes(final) > quota || Object.keys(final).length > 512) throw new SyncError('syncCapacityError');
    if (storageBytes({ ...existing, ...writeObj }) > quota || Object.keys({ ...existing, ...writeObj }).length > 512) {
      // Invalidate readers before removing referenced chunks. A durable local
      // checkpoint lets the same installation resume after any interruption.
      let config = await readConfig();
      let recovery = config.chromeRecovery;
      if (!recovery) {
        const backup = await createBackup('chrome-sync-recovery');
        recovery = { id: uniqueId(), kind: 'compact', backupId: backup.id };
        config = await updateConfig({ chromeRecovery: recovery });
      }
      await verifyBackup(await db.getBackup(recovery.backupId));
      await chrome.storage.sync.set({ [SYNC_META_KEY]: { chunkCount: 0, recoveryId: recovery.id } });
      if (staleKeys.length) await chrome.storage.sync.remove(staleKeys);
    }
    await chrome.storage.sync.set(writeObj);
    if (staleKeys.length) await chrome.storage.sync.remove(staleKeys);
    const config = await readConfig();
    if (config.chromeRecovery?.kind === 'compact') await updateConfig({ chromeRecovery: null });
  }

  setProvider(provider) {
    if (!['local', 'chrome'].includes(provider)) throw new Error('Unsupported storage option');
    return this._enqueue(async () => {
      clearTimeout(this._pushTimer);
      clearTimeout(this._pullTimer);
      await updateConfig({ provider });
      await this._updateStatus({ pending: provider !== 'local', error: null, nextRetryAt: 0 });
      return true;
    });
  }

  cleanUnused() {
    return this._enqueue(async () => {
      const config = await readConfig();
      this.deviceId ||= await this._getDeviceId();
      if (config.provider === 'local') return 0;
      const all = await chrome.storage.sync.get(null);
      await this._guardChrome(all, config);
      await this._readChromeData(all);
      const count = all[SYNC_META_KEY]?.chunkCount || 0;
      const unused = Object.keys(all).filter(key => key.startsWith(CHUNK_PREFIX) &&
        /^\d+$/.test(key.slice(CHUNK_PREFIX.length)) && Number(key.slice(CHUNK_PREFIX.length)) >= count);
      if (unused.length) await chrome.storage.sync.remove(unused);
      if (!await this._attempt('push')) throw new SyncError(this.lastError);
      return unused.length;
    });
  }

  resetCloud({ expectedCurrent } = {}) {
    return this._enqueue(async () => {
      const config = await readConfig();
      if (config.provider === 'local') throw new SyncError('syncLocalOnly');
      this.deviceId ||= await this._getDeviceId();
      const backup = await createBackup('before-cloud-reset');
      if (expectedCurrent && await checksum(snapshotData(expectedCurrent)) !== await checksum(snapshotData(backup.data))) {
        throw new SyncError('syncChangedError');
      }
      const all = await chrome.storage.sync.get(null);
      const previous = all[SYNC_CONTROL_KEY]?.generation || { id: INITIAL_GENERATION, rank: 0 };
      const recovery = {
        id: uniqueId(), kind: 'reset', backupId: backup.id,
        previousGeneration: previous.id,
        generation: { id: uniqueId(), rank: previous.rank + 1 }
      };
      await updateConfig({ chromeRecovery: recovery });
      return this._resumeChromeReset(recovery);
    });
  }

  clearChromeCloud() {
    return this._enqueue(async () => {
      this.deviceId ||= await this._getDeviceId();
      const backup = await createBackup('before-chrome-cloud-clear');
      const all = await chrome.storage.sync.get(null);
      const previous = all[SYNC_CONTROL_KEY]?.generation || { id: INITIAL_GENERATION, rank: 0 };
      if (!Number.isSafeInteger(previous.rank) || previous.rank >= Number.MAX_SAFE_INTEGER) throw new SyncError('syncIntegrityError');
      const recovery = {
        id: uniqueId(), kind: 'clear', backupId: backup.id,
        previousGeneration: previous.id, generation: { id: uniqueId(), rank: previous.rank + 1 }
      };
      await updateConfig({ chromeRecovery: recovery });
      return this._resumeChromeReset(recovery);
    });
  }

  async _resumeChromeReset(recovery) {
    const original = await verifyBackup(await db.getBackup(recovery.backupId));
    const all = await chrome.storage.sync.get(null);
    const control = all[SYNC_CONTROL_KEY];
    if (control && ![recovery.previousGeneration, recovery.generation.id].includes(control.generation?.id)) {
      throw new SyncError('syncResetRequired');
    }
    const current = await db.exportAll();
    const target = recovery.kind === 'clear' ? { groups: [], items: [], tombstones: [] } : this._resetData(current, original);
    const text = JSON.stringify(target);
    const chunks = this._chunk(text);
    const meta = {
      deviceId: this.deviceId, updatedAt: Date.now(), chunkCount: chunks.length,
      version: current.version, generation: recovery.generation.id,
      snapshotId: uniqueId(), checksum: await checksum(text)
    };
    const writes = { [SYNC_META_KEY]: meta, [SYNC_CONTROL_KEY]: { schema: 2, generation: recovery.generation } };
    chunks.forEach((chunk, index) => { writes[CHUNK_PREFIX + index] = chunk; });
    writes[this._deviceStateKey(this.deviceId)] = {
      deviceId: this.deviceId, lastSeenAt: Date.now(), acknowledgedThrough: 0
    };
    const unrelated = Object.fromEntries(Object.entries(all).filter(([key]) => !isChromeKey(key)));
    if (storageBytes({ ...unrelated, ...writes }) > (chrome.storage.sync.QUOTA_BYTES || 102400)) {
      throw new SyncError('syncCapacityError');
    }
    await chrome.storage.sync.set({ [SYNC_META_KEY]: { chunkCount: 0, recoveryId: recovery.id } });
    const remove = Object.keys(all).filter(key => isChromeKey(key) && key !== SYNC_META_KEY);
    if (remove.length) await chrome.storage.sync.remove(remove);
    await chrome.storage.sync.set(writes);
    if (recovery.kind !== 'clear') await db.replaceAll(target, { expectedCurrent: current });
    const config = await readConfig();
    const provider = recovery.kind === 'clear' && config.provider === 'chrome' ? 'local' : config.provider;
    await updateConfig({ provider, chromeRecovery: null, generations: { ...config.generations, chrome: recovery.generation.id } });
    if (recovery.kind === 'clear') {
      if (provider === 'local') await this._updateStatus({ pending: false, error: null, nextRetryAt: 0 });
      return true;
    }
    this._activeProvider = 'chrome';
    this._lastPublishedHash = meta.checksum;
    await this._recordSuccess('push');
    return true;
  }

  _resetData(current, original) {
    const previous = new Map((original.tombstones || []).map(record => [record.key, record.deletedAt]));
    return snapshotData({ ...current, tombstones: current.tombstones.filter(record =>
      !previous.has(record.key) || previous.get(record.key) !== record.deletedAt) });
  }

  adoptCloud() {
    return this._enqueue(async () => {
      const config = await readConfig();
      const backup = await createBackup('before-cloud-rejoin');
      let data, generation;
      if (config.provider === 'chrome') {
        const all = await chrome.storage.sync.get(null);
        const meta = all[SYNC_META_KEY];
        if (all[SYNC_CONTROL_KEY] && meta?.generation !== all[SYNC_CONTROL_KEY].generation?.id) {
          throw new SyncError('syncLegacyClientError');
        }
        data = await this._readChromeData(all);
        if (!data) throw new SyncError('syncCloudBusy');
        generation = all[SYNC_CONTROL_KEY]?.generation?.id || meta.generation || INITIAL_GENERATION;
      } else throw new SyncError('syncLocalOnly');
      await db.replaceAll(data, { expectedCurrent: backup.data });
      await updateConfig({
        chromeRecovery: null,
        generations: { ...config.generations, [config.provider]: generation }
      });
      await this._updateStatus({ error: null, pending: true, failedFingerprint: null });
      this.callbacks.onRemoteUpdate?.({ remoteOnlyCount: 1 });
      return true;
    });
  }

  async diagnostics() {
    const [data, all, config, local] = await Promise.all([
      db.exportAll(), chrome.storage.sync.get(null), readConfig(), chrome.storage.local.get(SYNC_STATUS_KEY)
    ]);
    const count = all[SYNC_META_KEY]?.chunkCount || 0;
    const deviceStates = Object.entries(all).filter(([key]) => key.startsWith(DEVICE_STATE_PREFIX)).map(([, value]) => value);
    const unused = Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith(CHUNK_PREFIX) &&
      /^\d+$/.test(key.slice(CHUNK_PREFIX.length)) && Number(key.slice(CHUNK_PREFIX.length)) >= count));
    const prune = getPrunableTombstoneKeys(data.tombstones, deviceStates);
    return {
      config, status: local[SYNC_STATUS_KEY] || {},
      activeBytes: byteSize({ groups: data.groups, items: data.items }),
      deletionBytes: byteSize(data.tombstones), deletionCount: data.tombstones.length,
      metadataBytes: storageBytes(Object.fromEntries(Object.entries(all).filter(([key]) =>
        key === SYNC_META_KEY || key === SYNC_CONTROL_KEY || key.startsWith(DEVICE_STATE_PREFIX)))),
      unusedBytes: storageBytes(unused), unusedCount: Object.keys(unused).length,
      prunableCount: prune.length,
      deviceCount: deviceStates.length,
      blockingDevices: deviceStates.filter(state => (Number(state.acknowledgedThrough) || 0) < maxDeletedAt(data.tombstones)).length
    };
  }
}
