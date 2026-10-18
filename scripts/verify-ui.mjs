import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TABEL_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const messages = JSON.parse(await readFile(resolve(root, '_locales/en/messages.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const output = process.env.TABEL_UI_OUTPUT ? resolve(process.env.TABEL_UI_OUTPUT) : await mkdtemp(resolve(tmpdir(), 'tabel-ui-'));
await mkdir(output, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const path = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (!path.startsWith(root + sep) || !/^(options|dashboard|styles|icons)[\/\\]/.test(path.slice(root.length + 1))) {
      response.writeHead(404).end(); return;
    }
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const url = `http://127.0.0.1:${server.address().port}/options/options.html`;
let browser;
let lastPage;
const consoleErrors = [];
try {
  browser = await chromium.launch({ headless: true, channel: process.env.TABEL_UI_BROWSER_CHANNEL || 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(({ messages, manifest }) => {
    const listeners = [];
    const read = area => JSON.parse(localStorage.getItem(`test-storage-${area}`) || '{}');
    if (!localStorage.getItem('test-storage-local')) localStorage.setItem('test-storage-local', JSON.stringify({
      settings: { privacyNoticeVersion: 1, theme: 'dark' }, tabelDeviceId: 'ui-device',
      tabelSyncConfig: { provider: 'local', generations: {} }
    }));
    const storage = area => ({
      QUOTA_BYTES: 102400,
      get: async keys => {
        const values = read(area);
        if (keys === null || keys === undefined) return values;
        const selected = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        return Object.fromEntries(selected.filter(key => key in values).map(key => [key, values[key]]));
      },
      set: async updates => {
        const previous = read(area);
        localStorage.setItem(`test-storage-${area}`, JSON.stringify({ ...previous, ...updates }));
        const changes = Object.fromEntries(Object.entries(updates).map(([key, value]) => [key, { oldValue: previous[key], newValue: value }]));
        queueMicrotask(() => listeners.forEach(listener => listener(changes, area)));
      },
      remove: async keys => {
        const values = read(area);
        for (const key of keys) delete values[key];
        localStorage.setItem(`test-storage-${area}`, JSON.stringify(values));
      },
      getBytesInUse: async () => Object.entries(read(area)).reduce((sum, [key, value]) =>
        sum + new TextEncoder().encode(key + JSON.stringify(value)).length, 0)
    });
    window.chrome = {
      runtime: { getManifest: () => manifest, sendMessage: async () => {} },
      i18n: { getMessage: (key, values = []) => (messages[key]?.message || key).replace(/\$([1-9])/g, (_, index) => values[Number(index) - 1] || ''), getUILanguage: () => 'en' },
      storage: { local: storage('local'), sync: storage('sync'), onChanged: { addListener: listener => listeners.push(listener), removeListener: listener => listeners.splice(listeners.indexOf(listener), 1) } }
    };
    const request = indexedDB.open('TabelDB', 5);
    request.onupgradeneeded = () => {
      const groups = request.result.createObjectStore('tabGroups', { keyPath: 'id' });
      groups.createIndex('createdAt', 'createdAt'); groups.createIndex('order', 'order');
      const items = request.result.createObjectStore('tabItems', { keyPath: 'id' });
      items.createIndex('groupId', 'groupId'); items.createIndex('url', 'url'); items.createIndex('createdAt', 'createdAt');
      request.result.createObjectStore('tombstones', { keyPath: 'key' }).createIndex('deletedAt', 'deletedAt');
      request.result.createObjectStore('backups', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      if (localStorage.getItem('test-seeded')) { request.result.close(); return; }
      const tx = request.result.transaction(['tabGroups', 'tabItems'], 'readwrite');
      const now = Date.now();
      tx.objectStore('tabGroups').put({ id: 'demo', name: 'Demo links', order: 0, tabCount: 3, createdAt: now, updatedAt: now });
      for (let index = 0; index < 3; index++) tx.objectStore('tabItems').put({
        id: `demo-${index}`, groupId: 'demo', url: `https://example.com/${index}`, title: `Demo ${index}`, order: index, createdAt: now, updatedAt: now
      });
      tx.oncomplete = () => { localStorage.setItem('test-seeded', 'true'); request.result.close(); };
    };
  }, { messages, manifest });
  const page = await context.newPage();
  lastPage = page;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('settings-stat-tabs').textContent === '3');
  const navigate = async name => {
    await page.locator(`[data-settings-link="${name}"]`).click();
    await page.locator(`[data-settings-panel="${name}"]`).waitFor({ state: 'visible' });
  };
  assert.equal(await page.locator('[data-settings-panel]:visible').count(), 1);
  assert.equal(await page.locator('[data-settings-link=general]').getAttribute('aria-current'), 'page');
  assert.deepEqual(await page.locator('.settings-footer a').evaluateAll(links => links.map(link => link.getAttribute('href'))), [
    'https://kyriakosgian.github.io/Tabel/', 'https://github.com/KyriakosGian/Tabel',
    'https://github.com/KyriakosGian/Tabel/releases', 'https://github.com/KyriakosGian/Tabel/issues',
    'https://kyriakosgian.github.io/Tabel/privacy/'
  ]);
  await page.locator('#setting-startup + .toggle-slider').click();
  assert.equal(await page.locator('#setting-startup').isChecked(), false);
  await page.waitForFunction(() => document.getElementById('settings-save-state').textContent === 'Saved');
  assert.equal(await page.locator('.toast').count(), 0);
  await page.screenshot({ path: resolve(output, 'settings-general.png') });
  await navigate('appearance');
  assert.equal(await page.locator('#appearance-advanced').getAttribute('open'), null);
  await page.locator('#setting-density').selectOption('compact');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--density-group-padding-y').trim()), '11px');
  await page.locator('#setting-density').selectOption('comfortable');
  await page.locator('#setting-font-scale').press('ArrowRight');
  await page.locator('#setting-font-scale').press('ArrowRight');
  await page.waitForFunction(() => document.getElementById('settings-save-state').textContent === 'Saved');
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--font-scale')), '1.10');
  await page.reload();
  await page.locator('#panel-appearance').waitFor();
  assert.equal(await page.locator('#setting-font-scale').inputValue(), '110');
  await page.locator('#setting-font-scale').press('ArrowLeft');
  await page.locator('#setting-font-scale').press('ArrowLeft');
  await page.waitForFunction(() => document.getElementById('settings-save-state').textContent === 'Saved');
  await page.screenshot({ path: resolve(output, 'settings-appearance.png') });
  await navigate('sync');
  assert.equal(await page.locator('#data-danger').getAttribute('open'), null);
  await page.locator('#data-danger > summary').click();
  assert.deepEqual(await page.locator('#setting-sync-provider option').evaluateAll(options =>
    options.map(option => option.value)), ['local', 'chrome']);
  assert.equal(await page.locator('#btn-reset-cloud').isDisabled(), true);
  const dialog = page.locator('dialog');
  await page.locator('#btn-delete-all').click();
  assert.equal(await dialog.getByRole('button', { name: 'Delete All', exact: true }).isDisabled(), true);
  await dialog.locator('input[type=text]').fill('DELET');
  assert.equal(await dialog.getByRole('button', { name: 'Delete All', exact: true }).isDisabled(), true);
  await dialog.locator('input[type=text]').fill('DELETE');
  await page.keyboard.press('Enter');
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await page.locator('#settings-stat-tabs').textContent(), '3');
  await page.screenshot({ path: resolve(output, 'delete-all-confirmation.png') });
  await page.keyboard.press('Escape');
  await page.locator('#btn-delete-all').click();
  await dialog.locator('input[type=text]').fill('DELETE');
  await dialog.getByRole('button', { name: 'Delete All', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('settings-stat-tabs').textContent === '0');
  assert.match(await page.locator('#settings-backup-summary').textContent(), /1 safety backups/);
  await page.locator('#btn-restore-backup').click();
  await dialog.getByRole('button', { name: 'Restore Last Backup', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('settings-stat-tabs').textContent === '3');
  assert.match(await page.locator('#settings-backup-summary').textContent(), /2 safety backups/);
  await page.locator('#setting-sync-provider').selectOption('chrome');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('settings-sync-state').textContent.includes('Waiting for confirmation'));
  assert.equal(await page.locator('#sync-advanced').getAttribute('open'), null);
  assert.equal(await page.locator('#sync-receipt-status').textContent(), 'Not confirmed yet');
  await page.evaluate(async () => {
    const all = await chrome.storage.sync.get(null);
    await chrome.storage.sync.set({
      tabel_sync_control: { schema: 2, generation: { id: 'ui-reset', rank: 1 } },
      tabel_sync_meta: { ...all.tabel_sync_meta, generation: 'ui-reset', deviceId: 'other-device' }
    });
  });
  await page.locator('#btn-adopt-cloud').waitFor({ state: 'visible' });
  await page.locator('#btn-adopt-cloud').click();
  await page.locator('.recovery-dialog').waitFor();
  assert.equal(await page.locator('.recovery-copy').count(), 2);
  assert.equal(await page.locator('.recovery-copy p').first().textContent(), 'Groups: 1. Saved links: 3.');
  await page.screenshot({ path: resolve(output, 'recovery-preview.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#settings-stat-tabs').textContent(), '3');
  await page.locator('#btn-adopt-cloud').click();
  await page.locator('.recovery-copy button[data-source=cloud]').click();
  await dialog.locator('input[type=text]').fill('REPLACE');
  await dialog.getByRole('button', { name: 'Use Current Cloud Data', exact: true }).click();
  await page.locator('#btn-adopt-cloud').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#settings-stat-tabs').textContent(), '3');
  // A small existing cloud can still reject an oversized local deletion history.
  await page.evaluate(async () => {
    const { db } = await import('/dashboard/lib/db.js');
    const { createTombstone } = await import('/dashboard/lib/merge.js');
    await db.mergeAll({ groups: [], items: [], tombstones: Array.from({ length: 700 }, (_, index) =>
      createTombstone('item', `removed-${index}-${'x'.repeat(100)}`)) });
  });
  await page.locator('#btn-sync-now').click();
  await page.waitForFunction(() => document.getElementById('settings-sync-state').textContent.includes('This upload would exceed'));
  assert.equal(await page.locator('#settings-stat-tabs').textContent(), '3');
  assert.ok(await page.evaluate(() => chrome.storage.sync.getBytesInUse(null)) < 10240);
  await page.locator('#sync-advanced > summary').click();
  await page.locator('#btn-reset-cloud').click();
  await dialog.locator('input[type=text]').fill('RESET');
  assert.equal(await dialog.getByRole('button', { name: 'Reset Cloud From This Device', exact: true }).isDisabled(), true);
  await dialog.locator('input[type=checkbox]').check();
  await dialog.getByRole('button', { name: 'Reset Cloud From This Device', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Cloud rebuilt'));
  await page.waitForFunction(() => document.getElementById('sync-deletion-count').textContent === '0');
  await page.locator('#btn-clear-chrome').click();
  await dialog.locator('input[type=text]').fill('CLEAR');
  assert.equal(await dialog.getByRole('button', { name: 'Clear Chrome Sync Storage', exact: true }).isDisabled(), true);
  await dialog.locator('input[type=checkbox]').check();
  await dialog.getByRole('button', { name: 'Clear Chrome Sync Storage', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Chrome Sync data cleared'));
  assert.equal(await page.locator('#setting-sync-provider').inputValue(), 'local');
  assert.equal(await page.locator('#settings-stat-tabs').textContent(), '3');
  await page.evaluate(async () => {
    const { db } = await import('/dashboard/lib/db.js');
    window.testOriginalSaveBackup = db.saveBackup;
    db.saveBackup = async () => { throw new Error('Simulated disk quota'); };
  });
  await page.locator('#btn-delete-all').click();
  await dialog.locator('input[type=text]').fill('DELETE');
  await dialog.getByRole('button', { name: 'Delete All', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('safety backup could not'));
  assert.equal(await page.locator('#settings-stat-tabs').textContent(), '3');
  await page.evaluate(async () => {
    const { db } = await import('/dashboard/lib/db.js');
    const { createBackup } = await import('/dashboard/lib/backups.js');
    db.saveBackup = window.testOriginalSaveBackup;
    delete window.testOriginalSaveBackup;
    const records = (await db.getBackups()).sort((a, b) => a.createdAt - b.createdAt);
    const pinned = records[0];
    const { tabelSyncConfig: config } = await chrome.storage.local.get('tabelSyncConfig');
    await chrome.storage.local.set({ tabelSyncConfig: { ...config, chromeRecovery: { id: 'test-pinned-checkpoint', kind: 'compact', backupId: pinned.id } } });
    for (let index = 0; index < 7; index++) await createBackup('retention-check');
    if ((await db.getBackups()).length !== 5 || !await db.getBackup(pinned.id)) throw new Error('Backup retention lost a required checkpoint');
    await chrome.storage.local.set({ tabelSyncConfig: config });
  });
  await navigate('appearance');
  await page.locator('#setting-theme').selectOption('light');
  await navigate('sync');
  await page.locator('#btn-delete-all').click();
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.getByRole('button', { name: 'Delete All', exact: true }).isDisabled(), true);
  await page.screenshot({ path: resolve(output, 'delete-all-confirmation-light.png') });
  await page.keyboard.press('Escape');
  await navigate('appearance');
  await page.locator('#setting-theme').selectOption('dark');
  await navigate('sync');
  await page.locator('#setting-sync-provider').selectOption('chrome');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('settings-sync-state').textContent.includes('Waiting for confirmation'));
  await page.locator('#sync-advanced').evaluate(element => { element.open = false; });
  await page.locator('.toast').evaluateAll(toasts => toasts.forEach(toast => toast.remove()));
  await page.locator('#data-danger').evaluate(element => { element.open = false; });
  await page.locator('#panel-sync [data-panel-title]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'sync-settings-preview.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['general', 'appearance', 'sync', 'about']) {
    await navigate(name);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${name} overflows on mobile`);
  }
  await navigate('sync');
  await page.screenshot({ path: resolve(output, 'settings-mobile.png') });
  assert.deepEqual(errors, []);
  console.log('UI checks passed: four Settings sections, saved preferences and hash navigation, shared density, footer links, protected recovery/deletion, real IndexedDB backups, light/dark themes, and all four sections on mobile.');
} catch (error) {
  console.error(error);
  if (lastPage) {
    await lastPage.screenshot({ path: resolve(output, 'ui-failure.png'), fullPage: true });
    if (await lastPage.locator('#settings-sync-state').count()) console.log(await lastPage.locator('#settings-sync-state').textContent());
    console.log(await lastPage.locator('.toast').allTextContents());
    console.log(consoleErrors);
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolveClosed => server.close(resolveClosed));
  const temporaryRoot = resolve(tmpdir());
  if (!process.env.TABEL_UI_OUTPUT && output.startsWith(temporaryRoot + sep) && basename(output).startsWith('tabel-ui-')) {
    await rm(output, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
