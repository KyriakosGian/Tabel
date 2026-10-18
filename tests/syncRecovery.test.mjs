import test from 'node:test';
import assert from 'node:assert/strict';
import { db, memoryEnvironment, sampleData } from './helpers/syncHarness.mjs';
import { SyncManager } from '../dashboard/lib/sync.js';
import { createTombstone } from '../dashboard/lib/merge.js';
import { checksum, snapshotData, storageBytes } from '../dashboard/lib/syncCommon.js';

function legacySnapshot(data, deviceId = 'device-old') {
  const manager = new SyncManager();
  const chunks = manager._chunk(JSON.stringify(snapshotData(data)));
  return {
    tabel_sync_meta: { deviceId, updatedAt: 10, chunkCount: chunks.length, version: 4 },
    [`tabel_sync_device_${deviceId}`]: { deviceId, lastSeenAt: 10, acknowledgedThrough: 0 },
    ...Object.fromEntries(chunks.map((chunk, index) => [`tabel_sync_chunk_${index}`, chunk]))
  };
}

function nearFullFixture() {
  const time = Date.now() - 1000;
  const old = sampleData(30, time);
  for (const item of old.items) item.url += `?q=${'a'.repeat(3000)}`;
  let cloud = legacySnapshot(old);
  old.items[0].title += 'a'.repeat(102390 - storageBytes(cloud));
  cloud = legacySnapshot(old);
  old.items[0].title = old.items[0].title.slice(0, old.items[0].title.length - (storageBytes(cloud) - 102390));
  cloud = legacySnapshot(old);
  const local = structuredClone(old);
  local.groups[0].updatedAt = time + 500;
  local.groups[0].tabCount = 1;
  local.items = [{ ...local.items[0], title: 'New', url: `https://example.com/new?q=${'b'.repeat(6000)}`, updatedAt: time + 500 }];
  local.tombstones = old.items.slice(1).map(item => createTombstone('item', item.id, time + 500));
  const chunkBytes = data => {
    const all = legacySnapshot(data);
    return storageBytes(Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith('tabel_sync_chunk_'))));
  };
  local.items[0].title += 'b'.repeat(15980 - chunkBytes(local));
  const adjustment = chunkBytes(local) - 15980;
  if (adjustment > 0) local.items[0].title = local.items[0].title.slice(0, -adjustment);
  assert.ok(storageBytes(cloud) <= 102400);
  return { cloud, local };
}

test('near-full Chrome Sync safely shrinks a snapshot before adding metadata', async () => {
  const fixture = nearFullFixture();
  const env = memoryEnvironment(fixture.local, { cloud: fixture.cloud });
  const manager = new SyncManager();
  assert.equal(await manager.pushNow(), true);
  assert.equal(env.cloud.tabel_sync_meta.chunkCount, 2);
  assert.ok(env.writes.some(values => values.tabel_sync_meta?.chunkCount === 0));
  assert.equal(env.backups.size, 1);
  assert.ok(storageBytes(env.cloud) < 20000);
  assert.equal(env.local.tabelSyncConfig.chromeRecovery, null);
  assert.equal(env.local.tabelSyncStatus.pending, false);
  assert.equal(env.data.items.length, 1);
  manager.dispose();
});

test('interrupted quota recovery resumes after recreating the manager', async () => {
  const fixture = nearFullFixture();
  const env = memoryEnvironment(fixture.local, { cloud: fixture.cloud });
  let interrupted = false;
  env.failSet = values => {
    if (values.tabel_sync_meta?.checksum && !interrupted) {
      interrupted = true;
      throw new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded');
    }
  };
  const first = new SyncManager();
  assert.equal(await first.pushNow(), false);
  assert.equal(first.lastError, 'syncRateError');
  assert.ok(env.local.tabelSyncConfig.chromeRecovery);
  assert.equal(env.cloud.tabel_sync_meta.chunkCount, 0);
  first.dispose();
  env.failSet = null;
  const reopened = new SyncManager();
  assert.equal(await reopened.pushNow(), true);
  assert.equal(env.local.tabelSyncConfig.chromeRecovery, null);
  assert.equal(env.data.items.length, 1);
  reopened.dispose();
});

