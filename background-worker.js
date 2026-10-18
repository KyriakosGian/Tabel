import './background.js';
import { SyncManager, SYNC_CONTROL_KEY } from './dashboard/lib/sync.js';
import { CHUNK_PREFIX, SYNC_META_KEY } from './dashboard/lib/chromeSync.js';
import { readConfig, SYNC_CONFIG_KEY } from './dashboard/lib/syncCommon.js';
import { hasPrivacyConsent } from './dashboard/lib/privacyConsent.js';

const POLL_ALARM = 'tabel-sync-poll';
let managerPromise;

async function syncManager() {
  const stored = await chrome.storage.local.get('settings');
  if (!hasPrivacyConsent(stored.settings)) return null;
  managerPromise ||= (async () => {
    const manager = new SyncManager({
      onRemoteUpdate: () => chrome.runtime.sendMessage({ type: 'DATA_CHANGED' }).catch(() => {})
    });
    await manager.init();
    return manager;
  })().catch(error => { managerPromise = null; throw error; });
  return managerPromise;
}

async function schedule() {
  const config = await readConfig();
  if (config.provider === 'local') await chrome.alarms.clear(POLL_ALARM);
  else if (!await chrome.alarms.get(POLL_ALARM)) await chrome.alarms.create(POLL_ALARM, { periodInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== POLL_ALARM) return;
  syncManager().then(manager => manager?.syncNow({ automatic: true })).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  schedule().then(() => syncManager()).then(manager => manager?.syncNow({ automatic: true })).catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => schedule().catch(() => {}));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SYNC_CONFIG_KEY]) schedule().catch(() => {});
  if (area === 'sync' && Object.keys(changes).some(key =>
    key === SYNC_META_KEY || key === SYNC_CONTROL_KEY || key.startsWith(CHUNK_PREFIX))) {
    // This listener must exist when the worker starts. A listener registered
    // only by an existing manager is lost when Chrome suspends the worker.
    syncManager().then(manager => {
      if (manager && changes[SYNC_META_KEY]?.newValue?.deviceId !== manager.deviceId) manager.schedulePull();
    }).catch(() => {});
  }
});
