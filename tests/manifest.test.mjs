import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(projectRoot, 'manifest.json'), 'utf8'));

test('manifest uses Manifest V3 and references existing files', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(existsSync(join(projectRoot, manifest.background.service_worker)), true);
  assert.equal(existsSync(join(projectRoot, manifest.options_ui.page)), true);

  for (const iconPath of Object.values(manifest.icons)) {
    assert.equal(existsSync(join(projectRoot, iconPath)), true, `Missing ${iconPath}`);
  }
});

test('localized manifest metadata respects Chrome Web Store limits', () => {
  for (const locale of ['el', 'en']) {
    const messages = JSON.parse(
      readFileSync(join(projectRoot, '_locales', locale, 'messages.json'), 'utf8')
    );
    assert.ok(messages.extName.message.length <= 75, `${locale} name is too long`);
    assert.ok(messages.extDescription.message.length <= 132, `${locale} description is too long`);
  }
});

test('manifest and README use the final public project URLs', () => {
  assert.equal(manifest.homepage_url, 'https://kyriakosgian.github.io/Tabel/');

  const readme = readFileSync(join(projectRoot, 'README.md'), 'utf8');
  assert.match(readme, /github\.com\/KyriakosGian\/Tabel/);
  assert.doesNotMatch(readme, /GITHUB_USER|REPOSITORY|yourusername/i);
  assert.equal(manifest.permissions.includes('activeTab'), false);
});
