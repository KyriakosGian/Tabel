import './background.js';
import { SyncManager } from './dashboard/lib/sync.js';
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
});
