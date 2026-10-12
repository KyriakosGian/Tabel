import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedData, getDeviceId, readConfig, syncErrorCode, updateConfig } from '../dashboard/lib/syncCommon.js';

test('unsupported providers stay local and obsolete settings are discarded on update', async () => {
  const values = { tabelSyncConfig: {
    provider: 'retired-provider', generations: { chrome: 'current', retired: 'obsolete' },
    chromeEstablished: true, chromeRecovery: { id: 'resume', backupId: 'backup' }, unusedAccount: { id: 'old' }
  } };
  const storage = { get: async () => values, set: async updates => Object.assign(values, updates) };
  assert.deepEqual(await readConfig(storage), {
    provider: 'local', generations: { chrome: 'current' }, chromeEstablished: true,
    chromeRecovery: { id: 'resume', backupId: 'backup' }
  });
  await updateConfig({ provider: 'chrome' }, storage);
  assert.equal(values.tabelSyncConfig.unusedAccount, undefined);
  assert.deepEqual(values.tabelSyncConfig.generations, { chrome: 'current' });
  assert.equal((await readConfig({ get: async () => ({}) })).provider, 'chrome');
});

test('write-rate errors are distinct from storage-capacity errors', () => {
  assert.equal(syncErrorCode(new Error('MAX_WRITE_OPERATIONS_PER_HOUR quota exceeded')), 'syncRateError');
  assert.equal(syncErrorCode(new Error('QUOTA_BYTES quota exceeded')), 'syncCapacityError');
});

test('parallel page initialization creates only one stable device id', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const queues = new Map();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request(name, callback) {
      const result = (queues.get(name) || Promise.resolve()).then(callback);
      queues.set(name, result.catch(() => {}));
      return result;
    }
  } } });
  try {
    const values = {};
    let writes = 0;
    const storage = {
      get: async () => { await Promise.resolve(); return { ...values }; },
      set: async update => { await Promise.resolve(); Object.assign(values, update); writes++; }
    };
    const ids = await Promise.all(Array.from({ length: 20 }, () => getDeviceId(storage)));
    assert.equal(new Set(ids).size, 1);
    assert.equal(writes, 1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

test('cloud decoding retains supported fields and discards unused payloads', () => {
  const result = checkedData(JSON.stringify({
    groups: [{ id: 'g1', name: 'Demo', unused: 'x'.repeat(10000) }],
    items: [{ id: 't1', groupId: 'g1', url: 'https://example.com', title: 'Demo', unused: 'x'.repeat(10000) }],
    tombstones: []
  }));
  assert.equal(result.groups[0].unused, undefined);
  assert.equal(result.items[0].unused, undefined);
  assert.equal(result.items[0].url, 'https://example.com');
});
