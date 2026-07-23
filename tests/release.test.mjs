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
  'docs/support/index.html',
  'docs/en/index.html',
  'docs/en/privacy/index.html',
  'docs/en/support/index.html'
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

test('GitHub Pages homepages provide a complete one-page presentation', () => {
  for (const page of ['docs/index.html', 'docs/en/index.html']) {
    const html = read(page);
    assert.match(html, /id="features"/);
    assert.match(html, /id="how-it-works"/);
    assert.match(html, /id="faq"/);
    assert.match(html, /dashboard-preview\.png/);
    assert.match(
      html,
      /<meta property="og:image" content="https:\/\/kyriakosgian\.github\.io\/Tabel\/assets\/og\.png">/
    );
    assert.match(html, /href="privacy\/"/);
    assert.match(html, /href="support\/"/);
  }

  const socialCard = pngSize('docs/assets/og.png');
  assert.ok(socialCard.width >= 1200);
  assert.ok(socialCard.height >= 600);
  assert.ok(socialCard.width / socialCard.height >= 1.8);
});

test('privacy policies disclose storage, synchronization, and Limited Use', () => {
  for (const page of ['docs/privacy/index.html', 'docs/en/privacy/index.html']) {
    const html = read(page);
    assert.match(html, /chrome\.storage\.local/);
    assert.match(html, /chrome\.storage\.sync/);
    assert.match(html, /Limited Use/i);
    assert.match(html, /(?:22 Ιουλίου 2026|July 22, 2026)/);
  }
});

test('Chrome Web Store graphics have exact required dimensions', () => {
  assert.deepEqual(pngSize('release/assets/store-icon-128.png'), { width: 128, height: 128 });
  assert.deepEqual(
    pngSize('release/assets/screenshot-dashboard-1280x800.png'),
    { width: 1280, height: 800 }
  );
  assert.deepEqual(
    pngSize('release/assets/promo-tile-440x280.png'),
    { width: 440, height: 280 }
  );
});

test('release material and reproducible package builder are present', () => {
  const version = JSON.parse(read('manifest.json')).version;

  assert.equal(existsSync(join(projectRoot, 'release/CHROME_WEB_STORE.md')), true);
  assert.equal(existsSync(join(projectRoot, `release/notes/${version}.md`)), true);
  assert.equal(existsSync(join(projectRoot, 'scripts/build-release.ps1')), true);
  assert.equal(existsSync(join(projectRoot, '.github/workflows/ci.yml')), true);
  assert.equal(existsSync(join(projectRoot, '.github/workflows/release.yml')), true);
  assert.equal(existsSync(join(projectRoot, '.github/ISSUE_TEMPLATE/bug_report.yml')), true);

  const buildScript = read('scripts/build-release.ps1');
  assert.match(buildScript, /Properties\.Remove\('key'\)/);
  assert.match(buildScript, /Release archive contains non-runtime files/);

  const releaseWorkflow = read('.github/workflows/release.yml');
  assert.match(releaseWorkflow, /npm test/);
  assert.match(releaseWorkflow, /npm run build:release/);
  assert.match(releaseWorkflow, /gh release create/);
  assert.match(releaseWorkflow, /gh release list/);
  assert.doesNotMatch(releaseWorkflow, /gh release view/);

  const gitignore = read('.gitignore');
  assert.match(gitignore, /\*\.pem/);
  assert.match(gitignore, /dist\//);
});
