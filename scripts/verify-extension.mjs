import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.TABEL_PLAYWRIGHT_PATH || 'playwright');
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.TABEL_EXTENSION_ROOT ? resolve(process.env.TABEL_EXTENSION_ROOT) : projectRoot;
const output = resolve(projectRoot, 'dist/review');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, 'extension-profile-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
try {
  let [worker] = context.serviceWorkers();
  worker ||= await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  assert.equal(id, 'hmdklfckhfiobokdglandjdndgaefngd');
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/dashboard/dashboard.html`);
  // Seed a v4 database in this isolated profile before accepting the notice.
  // The extension's next database access must migrate and preserve these rows.
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('TabelDB');
      request.onsuccess = resolve; request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('TabelDB', 4);
      request.onupgradeneeded = () => {
        const groups = request.result.createObjectStore('tabGroups', { keyPath: 'id' });
        groups.createIndex('createdAt', 'createdAt'); groups.createIndex('order', 'order');
        const items = request.result.createObjectStore('tabItems', { keyPath: 'id' });
        items.createIndex('groupId', 'groupId'); items.createIndex('url', 'url'); items.createIndex('createdAt', 'createdAt');
        request.result.createObjectStore('tombstones', { keyPath: 'key' }).createIndex('deletedAt', 'deletedAt');
      };
      request.onsuccess = () => {
        const database = request.result;
        const tx = database.transaction(['tabGroups', 'tabItems'], 'readwrite');
        const now = Date.now() - 86400000;
        tx.objectStore('tabGroups').put({ id: 'legacy-group', name: 'Legacy group', order: 0, tabCount: 1, createdAt: now, updatedAt: now, unusedPayload: 'x'.repeat(50000) });
        tx.objectStore('tabItems').put({ id: 'legacy-tab', groupId: 'legacy-group', url: 'https://example.com/legacy', title: 'Legacy tab', order: 0, createdAt: now, updatedAt: now, favIconUrl: 'https://example.com/icon.png', unusedPayload: 'x'.repeat(50000) });
        tx.oncomplete = () => { database.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.locator('#privacy-accept-btn').click();
  await page.waitForFunction(() => document.getElementById('privacy-notice').hidden);
  const legacy = await page.evaluate(async () => {
    const { db } = await import('./lib/db.js');
    return { group: await db.getGroup('legacy-group'), item: await db.getTab('legacy-tab'), backups: await db.getBackups() };
  });
  assert.equal(legacy.item.id, 'legacy-tab');
  assert.equal(legacy.item.unusedPayload, undefined);
  assert.equal(legacy.item.favIconUrl, undefined);
  assert.equal(legacy.group.unusedPayload, undefined);
  assert.equal(legacy.backups.length, 0);
  await page.evaluate(async () => {
    const { db } = await import('./lib/db.js');
    await db.createGroup('Isolated extension check', [
      { url: 'https://example.com/one', title: 'One' },
      { url: 'https://example.com/two', title: 'Two' }
    ]);
  });
  await page.goto(`chrome-extension://${id}/options/options.html`);
  await page.waitForFunction(() => document.getElementById('settings-stat-tabs').textContent === '3');
  assert.equal(await page.locator('#app-version').textContent(), 'Tabel v2.1.0');
  assert.deepEqual(await page.locator('#setting-sync-provider option').evaluateAll(options => options.map(option => option.value)), ['local', 'chrome']);
  const permissions = await page.evaluate(() => chrome.runtime.getManifest());
  assert.equal(permissions.optional_permissions, undefined);
  assert.equal(permissions.optional_host_permissions, undefined);
  assert.equal(permissions.oauth2, undefined);
  await page.locator('#btn-sync-now').click();
  await page.waitForFunction(() => document.getElementById('settings-sync-state').textContent.includes('No pending'));
  const state = await page.evaluate(async () => ({
    cloud: await chrome.storage.sync.get(null),
    local: await chrome.storage.local.get(['tabelDeviceId', 'tabelSyncStatus']),
    alarms: await chrome.alarms.getAll()
  }));
  assert.ok(state.cloud.tabel_sync_meta.checksum);
  assert.equal(state.cloud.tabel_sync_meta.deviceId, state.local.tabelDeviceId);
  assert.equal(state.local.tabelSyncStatus.pending, false);
  assert.ok(state.alarms.some(alarm => alarm.name === 'tabel-sync-poll'));
  await page.evaluate(() => chrome.alarms.create('tabel-sync-poll', { when: Date.now() - 1 }));
  await page.waitForFunction(async previous => {
    const result = await chrome.storage.local.get('tabelSyncStatus');
    return result.tabelSyncStatus.lastPullAt > previous && !result.tabelSyncStatus.error;
  }, state.local.tabelSyncStatus.lastPullAt || 0);
  await page.evaluate(() => chrome.alarms.create('tabel-sync-poll', { periodInMinutes: 5 }));
  await page.locator('#setting-theme').selectOption('dark');
  await page.evaluate(() => {
    const section = document.getElementById('setting-sync-provider').closest('.settings-section');
    window.scrollTo({ top: section.getBoundingClientRect().top + scrollY - 88, behavior: 'instant' });
    document.querySelectorAll('.toast').forEach(toast => toast.remove());
    document.activeElement?.blur();
  });
  await page.screenshot({ path: resolve(output, 'settings-preview-1280x800.png'), animations: 'disabled' });
  await page.locator('#btn-delete-all').click();
  const dialog = page.locator('dialog');
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.getByRole('button', { name: 'Delete All', exact: true }).isDisabled(), true);
  await page.screenshot({ path: resolve(output, 'delete-all-confirmation-1280x800.png'), animations: 'disabled' });
  await dialog.locator('input[type=text]').fill('DELETE');
  await dialog.getByRole('button', { name: 'Delete All', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('settings-stat-tabs').textContent === '0');
  await page.locator('#btn-restore-backup').click();
  await dialog.getByRole('button', { name: 'Restore Last Backup', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('settings-stat-tabs').textContent === '3');
  await page.locator('#btn-clear-chrome').click();
  await dialog.locator('input[type=text]').fill('CLEAR');
  await dialog.locator('input[type=checkbox]').check();
  await dialog.getByRole('button', { name: 'Clear Chrome Sync Storage', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('setting-sync-provider').value === 'local');
  assert.equal(await page.locator('#settings-stat-tabs').textContent(), '3');
  await page.waitForFunction(async () => (await chrome.alarms.getAll()).every(alarm => alarm.name !== 'tabel-sync-poll'));
  const cloud = await page.evaluate(() => chrome.storage.sync.get(null));
  assert.equal(JSON.parse(cloud.tabel_sync_chunk_0).items.length, 0);
  assert.deepEqual(errors, []);
  await page.locator('#settings-sync-state').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'tabel-2.1-extension-settings.png') });
  console.log('Real extension checks passed: v4-to-v5 migration, stable Store ID, MV3 worker, native storage, background alarm execution, guarded Delete All, backup restoration, and cloud clearing preserve local data. No Google account was used.');
} finally {
  await context.close();
}
