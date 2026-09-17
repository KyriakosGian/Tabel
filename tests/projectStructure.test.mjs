import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = path => readFileSync(join(projectRoot, path), 'utf8');

test('module imports reference existing local files', () => {
  const sourceFiles = [
    'dashboard/dashboard.js',
    'dashboard/components/TabGroup.js',
    'dashboard/components/TabItem.js',
    'dashboard/lib/db.js',
    'dashboard/lib/sync.js',
    'options/options.js'
  ];

  for (const sourceFile of sourceFiles) {
    const source = read(sourceFile);
    const importPattern = /from\s+['"](\.[^'"]+)['"]/g;
    for (const match of source.matchAll(importPattern)) {
      const target = normalize(join(projectRoot, dirname(sourceFile), match[1]));
      assert.equal(existsSync(target), true, `${sourceFile} imports missing ${match[1]}`);
    }
  }
});

test('HTML structure is balanced and contains no remote font dependency', () => {
  for (const file of ['dashboard/dashboard.html', 'options/options.html']) {
    const html = read(file);
    assert.equal(
      (html.match(/<div(?=\s|>)/g) || []).length,
      (html.match(/<\/div>/g) || []).length,
      `${file} has unbalanced div elements`
    );
    assert.doesNotMatch(html, /fonts\.googleapis\.com/i);
  }
  assert.doesNotMatch(read('dashboard/dashboard.css'), /fonts\.googleapis\.com/i);
});

