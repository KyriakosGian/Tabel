import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { db, memoryEnvironment, sampleData } from './helpers/syncHarness.mjs';
import { SyncManager } from '../dashboard/lib/sync.js';
import { checksum, collectionFingerprint, snapshotData, SyncError } from '../dashboard/lib/syncCommon.js';

function snapshot(data, generation = 'current') {
  const chunks = new SyncManager()._chunk(JSON.stringify(snapshotData(data)));
  return {
    tabel_sync_control: { schema: 2, generation: { id: generation, rank: 1 } },
    tabel_sync_meta: { deviceId: 'sender', chunkCount: chunks.length, generation, version: 5, snapshotId: crypto.randomUUID() },
    ...Object.fromEntries(chunks.map((chunk, index) => [`tabel_sync_chunk_${index}`, chunk]))
  };
}

test('a stale upload cannot overwrite a two-chunk import arriving during its merge', async () => {
  const imported = sampleData(39, 200);
  for (const item of imported.items) item.title += 'x'.repeat(180);
  const incoming = snapshot(imported, 'initial');
  assert.equal(incoming.tabel_sync_meta.chunkCount, 2);
  const env = memoryEnvironment(sampleData(1, 100), { cloud: snapshot(sampleData(1, 100), 'initial') });
  const merge = db.mergeAll;
  let delivered = false;
  db.mergeAll = async data => {
    const result = await merge(data);
    if (!delivered) {
      delivered = true;
      Object.assign(env.cloud, structuredClone(incoming));
    }
    return result;
  };
  const manager = new SyncManager();
  try {
    assert.equal(await manager.pushNow(), false);
    assert.equal(manager.lastError, 'syncChangedError');
    assert.deepEqual(env.cloud, incoming);
    assert.equal(env.writes.length, 0);
    assert.equal(await manager.pushNow(), true);
    assert.equal(env.data.items.length, 39);
    assert.equal(env.cloud.tabel_sync_meta.chunkCount, 2);
    assert.equal(env.local.tabelSyncStatus.error, null);
  } finally { manager.dispose(); }
});

test('missing chunks never leave a successful download status while an import is still arriving', async () => {
  const data = sampleData(39);
  for (const item of data.items) item.title += 'x'.repeat(180);
  const cloud = snapshot(data, 'initial');
  delete cloud.tabel_sync_chunk_1;
  const env = memoryEnvironment(sampleData(), { cloud });
  const manager = new SyncManager();
  try {
    assert.equal(await manager.pull(), false);
    assert.equal(manager.lastError, 'syncCloudBusy');
    assert.equal(env.local.tabelSyncStatus.error, 'syncCloudBusy');
    assert.equal(env.data.items.length, 1);
    assert.equal(env.writes.length, 0);
  } finally { manager.dispose(); }
});

test('cleanup from a smaller upload never removes chunks from a newer import', async () => {
  const previous = sampleData(39, 100);
  for (const item of previous.items) item.title += 'x'.repeat(180);
  const small = sampleData(1, 200);
  small.tombstones = previous.items.slice(1).map(item => ({
    key: `item:${item.id}`, entityType: 'item', entityId: item.id, deletedAt: 200
  }));
  const newer = snapshot({ ...previous, items: previous.items.map(item => ({ ...item, updatedAt: 300 })) }, 'initial');
  const env = memoryEnvironment(small, { cloud: snapshot(previous, 'initial') });
  const set = env.chrome.storage.sync.set;
  env.chrome.storage.sync.set = async values => {
    await set(values);
    if (values.tabel_sync_meta?.checksum) Object.assign(env.cloud, structuredClone(newer));
  };
  const manager = new SyncManager();
  try {
    assert.equal(await manager.pushNow(), true);
    assert.equal(env.writes.find(values => values.tabel_sync_meta?.checksum).tabel_sync_meta.chunkCount, 1);
    assert.equal(env.cloud.tabel_sync_meta.snapshotId, newer.tabel_sync_meta.snapshotId);
    assert.equal(env.cloud.tabel_sync_chunk_1, newer.tabel_sync_chunk_1);
    assert.equal(env.removals.length, 0);
  } finally { manager.dispose(); }
});

