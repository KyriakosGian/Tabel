import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.indexedDB = { open: () => ({}) };

const { db } = await import('../dashboard/lib/db.js');
const { SyncManager } = await import('../dashboard/lib/sync.js');

test('pushNow includes tombstones and writes a valid chunked snapshot', async () => {
  let written = null;
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ tabelDeviceId: 'device-test' }),
        set: async () => undefined
      },
      sync: {
        get: async () => ({}),
        set: async value => { written = value; },
        remove: async () => undefined
      }
    }
  };
  db.exportAll = async () => ({
    version: 3,
    groups: [],
    items: [],
    tombstones: [{
      key: 'item:t1',
      entityType: 'item',
      entityId: 't1',
      deletedAt: 100
    }]
  });

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
});

test('pushNow reports storage failures', async () => {
  let errorKey = null;
  globalThis.chrome.storage.sync.set = async () => {
    throw new Error('quota exceeded');
  };
  db.exportAll = async () => ({ version: 3, groups: [], items: [], tombstones: [] });

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
});
