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
  let contextMenuListener;
  let installedListener;
  const contextMenuItems = [];
  const localData = {
    settings: { privacyNoticeVersion: 1 },
    ...((typeof options === 'object' && options.localData) || {})
  };
  const createTab = typeof options === 'function'
    ? options
    : options.createTab || (async () => ({ id: 1 }));

  const chrome = {
    action: { onClicked: { addListener(listener) { actionListener = listener; } } },
    contextMenus: {
      create(item) { contextMenuItems.push(item); },
      onClicked: {
        addListener(listener) {
          contextMenuListener = listener;
        }
      },
      removeAll: async () => { contextMenuItems.length = 0; }
    },
    i18n: {
      getMessage: () => 'Group',
      getUILanguage: () => 'en'
    },
    runtime: {
      id: 'test-extension-id',
      getURL: path => `chrome-extension://test-extension-id/${path}`,
      onInstalled: {
        addListener(listener) {
          installedListener = listener;
        }
      },
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
    Intl,
    Promise,
    setTimeout,
    String,
    URL
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
    clickAction: () => actionListener(),
    clickContextMenu: (info, tab) => contextMenuListener(info, tab),
    contextMenuItems,
    install: details => installedListener(details)
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

test('restore messages reject executable and internal URLs', async () => {
  let createCalls = 0;
  const { dispatch } = createHarness(async () => {
    createCalls += 1;
    return { id: 1 };
  });

  for (const message of [
    { type: 'OPEN_TAB', url: 'javascript:alert(1)' },
    { type: 'OPEN_TAB', url: 'chrome://settings' },
    { type: 'OPEN_TABS', urls: ['https://example.com', 'data:text/html,test'] }
  ]) {
    const response = await dispatch(message).response;
    assert.equal(response.success, false);
    assert.match(response.error, /Unsupported/);
  }
  assert.equal(createCalls, 0);
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
  assert.equal('favIconUrl' in harness.localData[pendingKeys[0]].tabs[0], false);
  assert.equal(pendingKeys[0] in harness.localData, true);
});

test('a sweep closes duplicate browser tabs but stores only the newest URL record', async () => {
  const removedTabIds = [];
  const openTabs = [
    {
      id: 21,
      url: 'https://same.example',
      title: 'Older title',
      lastAccessed: 10
    },
    {
      id: 22,
      url: 'https://same.example',
      title: 'Newer title',
      lastAccessed: 20
    }
  ];
  const harness = createHarness({
    queryTabs: async query => query.currentWindow ? openTabs : [],
    removeTabs: async ids => { removedTabIds.push(...ids); }
  });

  await harness.clickAction();

  const pending = Object.values(harness.localData)
    .find(value => value?.id?.startsWith('sweep_'));
  assert.deepEqual(removedTabIds, [21, 22]);
  assert.equal(pending.tabs.length, 1);
  assert.equal(pending.tabs[0].title, 'Newer title');
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

test('Save this link builds a group submenu and keeps the current page focused', async () => {
  const createdTabs = [];
  const harness = createHarness({
    localData: {
      settings: { privacyNoticeVersion: 1 },
      tabelContextMenuGroups: [
        { id: 'group-one', name: 'Group One', locked: false, order: 0 },
        { id: 'group-locked', name: 'Locked Group', locked: true, order: 1 }
      ]
    },
    createTab: async options => {
      createdTabs.push(options);
      return { id: 90 };
    }
  });

  await harness.install({ reason: 'update' });
  assert.deepEqual(
    harness.contextMenuItems.map(item => item.id),
    [
      'tabel-save-tab',
      'tabel-save-link',
      'tabel-save-link-new',
      'tabel-save-link-group:group-one',
      'tabel-save-link-group:group-locked'
    ]
  );
  assert.equal(
    harness.contextMenuItems.find(item => item.id === 'tabel-save-link-new').parentId,
    'tabel-save-link'
  );
  assert.equal(
    harness.contextMenuItems.find(item => item.id === 'tabel-save-link-group:group-locked').enabled,
    false
  );

  await harness.clickContextMenu({
    menuItemId: 'tabel-save-link-new',
    linkUrl: 'https://example.com/article'
  }, {
    id: 12,
    url: 'https://source.example',
    title: 'Source'
  });

  const pending = Object.values(harness.localData)
    .find(value => value?.source === 'contextMenu');
  assert.equal(pending.tabs[0].url, 'https://example.com/article');
  assert.equal(pending.tabs[0].title, 'example.com');
  assert.equal('destinationGroupId' in pending, false);
  assert.equal(createdTabs.length, 1);
  assert.equal(createdTabs[0].active, false);
});

test('Save this link can target an existing group', async () => {
  const harness = createHarness({
    localData: {
      settings: { privacyNoticeVersion: 1 },
      tabelContextMenuGroups: [
        { id: 'group-one', name: 'Group One', locked: false, order: 0 }
      ]
    }
  });

  await harness.install({ reason: 'update' });
  await harness.clickContextMenu({
    menuItemId: 'tabel-save-link-group:group-one',
    linkUrl: 'https://example.com/article'
  }, {
    id: 12,
    url: 'https://source.example',
    title: 'Source'
  });

  const pending = Object.values(harness.localData)
    .find(value => value?.source === 'contextMenu');
  assert.equal(pending.destinationGroupId, 'group-one');
});

test('context menus require privacy consent and reject script links', async () => {
  const harness = createHarness({
    localData: { settings: { privacyNoticeVersion: 0 } }
  });

  await harness.clickContextMenu({
    menuItemId: 'tabel-save-link-new',
    linkUrl: 'https://example.com'
  }, {
    id: 12,
    url: 'https://source.example',
    title: 'Source'
  });

  assert.equal(
    Object.values(harness.localData).some(value => value?.source === 'contextMenu'),
    false
  );

  harness.localData.settings.privacyNoticeVersion = 1;
  await harness.clickContextMenu({
    menuItemId: 'tabel-save-link-new',
    linkUrl: 'javascript:alert(1)'
  }, {
    id: 12,
    url: 'https://source.example',
    title: 'Source'
  });

  assert.equal(
    Object.values(harness.localData).some(value => value?.source === 'contextMenu'),
    false
  );
});