test('quota recovery never invalidates a newer snapshot received while saving its backup', async () => {
  const fixture = nearFullFixture();
  const env = memoryEnvironment(fixture.local, { cloud: fixture.cloud });
  const saveBackup = db.saveBackup;
  db.saveBackup = async backup => {
    await saveBackup(backup);
    env.cloud.tabel_sync_meta.updatedAt++;
  };
  const manager = new SyncManager();
  try {
    assert.equal(await manager.pushNow(), false);
    assert.equal(manager.lastError, 'syncChangedError');
    assert.equal(env.cloud.tabel_sync_meta.chunkCount, fixture.cloud.tabel_sync_meta.chunkCount);
    assert.equal(env.writes.length, 0);
    assert.equal(env.removals.length, 0);
    assert.equal(await manager.pushNow(), true);
    assert.equal(env.data.items.length, 1);
  } finally { manager.dispose(); }
});

test('a final snapshot over quota leaves the previous cloud intact', async () => {
  const old = sampleData();
  const data = sampleData(30);
  for (const item of data.items) item.url += 'x'.repeat(4000);
  const cloud = legacySnapshot(old);
  const env = memoryEnvironment(data, { cloud });
  const manager = new SyncManager();
  assert.equal(await manager.pushNow(), false);
  assert.equal(manager.lastError, 'syncCapacityError');
  assert.deepEqual(env.cloud, cloud);
  assert.equal(env.removals.length, 0);
  assert.equal(env.data.items.length, 30);
  manager.dispose();
});

test('cloud corruption never merges or overwrites local records', async () => {
  const original = sampleData();
  const cloud = legacySnapshot(original);
  cloud.tabel_sync_meta.checksum = 'invalid';
  const env = memoryEnvironment(original, { cloud });
  const manager = new SyncManager();
  assert.equal(await manager.syncNow(), false);
  assert.equal(manager.lastError, 'syncIntegrityError');
  assert.deepEqual(snapshotData(env.data), snapshotData(original));
  assert.equal(env.writes.length, 0);
  manager.dispose();
});

test('a reset fences stale installations until explicit cloud adoption', async () => {
  const remote = sampleData(1, 100);
  remote.items[0].id = 'cloud-only';
  const local = sampleData(1, 200);
  const cloud = legacySnapshot(remote);
  cloud.tabel_sync_control = { schema: 2, generation: { id: 'new-generation', rank: 1 } };
  cloud.tabel_sync_meta.generation = 'new-generation';
  const env = memoryEnvironment(local, { cloud, local: { tabelSyncConfig: { provider: 'chrome', generations: { chrome: 'initial' } } } });
  const manager = new SyncManager();
  assert.equal(await manager.syncNow(), false);
  assert.equal(manager.lastError, 'syncResetRequired');
  assert.equal(env.data.items[0].id, 't0');
  assert.equal(env.writes.length, 0);
  await manager.adoptCloud();
  assert.equal(env.data.items[0].id, 'cloud-only');
  assert.equal(env.backups.size, 1);
  assert.equal(await manager.syncNow(), true);
  manager.dispose();
});

test('reset removes deletion history and preserves unrelated extension keys', async () => {
  const local = sampleData();
  local.tombstones = [createTombstone('item', 'previous', Date.now())];
  const env = memoryEnvironment(local, { cloud: { ...legacySnapshot(local), unrelatedPreference: true } });
  const manager = new SyncManager();
  assert.equal(await manager.resetCloud(), true);
  assert.equal(env.data.tombstones.length, 0);
  assert.equal(env.cloud.unrelatedPreference, true);
  assert.ok(env.cloud.tabel_sync_control.generation.id);
  assert.equal(env.backups.size, 1);
  assert.equal(env.backups.values().next().value.data.tombstones.length, 1);
  manager.dispose();
});

