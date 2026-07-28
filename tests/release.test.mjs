import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = path => readFileSync(join(projectRoot, path), 'utf8');

const sitePages = [
  'docs/index.html',
  'docs/privacy/index.html',
  'docs/support/index.html'
];

function pngSize(path) {
  const data = readFileSync(join(projectRoot, path));
  assert.equal(data.toString('ascii', 1, 4), 'PNG');
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20)
  };
}

test('GitHub Pages links and local assets resolve', () => {
  for (const page of sitePages) {
    const html = read(page);
    assert.match(html, /<meta name="viewport"/);
    assert.doesNotMatch(html, /<script\b/i);
    assert.doesNotMatch(html, /https?:\/\/(?:fonts\.|cdn\.)/i);

    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const reference = match[1].split('#')[0];
      if (!reference || /^(?:https?:|mailto:|chrome:)/.test(reference)) continue;

      let target = normalize(join(projectRoot, dirname(page), reference));
      if (!extname(target)) target = join(target, 'index.html');
      assert.equal(existsSync(target), true, `${page} has missing link ${reference}`);
    }
  }
});

test('public project copy and extension interface are English only', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.default_locale, 'en');
  assert.equal(existsSync(join(projectRoot, '_locales/el')), false);
  assert.equal(existsSync(join(projectRoot, 'docs/en')), false);

  for (const file of [
    ...sitePages,
    'README.md',
    'CHANGELOG.md',
    'release/CHROME_WEB_STORE.md',
    `release/notes/${manifest.version}.md`,
    '_locales/en/messages.json'
  ]) {
    assert.doesNotMatch(read(file), /[\u0370-\u03ff]/i, `${file} contains Greek text`);
  }
});

test('GitHub Pages homepage provides a complete one-page presentation', () => {
  const html = read('docs/index.html');
  const version = JSON.parse(read('manifest.json')).version;
  const downloadUrl = `https://github.com/KyriakosGian/Tabel/releases/download/v${version}/tabel-${version}-chrome-web-store.zip`;

  assert.match(html, /id="features"/);
  assert.match(html, /id="how-it-works"/);
  assert.match(html, /id="installation"/);
  assert.match(html, /id="faq"/);
  assert.match(html, /dashboard-preview\.png/);
  assert.match(html, /settings-preview\.png/);
  assert.ok(html.includes(`Version ${version}`));
  assert.ok(html.includes(downloadUrl));
  assert.match(html, /chrome:\/\/extensions\//);
  assert.match(html, /Load unpacked/);
  assert.match(html, /manifest\.json/);
  assert.match(html, /reducing the memory used by your browser and computer/i);
  assert.match(
    html,
    /<meta property="og:image" content="https:\/\/kyriakosgian\.github\.io\/Tabel\/assets\/og\.png">/
  );
  assert.match(html, /href="privacy\/"/);
  assert.match(html, /href="support\/"/);

  const socialCard = pngSize('docs/assets/og.png');
  assert.ok(socialCard.width >= 1200);
  assert.ok(socialCard.height >= 600);
  assert.ok(socialCard.width / socialCard.height >= 1.8);
});

test('privacy policies disclose storage, synchronization, and Limited Use', () => {
  const html = read('docs/privacy/index.html');
  assert.match(html, /chrome\.storage\.local/);
  assert.match(html, /chrome\.storage\.sync/);
  assert.match(html, /Limited Use/i);
  assert.match(html, /July 29, 2026/);
  assert.match(html, /favicon API/i);
  assert.match(html, /not stored or synchronized/i);
});

test('Chrome Web Store graphics have exact required dimensions', () => {
  assert.deepEqual(pngSize('release/assets/store-icon-128.png'), { width: 128, height: 128 });
  assert.deepEqual(
    pngSize('release/assets/screenshot-dashboard-1280x800.png'),
    { width: 1280, height: 800 }
  );
  assert.deepEqual(
    pngSize('docs/assets/settings-preview.png'),
    { width: 1280, height: 800 }
  );
  assert.deepEqual(
    pngSize('release/assets/promo-tile-440x280.png'),
    { width: 440, height: 280 }
  );
});

test('release material and reproducible package builder are present', () => {
  const version = JSON.parse(read('manifest.json')).version;
  const packageVersion = JSON.parse(read('package.json')).version;

  assert.equal(version, packageVersion);
  assert.equal(existsSync(join(projectRoot, 'release/CHROME_WEB_STORE.md')), true);
  assert.equal(existsSync(join(projectRoot, `release/notes/${version}.md`)), true);
  assert.equal(existsSync(join(projectRoot, 'scripts/build-release.ps1')), true);
  assert.equal(existsSync(join(projectRoot, '.github/workflows/ci.yml')), true);
  assert.equal(existsSync(join(projectRoot, '.github/workflows/release.yml')), true);
  assert.equal(existsSync(join(projectRoot, '.github/ISSUE_TEMPLATE/bug_report.yml')), true);
  assert.ok(read('README.md').includes(`Version ${version}`));
  assert.ok(read('CHANGELOG.md').includes(`## ${version},`));
  assert.ok(read('release/CHROME_WEB_STORE.md').startsWith(`# Tabel ${version},`));

  const buildScript = read('scripts/build-release.ps1');
  assert.match(buildScript, /Properties\.Remove\('key'\)/);
  assert.match(buildScript, /Release archive contains non-runtime files/);
  assert.match(buildScript, /'styles'/);
  assert.match(buildScript, /styles\/tabel\.css/);

  const releaseWorkflow = read('.github/workflows/release.yml');
  assert.match(releaseWorkflow, /npm test/);
  assert.match(releaseWorkflow, /npm run build:release/);
  assert.match(releaseWorkflow, /gh release create/);
  assert.match(releaseWorkflow, /gh release list/);
  assert.match(releaseWorkflow, /gh release edit/);
  assert.doesNotMatch(releaseWorkflow, /gh release view/);

  const gitignore = read('.gitignore');
  assert.match(gitignore, /\*\.pem/);
  assert.match(gitignore, /dist\//);
});