test('out-of-order modern reset keys retry without replacing local data or requiring a legacy upgrade', async () => {
  const data = sampleData();
  const cloud = snapshot(data);
  cloud.tabel_sync_meta.generation = 'previous';
  const env = memoryEnvironment(data, { cloud, local: {
    tabelSyncConfig: { provider: 'chrome', generations: { chrome: 'previous' } }
  } });
  const manager = new SyncManager();
  try {
    assert.equal(await manager.syncNow(), false);
    assert.equal(manager.lastError, 'syncCloudBusy');
    assert.ok(env.local.tabelSyncStatus.nextRetryAt > Date.now());
    await assert.rejects(manager.adoptCloud(), { code: 'syncCloudBusy' });
    assert.deepEqual(snapshotData(env.data), snapshotData(data));
    assert.equal(env.writes.length, 0);
    env.cloud.tabel_sync_meta.generation = 'current';
    await manager.adoptCloud();
    assert.equal(await manager.syncNow(), true);
  } finally { manager.dispose(); }
});

test('a genuine reset still fences old local records after all keys arrive', async () => {
  const remote = sampleData();
  remote.items[0].id = 'remote';
  const env = memoryEnvironment(sampleData(), { cloud: snapshot(remote), local: {
    tabelSyncConfig: { provider: 'chrome', generations: { chrome: 'previous' } }
  } });
  const manager = new SyncManager();
  try {
    assert.equal(await manager.syncNow(), false);
    assert.equal(manager.lastError, 'syncResetRequired');
    assert.equal(env.data.items[0].id, 't0');
    assert.equal(env.writes.length, 0);
  } finally { manager.dispose(); }
});

test('a legacy snapshot without a reset marker cannot bypass reset protection', async () => {
  const cloud = snapshot(sampleData());
  delete cloud.tabel_sync_meta.generation;
  const env = memoryEnvironment(sampleData(), { cloud });
  const manager = new SyncManager();
  try {
    await assert.rejects(manager.adoptCloud(), { code: 'syncLegacyClientError' });
    assert.equal(env.writes.length, 0);
  } finally { manager.dispose(); }
});

test('a coherent download unblocks automatic uploads after a transient legacy error', async () => {
  const data = sampleData();
  const env = memoryEnvironment(data, { cloud: snapshot(data), local: {
    tabelSyncConfig: { provider: 'chrome', generations: { chrome: 'current' } },
    tabelSyncStatus: {
      pending: true, error: 'syncLegacyClientError', errorOperation: 'push',
      failedFingerprint: await checksum(snapshotData(data))
    }
  } });
  const manager = new SyncManager();
  try {
    assert.equal(await manager.syncNow({ automatic: true }), true);
    assert.equal(env.local.tabelSyncStatus.error, null);
    assert.ok(env.writes.some(values => values.tabel_sync_meta?.checksum));
  } finally { manager.dispose(); }
});

test('a successful local write does not imply delivery to a disconnected device', async () => {
  memoryEnvironment(sampleData());
  const manager = new SyncManager();
  try {
    assert.equal(await manager.syncNow(), true);
    assert.equal((await manager.diagnostics()).remoteReceiptCount, 0);
  } finally { manager.dispose(); }
});

