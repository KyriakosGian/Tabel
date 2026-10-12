import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeTabRecord } from '../dashboard/lib/recordSanitizer.js';

test('legacy favicon URLs are removed without mutating the source record', () => {
  const original = {
    id: 't1',
    url: 'https://example.com',
    title: 'Example',
    favIconUrl: 'https://example.com/favicon.ico'
  };

  const sanitized = sanitizeTabRecord(original);

  assert.equal('favIconUrl' in sanitized, false);
  assert.equal(original.favIconUrl, 'https://example.com/favicon.ico');
  assert.equal(sanitized.url, original.url);
});

test('unused imported fields never enter tab storage or synchronization', () => {
  const original = { id: 't1', groupId: 'g1', url: 'https://example.com', title: 'Demo', unusedPayload: 'x'.repeat(100000) };
  const sanitized = sanitizeTabRecord(original);
  assert.equal('unusedPayload' in sanitized, false);
  assert.equal(sanitized.groupId, 'g1');
  assert.equal(original.unusedPayload.length, 100000);
});