test('Dashboard and Settings share one visual foundation', () => {
  const dashboardHtml = read('dashboard/dashboard.html');
  const optionsHtml = read('options/options.html');
  const sharedCss = read('styles/tabel.css');
  const dashboardCss = read('dashboard/dashboard.css');

  assert.match(dashboardHtml, /\.\.\/styles\/tabel\.css/);
  assert.match(optionsHtml, /\.\.\/styles\/tabel\.css/);
  assert.match(optionsHtml, /options\.css/);
  assert.doesNotMatch(optionsHtml, /<style>/);
  assert.match(sharedCss, /:root\s*\{/);
  assert.match(sharedCss, /\.theme-light\s*\{/);
  assert.match(sharedCss, /\.dashboard-header\s*\{/);
  assert.doesNotMatch(dashboardCss, /:root\s*\{/);
});

test('English locale covers direct i18n references', () => {
  const en = JSON.parse(read('_locales/en/messages.json'));

  const sources = [
    'manifest.json',
    'background.js',
    'dashboard/dashboard.html',
    'dashboard/dashboard.js',
    'dashboard/components/TabGroup.js',
    'dashboard/components/TabItem.js',
    'options/options.html',
    'options/options.js'
  ].map(read).join('\n');

  const keys = new Set();
  for (const match of sources.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) keys.add(match[1]);
  for (const match of sources.matchAll(/getMessage\(['"]([^'"]+)['"]/g)) keys.add(match[1]);
  for (const match of sources.matchAll(/data-i18n(?:-placeholder|-title)?=['"]([^'"]+)['"]/g)) keys.add(match[1]);

  for (const key of keys) assert.equal(key in en, true, `Missing locale key ${key}`);
});

test('manifest and package versions match', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const packageData = JSON.parse(read('package.json'));
  assert.equal(manifest.version, packageData.version);
  assert.equal(read('options/options.html').includes('v1.1.0'), false);
});

test('data management requests immediate sync and dashboard refresh', () => {
  const optionsSource = read('options/options.js');
  assert.match(optionsSource, /await this\.sync\.pushNow\(\)/);
  assert.match(optionsSource, /type: 'DATA_CHANGED'/);

  const dashboardSource = read('dashboard/dashboard.js');
  assert.match(dashboardSource, /msg\.type === 'DATA_CHANGED'/);
});

test('appearance settings support system theme, density, URL modes, sizing, and reset', () => {
  const optionsHtml = read('options/options.html');
  const optionsSource = read('options/options.js');
  const dashboardSource = read('dashboard/dashboard.js');
  const dashboardCss = read('dashboard/dashboard.css');
  const tabItemSource = read('dashboard/components/TabItem.js');

  for (const id of [
    'setting-theme',
    'setting-density',
    'setting-default-group-width',
    'setting-tab-url-mode',
    'setting-font-scale',
    'setting-favicon-size',
    'appearance-preview',
    'btn-reset-appearance'
  ]) {
    assert.match(optionsHtml, new RegExp(`id="${id}"`));
  }
  assert.match(optionsHtml, /option value="system"/);
  assert.match(optionsHtml, /option value="ultraCompact"/);
  assert.match(optionsSource, /APPEARANCE_DEFAULTS/);
  assert.match(dashboardSource, /applyAppearance/);
  assert.match(dashboardCss, /\[data-tab-url-mode='hidden'\]/);
  assert.match(dashboardCss, /\[data-density='ultraCompact'\]/);
  assert.match(tabItemSource, /tab-item__domain--host/);
  assert.match(tabItemSource, /tab-item__domain--full/);
});

test('Dashboard saves selected tabs, then closes the browser tabs after persistence', () => {
  const dashboardHtml = read('dashboard/dashboard.html');
  const dashboardSource = read('dashboard/dashboard.js');
  const dbSource = read('dashboard/lib/db.js');
  const optionsHtml = read('options/options.html');

  assert.match(dashboardHtml, /id="save-tabs-btn"/);
  assert.match(dashboardHtml, /id="save-tabs-dialog"/);
  assert.match(dashboardHtml, /option value="current"/);
  assert.match(dashboardHtml, /option value="selected"/);
  assert.match(dashboardHtml, /option value="all"/);
  assert.match(dashboardSource, /chrome\.tabs\.query\(\{\}\)/);
  assert.match(dashboardSource, /db\.addTabsToGroup\(destination, tabs\)/);
  assert.match(dashboardSource, /closeCapturedTabs\(chrome\.tabs, capturedBrowserTabs\)/);
  assert.ok(
    dashboardSource.indexOf('await db.createGroup(name, tabs') <
    dashboardSource.indexOf('await closeCapturedTabs(chrome.tabs, capturedBrowserTabs)')
  );
  assert.match(dbSource, /async addTabsToGroup\(groupId, tabs = \[\]\)/);
  assert.match(dbSource, /_replaceCapturedUrls\(data, uniqueTabs, groupId, now\)/);
  assert.doesNotMatch(dbSource, /async _prependItems/);
  assert.match(optionsHtml, /id="setting-include-pinned-tabs"/);
  assert.match(optionsHtml, /id="setting-include-audible-tabs"/);
});

test('Settings shows last successful sync and quota usage', () => {
  const optionsHtml = read('options/options.html');
  const optionsSource = read('options/options.js');
  const syncSource = read('dashboard/lib/sync.js');

  assert.match(optionsHtml, /id="settings-last-sync"/);
  assert.match(optionsHtml, /id="settings-sync-quota"/);
  assert.match(optionsHtml, /id="settings-sync-quota-meter"/);
  assert.match(optionsSource, /chrome\.storage\.sync\.getBytesInUse\(null\)/);
  assert.match(syncSource, /lastSuccessfulSyncAt/);
});

test('context menu permission and handlers are declared', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const backgroundSource = read('background.js');

  assert.equal(manifest.permissions.includes('contextMenus'), true);
  assert.match(backgroundSource, /tabel-save-tab/);
  assert.match(backgroundSource, /tabel-save-link/);
  assert.match(backgroundSource, /tabel-save-link-new/);
  assert.match(backgroundSource, /parentId: CONTEXT_MENU_SAVE_LINK/);
  assert.match(backgroundSource, /destinationGroupId/);
  assert.match(backgroundSource, /openDashboard\(\{ active: false, notify: true \}\)/);
  assert.match(backgroundSource, /source: 'contextMenu'/);
});

test('favicons are derived through Chrome and never stored in tab records', () => {
  const backgroundSource = read('background.js');
  const dbSource = read('dashboard/lib/db.js');
  const tabItemSource = read('dashboard/components/TabItem.js');

  assert.doesNotMatch(backgroundSource, /favIconUrl/);
  assert.doesNotMatch(dbSource, /favIconUrl:\s*tab\./);
  assert.match(tabItemSource, /createFaviconUrl\(chrome\.runtime, this\.data\.url\)/);
  assert.match(dbSource, /sanitizeTabRecord/);
});

test('single-tab restore focus is configurable from Settings', () => {
  const optionsHtml = read('options/options.html');
  const optionsSource = read('options/options.js');
  const dashboardSource = read('dashboard/dashboard.js');

  assert.match(optionsHtml, /id="setting-focus-restored-tab"/);
  assert.match(optionsSource, /focusRestoredTab: true/);
  assert.match(
    optionsSource,
    /this\.settings\.focusRestoredTab = e\.target\.checked/
  );
  assert.match(
    dashboardSource,
    /this\.settings\.focusRestoredTab !== false/
  );
});

test('Settings shows local tab-group statistics and refreshes after data changes', () => {
  const optionsHtml = read('options/options.html');
  const optionsSource = read('options/options.js');

  for (const id of [
    'settings-stat-tabs',
    'settings-stat-groups',
    'settings-stat-average',
    'settings-stat-oldest'
  ]) {
    assert.match(optionsHtml, new RegExp(`id="${id}"`));
  }
  assert.match(optionsSource, /async _loadStatistics\(\)/);
  assert.match(optionsSource, /db\.getCounts\(\)/);
  assert.match(optionsSource, /db\.getAllGroups\(\)/);
  assert.ok(
    (optionsSource.match(/await this\._loadStatistics\(\)/g) || []).length >= 3
  );
});

test('privacy consent is required before tab collection', () => {
  const backgroundSource = read('background.js');
  const dashboardSource = read('dashboard/dashboard.js');
  const dashboardHtml = read('dashboard/dashboard.html');

  assert.match(backgroundSource, /if \(!await hasPrivacyConsent\(\)\)/);
  assert.match(dashboardSource, /await this\._ensurePrivacyConsent\(\)/);
  assert.match(dashboardHtml, /id="privacy-notice"/);
  assert.match(dashboardHtml, /id="privacy-accept-btn"/);
});

test('tab moves and reorders update synchronization timestamps', () => {
  const dbSource = read('dashboard/lib/db.js');
  assert.match(dbSource, /tab\.groupId = targetGroupId;[\s\S]*?tab\.updatedAt = Date\.now\(\)/);
  assert.match(dbSource, /tab\.order = index;\s+tab\.updatedAt = updatedAt/);
});
