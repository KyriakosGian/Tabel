import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const backgroundSource = readFileSync(
  new URL('../background.js', import.meta.url),
  'utf8'
);

function createHarness(options = {}) {
  let messageListener;
  let actionListener;
  const localData = {
    settings: { privacyNoticeVersion: 1 },
    ...((typeof options === 'object' && options.localData) || {})
  };
  const createTab = typeof options === 'function'
    ? options
    : options.createTab || (async () => ({ id: 1 }));

  const chrome = {
    action: { onClicked: { addListener(listener) { actionListener = listener; } } },
    i18n: {
      getMessage: () => 'Group',
      getUILanguage: () => 'en'
    },
    runtime: {
      id: 'test-extension-id',
      getURL: path => `chrome-extension://test-extension-id/${path}`,
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      },
      onStartup: { addListener() {} },
      sendMessage: async () => undefined
    },
    storage: {
      local: {
        get: async keys => {
          if (keys === null) return { ...localData };
          if (typeof keys === 'string') return { [keys]: localData[keys] };
          return { ...localData };
        },
        remove: async key => { delete localData[key]; },
        set: async values => { Object.assign(localData, values); }
      }
    },
    tabs: {
      create: createTab,
      move: async () => undefined,
      query: options.queryTabs || (async () => []),
      remove: options.removeTabs || (async () => undefined),
      update: async () => undefined
    },
    windows: { update: async () => undefined }
  };

  vm.runInNewContext(backgroundSource, {
    chrome,
    clearTimeout,
    console: { error() {}, warn() {} },
    Date,
    encodeURIComponent,
    Math,
    Promise,
    setTimeout,
    String
  });

  assert.equal(typeof messageListener, 'function');

  const dispatch = message => {
    let responded = false;
    let resolveResponse;
    const response = new Promise(resolve => {
      resolveResponse = resolve;
    });

    const keepChannelOpen = messageListener(message, {}, value => {
      responded = true;
      resolveResponse(value);
    });

    return {
      keepChannelOpen,
      response,
      hasResponded: () => responded
    };
  };

  return {
    dispatch,
    localData,
    clickAction: () => actionListener()
  };
}

test('OPEN_TAB responds only after Chrome confirms creation', async () => {
  let finishCreation;
  const { dispatch } = createHarness(() => new Promise(resolve => {
    finishCreation = () => resolve({ id: 41 });
  }));

  const request = dispatch({ type: 'OPEN_TAB', url: 'https://example.com', active: true });

  assert.equal(request.keepChannelOpen, true);
  await Promise.resolve();
  assert.equal(request.hasResponded(), false);

  finishCreation();
  const response = await request.response;
  assert.equal(response.success, true);
  assert.equal(response.tabId, 41);
});

test('OPEN_TAB reports a Chrome creation failure', async () => {
  const { dispatch } = createHarness(async () => {
    throw new Error('creation blocked');
  });

  const request = dispatch({ type: 'OPEN_TAB', url: 'https://example.com' });
  const response = await request.response;

  assert.equal(request.keepChannelOpen, true);
  assert.equal(response.success, false);
  assert.match(response.error, /creation blocked/);
});

test('OPEN_TABS confirms every tab and preserves the requested activation order', async () => {
  const calls = [];
  const { dispatch } = createHarness(async options => {
    calls.push(options);
    return { id: calls.length };
  });

  const request = dispatch({
    type: 'OPEN_TABS',
    urls: ['https://one.example', 'https://two.example']
  });
  const response = await request.response;

  assert.equal(request.keepChannelOpen, true);
  assert.equal(response.success, true);
  assert.deepEqual([...response.createdTabIds], [1, 2]);
  assert.equal(calls[0].active, true);
  assert.equal(calls[1].active, false);
});

test('OPEN_TABS reports partial creation instead of false success', async () => {
  let callCount = 0;
  const { dispatch } = createHarness(async () => {
    callCount += 1;
    if (callCount === 2) throw new Error('second tab blocked');
    return { id: 77 };
  });

  const request = dispatch({
    type: 'OPEN_TABS',
    urls: ['https://one.example', 'https://two.example']
  });
  const response = await request.response;

  assert.equal(response.success, false);
  assert.match(response.error, /second tab blocked/);
  assert.deepEqual([...response.createdTabIds], [77]);
});

test('sweep data remains persisted for the dashboard to process', async () => {
  const removedTabIds = [];
  const createdTabs = [];
  const openTabs = [
    { id: 11, url: 'https://one.example', title: 'One', favIconUrl: '' },
    { id: 12, url: 'https://two.example', title: 'Two', favIconUrl: '' }
  ];
  const harness = createHarness({
    createTab: async options => {
      createdTabs.push(options);
      return { id: 99 };
    },
    queryTabs: async query => query.currentWindow ? openTabs : [],
    removeTabs: async ids => { removedTabIds.push(...ids); }
  });

  await harness.clickAction();

  const pendingKeys = Object.keys(harness.localData)
    .filter(key => key.startsWith('tabel_pending_sweep_'));
  assert.equal(pendingKeys.length, 1);
  assert.deepEqual(removedTabIds, [11, 12]);
  assert.equal(createdTabs.length, 1);
  assert.equal(harness.localData[pendingKeys[0]].tabs.length, 2);
  assert.equal(pendingKeys[0] in harness.localData, true);
});

test('the action never reads browser tabs before privacy consent', async () => {
  let currentWindowQueries = 0;
  const createdTabs = [];
  const harness = createHarness({
    localData: { settings: { privacyNoticeVersion: 0 } },
    createTab: async options => {
      createdTabs.push(options);
      return { id: 99 };
    },
    queryTabs: async query => {
      if (query.currentWindow) currentWindowQueries += 1;
      return [];
    }
  });

  await harness.clickAction();

  assert.equal(currentWindowQueries, 0);
  assert.equal(createdTabs.length, 1);
  assert.equal(
    Object.keys(harness.localData).some(key => key.startsWith('tabel_pending_sweep_')),
    false
  );
});
