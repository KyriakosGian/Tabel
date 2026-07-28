import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPrunableTombstoneKeys,
  maxDeletedAt,
  TOMBSTONE_RETENTION_MS
} from '../dashboard/lib/tombstoneCleanup.js';

const now = 1_000_000_000_000;
const oldDeletion = now - TOMBSTONE_RETENTION_MS - 1;
const recentDeletion = now - TOMBSTONE_RETENTION_MS + 1;

function tombstone(key, deletedAt) {
  const [entityType, entityId] = key.split(':');
  return { key, entityType, entityId, deletedAt };
}

test('old tombstones are pruned only after every known device acknowledges them', () => {
  const tombstones = [tombstone('item:t1', oldDeletion)];
  const devices = [
    { deviceId: 'one', acknowledgedThrough: oldDeletion },
    { deviceId: 'two', acknowledgedThrough: oldDeletion }
  ];

  assert.deepEqual(
    getPrunableTombstoneKeys(tombstones, devices, { now }),
    ['item:t1']
  );

  devices[1].acknowledgedThrough = oldDeletion - 1;
  assert.deepEqual(
    getPrunableTombstoneKeys(tombstones, devices, { now }),
    []
  );
});

test('recent tombstones remain even when every device has acknowledged them', () => {
  const tombstones = [tombstone('group:g1', recentDeletion)];
  const devices = [
    { deviceId: 'one', acknowledgedThrough: recentDeletion },
    { deviceId: 'two', acknowledgedThrough: recentDeletion }
  ];

  assert.deepEqual(
    getPrunableTombstoneKeys(tombstones, devices, { now }),
    []
  );
});

test('cleanup is disabled when no known device state exists', () => {
  assert.deepEqual(
    getPrunableTombstoneKeys(
      [tombstone('item:t1', oldDeletion)],
      [],
      { now }
    ),
    []
  );
});

test('acknowledgements can prune older deletions while retaining newer ones', () => {
  const oldest = oldDeletion - 100;
  const newer = oldDeletion + 100;
  const tombstones = [
    tombstone('item:old', oldest),
    tombstone('item:newer', newer)
  ];
  const devices = [
    { deviceId: 'one', acknowledgedThrough: newer },
    { deviceId: 'two', acknowledgedThrough: oldest }
  ];

  assert.deepEqual(
    getPrunableTombstoneKeys(tombstones, devices, { now }),
    ['item:old']
  );
});

test('maximum deletion timestamp ignores invalid tombstones', () => {
  assert.equal(maxDeletedAt([
    tombstone('item:t1', 100),
    tombstone('item:t2', 300),
    { key: 'item:invalid', deletedAt: 'invalid' }
  ]), 300);
});