test('interrupted cloud reset resumes from its durable checkpoint', async () => {
  const env = memoryEnvironment(sampleData(), { cloud: legacySnapshot(sampleData()) });
  env.failSet = values => {
    if (values.tabel_sync_control) throw new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded');
  };
  const manager = new SyncManager();
  await assert.rejects(manager.resetCloud());
  assert.equal(env.local.tabelSyncConfig.chromeRecovery.kind, 'reset');
  manager.dispose();
  env.failSet = null;
  const reopened = new SyncManager();
  assert.equal(await reopened.syncNow(), true);
  assert.equal(env.local.tabelSyncConfig.chromeRecovery, null);
  assert.equal(env.data.items.length, 1);
  reopened.dispose();
});

test('a successful download preserves an earlier upload failure', async () => {
  const data = sampleData();
  const env = memoryEnvironment(data, {
    cloud: legacySnapshot(data),
    local: { tabelSyncStatus: { pending: true, error: 'syncCapacityError', errorOperation: 'push' } }
  });
  const manager = new SyncManager();
  assert.equal(await manager.pull(), true);
  assert.equal(env.local.tabelSyncStatus.error, 'syncCapacityError');
  assert.equal(env.local.tabelSyncStatus.pending, true);
  assert.ok(env.local.tabelSyncStatus.lastPullAt);
  manager.dispose();
});

test('Local Only performs no remote reads or writes', async () => {
  const env = memoryEnvironment(sampleData(), { local: { tabelSyncConfig: { provider: 'local' } } });
  env.chrome.storage.sync.get = async () => { throw new Error('Unexpected cloud read'); };
  const manager = new SyncManager();
  assert.equal(await manager.syncNow(), true);
  assert.equal(env.writes.length, 0);
  assert.equal(env.local.tabelSyncStatus.pending, false);
  manager.dispose();
});

test('diagnostics distinguishes deletion history and orphaned chunks', async () => {
  const data = sampleData();
  data.tombstones = [createTombstone('item', 'old', Date.now())];
  const env = memoryEnvironment(data, { cloud: { ...legacySnapshot(data), tabel_sync_chunk_9: 'unused' } });
  const manager = new SyncManager();
  const result = await manager.diagnostics();
  assert.equal(result.deletionCount, 1);
  assert.equal(result.unusedCount, 1);
  assert.equal(result.blockingDevices, 1);
  assert.ok(result.deletionBytes > 0 && result.activeBytes > 0);
  assert.equal(await manager.cleanUnused(), 1);
  assert.equal(env.cloud.tabel_sync_chunk_9, undefined);
  manager.dispose();
});

test('newer local changes during upload remain marked pending', async () => {
  const env = memoryEnvironment(sampleData());
  const normalSet = env.chrome.storage.sync.set;
  env.chrome.storage.sync.set = async values => {
    await normalSet(values);
    if (values.tabel_sync_meta?.checksum) env.data.items[0].title = 'Changed during upload';
  };
  const manager = new SyncManager();
  assert.equal(await manager.pushNow(), true);
  assert.equal(env.local.tabelSyncStatus.pending, true);
  assert.notEqual(env.local.tabelSyncStatus.lastPublishedFingerprint, await checksum(snapshotData(env.data)));
  manager.dispose();
});

test('clearing Chrome cloud preserves local links and stops Chrome uploads', async () => {
  const data = sampleData(3);
  const env = memoryEnvironment(data, { cloud: legacySnapshot(data) });
  const manager = new SyncManager();
  await manager.clearChromeCloud();
  assert.equal(env.local.tabelSyncConfig.provider, 'local');
  assert.equal(env.data.items.length, 3);
  const payload = JSON.parse(env.cloud.tabel_sync_chunk_0);
  assert.equal(payload.items.length, 0);
  assert.ok(storageBytes(env.cloud) < 1000);
  const writes = env.writes.length;
  assert.equal(await manager.pushNow(), true);
  assert.equal(env.writes.length, writes);
  manager.dispose();
});

test('externally cleared Chrome storage is not automatically refilled', async () => {
  const env = memoryEnvironment(sampleData(), { local: {
    tabelSyncConfig: { provider: 'chrome', chromeEstablished: true, generations: { chrome: 'initial' } }
  } });
  const manager = new SyncManager();
  assert.equal(await manager.syncNow(), false);
  assert.equal(manager.lastError, 'syncMissingCloudError');
  assert.equal(env.writes.length, 0);
  assert.equal(env.data.items.length, 1);
  manager.dispose();
});
