import test from 'node:test';
import assert from 'node:assert/strict';

import { createFaviconUrl } from '../dashboard/lib/favicon.js';

test('favicon URLs are derived from the saved page through Chrome', () => {
  const runtime = {
    getURL: path => `chrome-extension://test-extension-id${path}`
  };

  const result = new URL(createFaviconUrl(
    runtime,
    'https://example.com/path?a=1&b=2'
  ));

  assert.equal(result.origin, 'null');
  assert.equal(result.pathname, '/_favicon/');
  assert.equal(result.searchParams.get('pageUrl'), 'https://example.com/path?a=1&b=2');
  assert.equal(result.searchParams.get('size'), '32');
});
