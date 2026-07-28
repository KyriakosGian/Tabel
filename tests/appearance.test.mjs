import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPEARANCE_DEFAULTS,
  normalizeAppearance,
  resolveTheme
} from '../dashboard/lib/appearance.js';

test('appearance defaults use system theme, comfortable density, and hidden URLs', () => {
  assert.equal(APPEARANCE_DEFAULTS.theme, 'system');
  assert.equal(APPEARANCE_DEFAULTS.density, 'comfortable');
  assert.equal(APPEARANCE_DEFAULTS.defaultGroupWidth, 50);
  assert.equal(APPEARANCE_DEFAULTS.tabUrlMode, 'hidden');
});

test('invalid appearance values are normalized to safe defaults', () => {
  const normalized = normalizeAppearance({
    theme: 'invalid',
    density: 'tiny',
    defaultGroupWidth: 75,
    tabUrlMode: 'path',
    fontScale: 500,
    faviconSize: 1,
    customCardOpacity: -10
  });

  assert.equal(normalized.theme, 'system');
  assert.equal(normalized.density, 'comfortable');
  assert.equal(normalized.defaultGroupWidth, 50);
  assert.equal(normalized.tabUrlMode, 'hidden');
  assert.equal(normalized.fontScale, 125);
  assert.equal(normalized.faviconSize, 12);
  assert.equal(normalized.customCardOpacity, 10);
});

test('system theme follows the current operating system preference', () => {
  assert.equal(resolveTheme('system', true), 'light');
  assert.equal(resolveTheme('system', false), 'dark');
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme('light', false), 'light');
});
