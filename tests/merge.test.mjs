import test from 'node:test';
import assert from 'node:assert/strict';
import { createTombstone, mergeSyncData } from '../dashboard/lib/merge.js';

function data(groups = [], items = [], tombstones = []) {
  return { groups, items, tombstones };
}

test('newer remote records update local data', () => {
  const local = data([{ id: 'g1', name: 'Local', createdAt: 10, updatedAt: 20 }]);
  const remote = data([{ id: 'g1', name: 'Remote', createdAt: 10, updatedAt: 30 }]);

  const merged = mergeSyncData(local, remote);

  assert.equal(merged.groups[0].name, 'Remote');
  assert.equal(merged.remoteOnlyCount, 1);
  assert.equal(merged.localOnlyCount, 0);
});

test('a newer tombstone propagates deletion across devices', () => {
  const record = { id: 't1', groupId: 'g1', url: 'https://example.com', createdAt: 10, updatedAt: 20 };
  const deletion = createTombstone('item', 't1', 30);

  const firstMerge = mergeSyncData(data([], [], [deletion]), data([], [record]));
  assert.equal(firstMerge.items.length, 0);
  assert.equal(firstMerge.tombstones[0].entityId, 't1');
  assert.equal(firstMerge.localOnlyCount, 1);

  const secondMerge = mergeSyncData(data([], [record]), firstMerge);
  assert.equal(secondMerge.items.length, 0);
  assert.equal(secondMerge.remoteOnlyCount, 1);
});

test('a newer record can intentionally replace an older tombstone', () => {
  const deletion = createTombstone('group', 'g1', 20);
  const restored = { id: 'g1', name: 'Restored', createdAt: 10, updatedAt: 30 };

  const merged = mergeSyncData(data([], [], [deletion]), data([restored]));

  assert.equal(merged.groups[0].name, 'Restored');
  assert.equal(merged.tombstones.length, 0);
});

test('updated tab location and order converge on the newest timestamp', () => {
  const groups = [
    { id: 'g1', createdAt: 10, updatedAt: 20 },
    { id: 'g2', createdAt: 10, updatedAt: 20 }
  ];
  const oldTab = { id: 't1', groupId: 'g1', order: 0, createdAt: 10, updatedAt: 20 };
  const movedTab = { ...oldTab, groupId: 'g2', order: 3, updatedAt: 40 };

  const merged = mergeSyncData(data(groups, [oldTab]), data(groups, [movedTab]));

  assert.equal(merged.items[0].groupId, 'g2');
  assert.equal(merged.items[0].order, 3);
});

test('group deletion also removes orphaned child items', () => {
  const groupDeletion = createTombstone('group', 'g1', 30);
  const remoteGroup = { id: 'g1', createdAt: 10, updatedAt: 20 };
  const remoteItem = { id: 't1', groupId: 'g1', createdAt: 10, updatedAt: 40 };

  const merged = mergeSyncData(
    data([], [], [groupDeletion]),
    data([remoteGroup], [remoteItem])
  );

  assert.equal(merged.groups.length, 0);
  assert.equal(merged.items.length, 0);
  assert.equal(merged.tombstones.some(t => t.key === 'item:t1'), true);
});
