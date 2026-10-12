import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.indexedDB = { open: () => ({}) };
const { db } = await import('../dashboard/lib/db.js');

function memorySnapshot(initial) {
  let saved = structuredClone(initial);
  db._editSnapshot = async transform => {
    const edited = transform(structuredClone(saved));
    saved = edited.data;
    return edited.result;
  };
  return () => saved;
}

test('capture replaces duplicates and prepends tabs in one commit', async () => {
  const saved = memorySnapshot({
    groups: [{ id: 'g1', locked: false }, { id: 'g2', locked: false }],
    items: [
      { id: 'old', groupId: 'g2', url: 'https://same.example', order: 0 },
      { id: 'keep', groupId: 'g1', url: 'https://keep.example', order: 0 }
    ], tombstones: []
  });
  const result = await db.addTabsToGroup('g1', [
    { url: 'https://same.example', title: 'Older' },
    { url: 'https://same.example', title: 'Newest' }
  ]);
  assert.deepEqual(result, { addedCount: 1, replacedCount: 1 });
  assert.equal(saved().groups.length, 1);
  assert.equal(saved().groups[0].tabCount, 2);
  assert.equal(saved().items.find(item => item.id === 'keep').order, 1);
  assert.equal(saved().items.find(item => item.url === 'https://same.example').title, 'Newest');
  assert.equal(saved().items.find(item => item.url === 'https://same.example').id, 'old');
  assert.equal(saved().tombstones.some(record => record.key === 'item:old'), false);
  assert.ok(saved().tombstones.some(record => record.key === 'group:g2'));
});

test('repeated capture of the same URL keeps its id without growing deletion history', async () => {
  const saved = memorySnapshot({
    groups: [{ id: 'g1', locked: false }],
    items: [{ id: 'existing', groupId: 'g1', url: 'https://same.example', title: 'Original', order: 0, createdAt: 10, updatedAt: 20 }],
    tombstones: []
  });
  for (let count = 0; count < 40; count++) {
    await db.addTabsToGroup('g1', [{ url: 'https://same.example', title: `Capture ${count}` }]);
  }
  assert.equal(saved().items.length, 1);
  assert.equal(saved().items[0].id, 'existing');
  assert.equal(saved().items[0].createdAt, 10);
  assert.equal(saved().items[0].title, 'Capture 39');
  assert.equal(saved().tombstones.length, 0);
});

test('locked destinations leave the snapshot unchanged', async () => {
  const initial = { groups: [{ id: 'g1', locked: true }], items: [], tombstones: [] };
  const saved = memorySnapshot(initial);
  await assert.rejects(db.addTabsToGroup('g1', [{ url: 'https://example.com' }]), /locked/);
  assert.deepEqual(saved(), initial);
});

test('repeated pending capture does not duplicate a committed group', async () => {
  const saved = memorySnapshot({ groups: [], items: [], tombstones: [] });
  const tabs = [{ url: 'https://example.com', title: 'Example' }];
  const first = await db.createGroup('Example', tabs, { sourceSweepId: 'sweep_test' });
  const second = await db.createGroup('Example', tabs, { sourceSweepId: 'sweep_test' });
  assert.equal(first.id, second.id);
  assert.equal(saved().groups.length, 1);
  assert.equal(saved().items.length, 1);
});
