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

test('tab URL visibility setting shows full links and supports compact mode', () => {
  const optionsHtml = read('options/options.html');
  const optionsSource = read('options/options.js');
  const dashboardSource = read('dashboard/dashboard.js');
  const dashboardCss = read('dashboard/dashboard.css');
  const tabItemSource = read('dashboard/components/TabItem.js');

  assert.match(optionsHtml, /id="setting-show-tab-urls"/);
  assert.match(optionsSource, /showTabUrls: true/);
  assert.match(optionsSource, /this\.settings\.showTabUrls = e\.target\.checked/);
  assert.match(dashboardSource, /classList\.toggle\('hide-tab-urls', settings\.showTabUrls === false\)/);
  assert.match(dashboardCss, /\.hide-tab-urls \.tab-item__domain\s*\{\s*display: none;/);
  assert.match(tabItemSource, /tab-item__domain[^]*this\._escapeHtml\(this\.data\.url\)/);
  assert.doesNotMatch(tabItemSource, /\.hostname/);
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
