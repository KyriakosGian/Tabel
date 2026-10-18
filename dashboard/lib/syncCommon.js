import { validateData } from './validateData.js';
import { sanitizeGroupRecord, sanitizeTabRecord, sanitizeTombstoneRecord } from './recordSanitizer.js';

export const SYNC_CONFIG_KEY = 'tabelSyncConfig';
export const SYNC_STATUS_KEY = 'tabelSyncStatus';
export const DEVICE_ID_KEY = 'tabelDeviceId';
export const INITIAL_GENERATION = 'initial';
export const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;

export class SyncError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
  }
}

export function syncErrorCode(error) {
  if (error instanceof SyncError) return error.code;
  const message = String(error?.message || error);
  if (/MAX_WRITE|rate.?limit|too many/i.test(message)) return 'syncRateError';
  if (/QUOTA_BYTES|quota exceeded|MAX_ITEMS/i.test(message)) return 'syncCapacityError';
  if (/network|fetch|offline|abort|timeout/i.test(message)) return 'syncNetworkError';
  return 'syncOperationError';
}

export function byteSize(value) {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
}

export function storageBytes(values) {
  return Object.entries(values).reduce((total, [key, value]) =>
    total + byteSize(key) + byteSize(JSON.stringify(value)), 0);
}

export function snapshotData(data) {
  return {
    groups: data.groups.map(sanitizeGroupRecord),
    items: data.items.map(sanitizeTabRecord),
    tombstones: (data.tombstones || []).map(sanitizeTombstoneRecord)
  };
}

export async function checksum(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function collectionFingerprint(data) {
  const snapshot = snapshotData(data);
  const by = key => (a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
  snapshot.groups.sort(by('id'));
  snapshot.items.sort(by('id'));
  snapshot.tombstones.sort(by('key'));
  return checksum(snapshot);
}

export function uniqueId() {
  return crypto.randomUUID();
}

export function checkedData(text) {
  if (typeof text !== 'string' || byteSize(text) > MAX_SNAPSHOT_BYTES) {
    throw new SyncError('syncIntegrityError');
  }
  try {
    const data = JSON.parse(text);
    validateData(data);
    return snapshotData(data);
  } catch {
    throw new SyncError('syncIntegrityError');
  }
}

export async function readConfig(storage = chrome.storage.local) {
  const result = await storage.get(SYNC_CONFIG_KEY);
  const config = result[SYNC_CONFIG_KEY] || {};
  return {
    provider: ['local', 'chrome'].includes(config.provider) ? config.provider : config.provider ? 'local' : 'chrome',
    generations: config.generations?.chrome ? { chrome: config.generations.chrome } : {},
    chromeEstablished: config.chromeEstablished === true,
    chromeRecovery: config.chromeRecovery || null
  };
}

export async function updateConfig(updates, storage = chrome.storage.local) {
  const config = { ...await readConfig(storage), ...updates };
  await storage.set({ [SYNC_CONFIG_KEY]: config });
  return config;
}

export async function getDeviceId(storage = chrome.storage.local) {
  const getOrCreate = async () => {
    const result = await storage.get(DEVICE_ID_KEY);
    if (result[DEVICE_ID_KEY]) return result[DEVICE_ID_KEY];
    const id = `dev_${uniqueId()}`;
    await storage.set({ [DEVICE_ID_KEY]: id });
    return id;
  };
  return globalThis.navigator?.locks ? navigator.locks.request('tabel-device-identity', getOrCreate) : getOrCreate();
}
