import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryEnvironment, sampleData } from './helpers/syncHarness.mjs';
import { SyncManager } from '../dashboard/lib/sync.js';
import { snapshotData } from '../dashboard/lib/syncCommon.js';

async function environment() {
  const env = memoryEnvironment(sampleData(3));
  const manager = new SyncManager();
  await manager.syncNow();
  return { env, manager };
}

test('recovery preview compares both copies without writing or replacing data', async () => {
  const { env, manager } = await environment();
  try {
    const writes = env.writes.length;
    const preview = await manager.previewRecovery();
    assert.equal(preview.local.items.length, 3);
    assert.equal(preview.cloud.items.length, 3);
    assert.equal(preview.cloudError, null);
    assert.equal(env.writes.length, writes);
    assert.equal(env.backups.size, 0);
    assert.deepEqual(snapshotData(env.data), snapshotData(preview.local));
  } finally { manager.dispose(); }
});

test('cloud adoption is cancelled if the reviewed cloud copy changes', async () => {
  const { env, manager } = await environment();
  try {
    const preview = await manager.previewRecovery();
    env.cloud.tabel_sync_meta.snapshotId = 'new-snapshot';
    await assert.rejects(manager.adoptCloud({ expectedCurrent: preview.local, expectedCloudState: preview.cloudState }), { code: 'syncChangedError' });
    assert.equal(env.data.items.length, 3);
  } finally { manager.dispose(); }
});

test('cloud rebuilding is cancelled if the reviewed cloud copy changes', async () => {
  const { env, manager } = await environment();
  try {
    const preview = await manager.previewRecovery();
    const writes = env.writes.length;
    env.cloud.tabel_sync_meta.snapshotId = 'new-snapshot';
    await assert.rejects(manager.resetCloud({ expectedCurrent: preview.local, expectedCloudState: preview.cloudState }), { code: 'syncChangedError' });
    assert.equal(env.writes.length, writes);
    assert.equal(env.data.items.length, 3);
  } finally { manager.dispose(); }
});

test('recovery never overwrites links changed after the review opened', async () => {
  const { env, manager } = await environment();
  try {
    const preview = await manager.previewRecovery();
    env.data.items[0].title = 'Edited while reviewing';
    await assert.rejects(manager.adoptCloud({ expectedCurrent: preview.local, expectedCloudState: preview.cloudState }), { code: 'syncChangedError' });
    assert.equal(env.data.items[0].title, 'Edited while reviewing');
  } finally { manager.dispose(); }
});

test('an incomplete cloud copy is unavailable for recovery without harming local links', async () => {
  const { env, manager } = await environment();
  try {
    delete env.cloud.tabel_sync_chunk_0;
    const preview = await manager.previewRecovery();
    assert.equal(preview.cloud, null);
    assert.equal(preview.cloudError, 'syncCloudBusy');
    assert.equal(preview.local.items.length, 3);
    assert.equal(env.data.items.length, 3);
  } finally { manager.dispose(); }
});
