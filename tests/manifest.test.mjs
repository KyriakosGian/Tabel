import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey } from 'node:crypto';
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

test('manifest public key matches the official Chrome Web Store item ID', () => {
  assert.equal(typeof manifest.key, 'string');
  assert.ok(manifest.key.length > 0);

  const digest = createHash('sha256')
    .update(Buffer.from(manifest.key, 'base64'))
    .digest('hex')
    .slice(0, 32);
  const extensionId = [...digest]
    .map(character => 'abcdefghijklmnop'[Number.parseInt(character, 16)])
    .join('');

  assert.equal(extensionId, 'hmdklfckhfiobokdglandjdndgaefngd');
});

test('localized manifest metadata respects Chrome Web Store limits', () => {
  for (const locale of ['en']) {
    const messages = JSON.parse(
      readFileSync(join(projectRoot, '_locales', locale, 'messages.json'), 'utf8')
    );
    assert.ok(messages.extName.message.length <= 75, `${locale} name is too long`);
    assert.ok(messages.extDescription.message.length <= 132, `${locale} description is too long`);
  }
});

test('the isolated test build has a valid stable identity separate from the Store extension', () => {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const key = pkg.config.testExtensionPublicKey;
  assert.equal(createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyType, 'rsa');
  assert.notEqual(key, manifest.key);
  const id = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, character => 'abcdefghijklmnop'[Number.parseInt(character, 16)]);
  assert.notEqual(id, 'hmdklfckhfiobokdglandjdndgaefngd');
});

test('manifest and README use the final public project URLs', () => {
  assert.equal(manifest.homepage_url, 'https://kyriakosgian.github.io/Tabel/');

  const readme = readFileSync(join(projectRoot, 'README.md'), 'utf8');
  assert.match(readme, /github\.com\/KyriakosGian\/Tabel/);
  assert.doesNotMatch(readme, /https?:\/\/[^\s)]*(?:GITHUB_USER|REPOSITORY|yourusername)/i);
  assert.equal(manifest.permissions.includes('activeTab'), false);
});
