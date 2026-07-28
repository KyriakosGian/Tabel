import test from 'node:test';
import assert from 'node:assert/strict';
import { openSavedTab, openSavedTabs } from '../dashboard/lib/tabRestore.js';

test('openSavedTab returns only a confirmed success', async () => {
  const messages = [];
  const runtime = {
    async sendMessage(message) {
      messages.push(message);
      return { success: true, tabId: 9 };
    }
  };

  const response = await openSavedTab(runtime, 'https://example.com', true);

  assert.equal(response.tabId, 9);
  assert.deepEqual(messages, [{
    type: 'OPEN_TAB',
    url: 'https://example.com',
    active: true
  }]);
});

test('openSavedTab rejects an unsuccessful response', async () => {
  const runtime = {
    sendMessage: async () => ({ success: false, error: 'creation blocked' })
  };

  await assert.rejects(
    () => openSavedTab(runtime, 'https://example.com'),
    /creation blocked/
  );
});

test('openSavedTab can restore a link without focusing it', async () => {
  let sentMessage = null;
  const runtime = {
    sendMessage: async message => {
      sentMessage = message;
      return { success: true, tabId: 10 };
    }
  };

  await openSavedTab(runtime, 'https://example.com', false);

  assert.equal(sentMessage.active, false);
});

test('openSavedTabs rejects a missing confirmation', async () => {
  const runtime = { sendMessage: async () => undefined };

  await assert.rejects(
    () => openSavedTabs(runtime, ['https://example.com']),
    /did not confirm/
  );
});