test('two device replicas confirm receipt only after actual data and acknowledgement delivery', async () => {
  const sender = memoryEnvironment(sampleData(39), { local: { tabelDeviceId: 'sender' } });
  const first = new SyncManager();
  const second = new SyncManager();
  try {
    assert.equal(await first.pushNow(), true);
    assert.equal((await first.diagnostics()).remoteReceiptCount, 0);
    const receiver = memoryEnvironment({ groups: [], items: [], tombstones: [] }, {
      cloud: sender.cloud, local: { tabelDeviceId: 'receiver' }
    });
    assert.equal(await second.pull(), true);
    assert.equal(receiver.data.items.length, 39);
    const receiptKey = 'tabel_sync_device_receiver';
    assert.equal(receiver.cloud[receiptKey].receivedFingerprint, await collectionFingerprint(sender.data));
    sender.activate();
    assert.equal((await first.diagnostics()).remoteReceiptCount, 0);
    sender.cloud[receiptKey] = structuredClone(receiver.cloud[receiptKey]);
    assert.equal((await first.diagnostics()).remoteReceiptCount, 1);
    sender.data.items[0].title = 'Changed after acknowledgement';
    assert.equal((await first.diagnostics()).remoteReceiptCount, 0);
  } finally { first.dispose(); second.dispose(); }
});

test('receipt comparison ignores record order but rejects receipts for another reset generation', async () => {
  const data = sampleData(12);
  const reordered = structuredClone(data);
  reordered.items.reverse();
  assert.equal(await collectionFingerprint(data), await collectionFingerprint(reordered));
  const env = memoryEnvironment(data, { cloud: snapshot(data), local: {
    tabelSyncConfig: { provider: 'chrome', generations: { chrome: 'current' } }
  } });
  env.cloud.tabel_sync_device_other = {
    deviceId: 'other', receivedFingerprint: await collectionFingerprint(data), receivedGeneration: 'previous'
  };
  const manager = new SyncManager();
  try { assert.equal((await manager.diagnostics()).remoteReceiptCount, 0); }
  finally { manager.dispose(); }
});

test('cloud adoption does not show success when its subsequent upload fails', async () => {
  const source = readFileSync(new URL('../options/options.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\s*$/gm, '')
    .replace('new OptionsController();', 'globalThis.Controller = OptionsController;');
  const context = { SyncError, chrome: { i18n: { getMessage: key => key } }, confirmAction: async () => true };
  vm.runInNewContext(source, context);
  let adopted = false;
  let showedSuccess = false;
  const controller = Object.create(context.Controller.prototype);
  controller.sync = {
    previewRecovery: async () => ({ local: sampleData(), cloud: sampleData(), cloudState: 'reviewed' }),
    adoptCloud: async () => { adopted = true; }, lastError: 'syncRateError'
  };
  controller._syncDataAndRefresh = async () => false;
  controller._showToast = () => { showedSuccess = true; };
  await assert.rejects(controller._adoptCloud(), { code: 'syncRateError' });
  assert.equal(adopted, true);
  assert.equal(showedSuccess, false);
});

test('remote changes wake a fresh background worker without a dashboard or alarm', async () => {
  const source = readFileSync(new URL('../background-worker.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\s*$/gm, '');
  let onChange;
  let initialized = 0;
  let scheduled = 0;
  class Manager {
    deviceId = 'local';
    async init() { initialized++; }
    schedulePull() { scheduled++; }
  }
  const context = {
    SyncManager: Manager, SYNC_CONFIG_KEY: 'config', SYNC_META_KEY: 'meta',
    SYNC_CONTROL_KEY: 'control', CHUNK_PREFIX: 'chunk_', hasPrivacyConsent: () => true,
    chrome: {
      storage: { local: { get: async () => ({ settings: {} }) }, onChanged: {
        addListener: callback => { onChange = callback; }
      } },
      runtime: { onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
      alarms: { onAlarm: { addListener() {} } }
    }
  };
  vm.runInNewContext(source, context);
  onChange({ meta: { newValue: { deviceId: 'remote' } } }, 'sync');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(initialized, 1);
  assert.equal(scheduled, 1);
  onChange({ meta: { newValue: { deviceId: 'local' } } }, 'sync');
  onChange({ tabel_sync_device_other: {} }, 'sync');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduled, 1);
});
