import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function controller(set) {
  const indicator = { dataset: {}, textContent: '' };
  const source = readFileSync(new URL('../options/options.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\s*$/gm, '')
    .replace('new OptionsController();', 'globalThis.Controller = OptionsController;');
  const context = {
    document: { getElementById: () => indicator },
    chrome: { storage: { local: { set } }, runtime: { sendMessage: async () => {} }, i18n: { getMessage: key => key } }
  };
  vm.runInNewContext(source, context);
  const instance = Object.create(context.Controller.prototype);
  Object.assign(instance, { settings: {}, _settingsWrites: Promise.resolve(), _saveRequest: 0, _applyStyles() {}, _showToast() {} });
  return { instance, indicator };
}

test('rapid preference changes persist in order and keep the latest chosen value', async () => {
  let release;
  let saved;
  let writes = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const { instance, indicator } = controller(async value => {
    writes++;
    if (writes === 1) await gate;
    saved = value.settings;
  });
  instance.settings.theme = 'light';
  const first = instance._saveSettings();
  instance.settings.theme = 'dark';
  const second = instance._saveSettings();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 1);
  assert.equal(indicator.dataset.state, 'saving');
  release();
  await Promise.all([first, second]);
  assert.equal(saved.theme, 'dark');
  assert.equal(writes, 2);
  assert.equal(indicator.dataset.state, 'saved');
});

test('a failed preference save is visible and a later change can recover', async () => {
  let attempts = 0;
  let saved;
  const { instance, indicator } = controller(async value => {
    if (++attempts === 1) throw new Error('Storage unavailable');
    saved = value.settings;
  });
  instance.settings.theme = 'light';
  await instance._saveSettings();
  assert.equal(indicator.dataset.state, 'error');
  instance.settings.theme = 'dark';
  await instance._saveSettings();
  assert.equal(saved.theme, 'dark');
  assert.equal(indicator.dataset.state, 'saved');
});
