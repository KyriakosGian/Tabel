import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.indexedDB = { open: () => ({}) };

const { db } = await import('../dashboard/lib/db.js');
const { SyncManager } = await import('../dashboard/lib/sync.js');

test('pushNow includes tombstones and writes a valid chunked snapshot', async () => {
  let written = null;
  let localWritten = null;
  let deletedKeys = [];
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ tabelDeviceId: 'device-test' }),
        set: async value => { localWritten = value; }
      },
      sync: {
        get: async () => ({}),
        set: async value => {
          assert.deepEqual(deletedKeys, []);
          written = value;
        },
        remove: async () => undefined
      }
    }
  };
  const deletionTime = Date.now();
  db.exportAll = async () => ({
    version: 4,
    groups: [],
    items: [],
    tombstones: [{
      key: 'item:t1',
      entityType: 'item',
      entityId: 't1',
      deletedAt: deletionTime
    }]
  });
  db.deleteTombstones = async keys => { deletedKeys = keys; };

  const manager = new SyncManager();
  const success = await manager.pushNow();
  const meta = written.tabel_sync_meta;
  let payload = '';
  for (let index = 0; index < meta.chunkCount; index++) {
    payload += written[`tabel_sync_chunk_${index}`];
  }
  const parsed = JSON.parse(payload);

  assert.equal(success, true);
  assert.equal(meta.deviceId, 'device-test');
  assert.equal(parsed.tombstones[0].entityId, 't1');
  assert.equal(
    written['tabel_sync_device_device-test'].acknowledgedThrough,
    deletionTime
  );
  assert.deepEqual(deletedKeys, []);
  assert.equal(
    Number.isFinite(localWritten.tabelSyncStatus.lastSuccessfulSyncAt),
    true
  );
  assert.equal(localWritten.tabelSyncStatus.operation, 'push');
});

test('pushNow reports storage failures', async () => {
  let errorKey = null;
  let deleteCalled = false;
  const oldDeletion = Date.now() - (91 * 24 * 60 * 60 * 1000);
  globalThis.chrome.storage.sync.get = async () => ({
    'tabel_sync_device_device-test': {
      deviceId: 'device-test',
      lastSeenAt: 1,
      acknowledgedThrough: oldDeletion
    }
  });
  globalThis.chrome.storage.sync.set = async () => {
    throw new Error('quota exceeded');
  };
  db.exportAll = async () => ({
    version: 4,
    groups: [],
    items: [],
    tombstones: [{
      key: 'item:t1',
      entityType: 'item',
      entityId: 't1',
      deletedAt: oldDeletion
    }]
  });
  db.deleteTombstones = async () => { deleteCalled = true; };

  const manager = new SyncManager({ onError: key => { errorKey = key; } });
  const originalConsoleError = console.error;
  console.error = () => {};
  let success;
  try {
    success = await manager.pushNow();
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(success, false);
  assert.equal(errorKey, 'syncQuotaError');
  assert.equal(deleteCalled, false);
});

test('pushNow removes only old tombstones acknowledged by every known device', async () => {
  let written = null;
  let deletedKeys = [];
  const oldDeletion = Date.now() - (91 * 24 * 60 * 60 * 1000);
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ tabelDeviceId: 'device-one' }),
        set: async () => undefined
      },
      sync: {
        get: async () => ({
          'tabel_sync_device_device-one': {
            deviceId: 'device-one',
            lastSeenAt: 1,
            acknowledgedThrough: oldDeletion
          },
          'tabel_sync_device_device-two': {
            deviceId: 'device-two',
            lastSeenAt: 1,
            acknowledgedThrough: oldDeletion
          }
        }),
        set: async value => {
          assert.deepEqual(deletedKeys, []);
          written = value;
        },
        remove: async () => undefined
      }
    }
  };
  db.exportAll = async () => ({
    version: 4,
    groups: [],
    items: [],
    tombstones: [{
      key: 'item:t1',
      entityType: 'item',
      entityId: 't1',
      deletedAt: oldDeletion
    }]
  });
  db.deleteTombstones = async keys => { deletedKeys = keys; };

  const manager = new SyncManager();
  const success = await manager.pushNow();
  const meta = written.tabel_sync_meta;
  let payload = '';
  for (let index = 0; index < meta.chunkCount; index++) {
    payload += written[`tabel_sync_chunk_${index}`];
  }

  assert.equal(success, true);
  assert.deepEqual(JSON.parse(payload).tombstones, []);
  assert.deepEqual(deletedKeys, ['item:t1']);
});

test('a legacy device blocks cleanup until it publishes an acknowledgement', async () => {
  let written = null;
  let deletedKeys = [];
  const oldDeletion = Date.now() - (91 * 24 * 60 * 60 * 1000);
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ tabelDeviceId: 'device-current' }),
        set: async () => undefined
      },
      sync: {
        get: async () => ({
          tabel_sync_meta: {
            deviceId: 'device-legacy',
            updatedAt: 10,
            chunkCount: 1,
            version: 3
          }
        }),
        set: async value => { written = value; },
        remove: async () => undefined
      }
    }
  };
  db.exportAll = async () => ({
    version: 4,
    groups: [],
    items: [],
    tombstones: [{
      key: 'group:g1',
      entityType: 'group',
      entityId: 'g1',
      deletedAt: oldDeletion
    }]
  });
  db.deleteTombstones = async keys => { deletedKeys = keys; };

  const manager = new SyncManager();
  await manager.pushNow();
  const meta = written.tabel_sync_meta;
  let payload = '';
  for (let index = 0; index < meta.chunkCount; index++) {
    payload += written[`tabel_sync_chunk_${index}`];
  }

  assert.equal(JSON.parse(payload).tombstones.length, 1);
  assert.deepEqual(deletedKeys, []);
  assert.equal(
    written['tabel_sync_device_device-legacy'].acknowledgedThrough,
    0
  );
  assert.equal(written['tabel_sync_device_device-legacy'].legacy, true);
});

test('pull acknowledges remote tombstones for the current device', async () => {
  let written = null;
  const deletionTime = Date.now();
  const remotePayload = JSON.stringify({
    groups: [],
    items: [],
    tombstones: [{
      key: 'item:t1',
      entityType: 'item',
      entityId: 't1',
      deletedAt: deletionTime
    }]
  });
  globalThis.chrome = {
    storage: {
      sync: {
        get: async () => ({
          tabel_sync_meta: {
            deviceId: 'device-remote',
            updatedAt: deletionTime,
            chunkCount: 1,
            version: 4
          },
          tabel_sync_chunk_0: remotePayload,
          'tabel_sync_device_device-remote': {
            deviceId: 'device-remote',
            lastSeenAt: deletionTime,
            acknowledgedThrough: deletionTime
          }
        }),
        set: async value => { written = value; }
      }
    }
  };
  db.mergeAll = async () => ({
    localOnlyCount: 0,
    remoteOnlyCount: 1,
    updatedCount: 0
  });
  db.exportAll = async () => ({
    version: 4,
    groups: [],
    items: [],
    tombstones: [{
      key: 'item:t1',
      entityType: 'item',
      entityId: 't1',
      deletedAt: deletionTime
    }]
  });

  const manager = new SyncManager();
  manager.deviceId = 'device-current';
  const hadRemote = await manager.pull();

  assert.equal(hadRemote, true);
  assert.equal(
    written['tabel_sync_device_device-current'].acknowledgedThrough,
    deletionTime
  );
});
