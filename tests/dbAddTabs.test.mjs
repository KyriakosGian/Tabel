import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.indexedDB = { open: () => ({}) };

const { db } = await import('../dashboard/lib/db.js');

test('database input deduplication keeps the newest incoming copy', () => {
  assert.deepEqual(db._dedupeTabsByUrl([
    { url: 'https://same.example', title: 'Older' },
    { url: 'https://same.example', title: 'Newer' }
  ]), [
    { url: 'https://same.example', title: 'Newer' }
  ]);
});

test('adding tabs to an existing group replaces older URLs and prepends the newest records', async () => {
  const inserted = [];
  const updates = [];
  const removals = [];

  db.getGroup = async () => ({ id: 'group-1', locked: false });
  db._getAll = async () => [
    { id: 'old-1', groupId: 'group-1', url: 'https://saved.example' },
    { id: 'keep-1', groupId: 'group-1', url: 'https://keep.example' }
  ];
  db._removeDuplicateUrls = async (urls, options) => {
    removals.push({ urls, options });
  };
  db.getTabsByGroup = async () => [
    { id: 'keep-1', groupId: 'group-1', url: 'https://keep.example', order: 0 }
  ];
  db._prependItems = async (groupId, tabs, currentTabs) => {
    inserted.push({ groupId, tabs, currentTabs });
  };
  db.updateGroup = async (groupId, update) => {
    updates.push({ groupId, update });
  };

  const result = await db.addTabsToGroup('group-1', [
    { url: 'https://saved.example', title: 'Newest saved' },
    { url: 'https://new.example', title: 'Older incoming' },
    { url: 'https://new.example', title: 'Newest incoming' }
  ]);

  assert.deepEqual(result, { addedCount: 2, replacedCount: 1 });
  assert.deepEqual(removals, [{
    urls: ['https://saved.example', 'https://new.example'],
    options: { preserveGroupId: 'group-1' }
  }]);
  assert.equal(inserted[0].groupId, 'group-1');
  assert.deepEqual(inserted[0].tabs, [
    { url: 'https://saved.example', title: 'Newest saved' },
    { url: 'https://new.example', title: 'Newest incoming' }
  ]);
  assert.deepEqual(inserted[0].currentTabs, [
    { id: 'keep-1', groupId: 'group-1', url: 'https://keep.example', order: 0 }
  ]);
  assert.deepEqual(updates[0], {
    groupId: 'group-1',
    update: { tabCount: 3 }
  });
});

test('locked groups reject new tabs', async () => {
  db.getGroup = async () => ({ id: 'group-locked', locked: true });

  await assert.rejects(
    db.addTabsToGroup('group-locked', [{ url: 'https://example.com' }]),
    /locked/
  );
});
