import test from 'node:test';
import assert from 'node:assert/strict';

import {
  closeCapturedTabs,
  filterCapturableTabs,
  findMostRecentTab,
  isCapturableUrl,
  toSavedTabRecords
} from '../dashboard/lib/tabCapture.js';

test('tab capture rejects browser and extension pages', () => {
  assert.equal(isCapturableUrl('https://example.com'), true);
  assert.equal(isCapturableUrl('file:///C:/notes.html'), true);
  assert.equal(isCapturableUrl('chrome://settings'), false);
  assert.equal(isCapturableUrl('chrome-extension://id/dashboard.html'), false);
  assert.equal(isCapturableUrl('edge://extensions'), false);
  assert.equal(isCapturableUrl('about:blank'), false);
  assert.equal(isCapturableUrl('javascript:alert(1)'), false);
  assert.equal(isCapturableUrl('data:text/html,test'), false);
});

test('pinned and audible filters keep every eligible browser tab', () => {
  const tabs = [
    { id: 1, url: 'https://one.example', pinned: false, audible: false },
    { id: 2, url: 'https://two.example', pinned: true, audible: false },
    { id: 3, url: 'https://three.example', pinned: false, audible: true },
    { id: 4, url: 'https://one.example', pinned: false, audible: false }
  ];

  assert.deepEqual(
    filterCapturableTabs(tabs, {
      includePinnedTabs: false,
      includeAudibleTabs: false
    }).map(tab => tab.id),
    [1, 4]
  );
  assert.deepEqual(
    filterCapturableTabs(tabs, {
      includePinnedTabs: true,
      includeAudibleTabs: true
    }).map(tab => tab.id),
    [1, 2, 3, 4]
  );
});

test('the most recently accessed eligible tab becomes the current capture', () => {
  const selected = findMostRecentTab([
    { id: 1, lastAccessed: 10, index: 0 },
    { id: 2, lastAccessed: 30, index: 1 },
    { id: 3, lastAccessed: 20, index: 2 }
  ]);

  assert.equal(selected.id, 2);
});

test('captured records store only title and URL', () => {
  assert.deepEqual(toSavedTabRecords([{
    id: 1,
    title: 'Example',
    url: 'https://example.com',
    favIconUrl: 'https://example.com/favicon.ico',
    pinned: true,
    audible: true
  }]), [{
    title: 'Example',
    url: 'https://example.com'
  }]);
});

test('duplicate captured URLs keep the most recently accessed tab', () => {
  assert.deepEqual(toSavedTabRecords([
    {
      id: 1,
      title: 'Older',
      url: 'https://example.com',
      lastAccessed: 10
    },
    {
      id: 2,
      title: 'Newer',
      url: 'https://example.com',
      lastAccessed: 20
    }
  ]), [{
    title: 'Newer',
    url: 'https://example.com'
  }]);
});

test('all selected browser tabs close only after the caller saves them', async () => {
  const removedIds = [];
  const result = await closeCapturedTabs({
    remove: async tabId => { removedIds.push(tabId); }
  }, [
    { id: 10, url: 'https://same.example' },
    { id: 11, url: 'https://same.example' },
    { id: 10, url: 'https://same.example' }
  ]);

  assert.deepEqual(removedIds, [10, 11]);
  assert.deepEqual(result, { requestedCount: 2, failedCount: 0 });
});

test('tab closing reports individual failures without hiding successful closes', async () => {
  const result = await closeCapturedTabs({
    remove: async tabId => {
      if (tabId === 11) throw new Error('already closed');
    }
  }, [{ id: 10 }, { id: 11 }]);

  assert.deepEqual(result, { requestedCount: 2, failedCount: 1 });
});
