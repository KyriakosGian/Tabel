import test from 'node:test';
import assert from 'node:assert/strict';
import { db, memoryEnvironment, sampleData } from './helpers/syncHarness.mjs';
import { createBackup, latestBackup, verifyBackup } from '../dashboard/lib/backups.js';
import { snapshotData } from '../dashboard/lib/syncCommon.js';

test('safety backups contain only tab data and verify before use', async () => {
  const env = memoryEnvironment(sampleData());
  env.local.secretToken = 'must-not-export';
  const backup = await createBackup('before-delete-all');
  const data = await verifyBackup(backup);
  assert.equal(data.items.length, 1);
  assert.equal(JSON.stringify(backup).includes('must-not-export'), false);
  assert.equal((await latestBackup()).id, backup.id);
});

test('tampered backups are rejected without changing current data', async () => {
  const env = memoryEnvironment(sampleData());
  const backup = await createBackup('test');
  backup.data.items[0].title = 'tampered';
  await assert.rejects(verifyBackup(backup), { code: 'backupIntegrityError' });
  assert.equal(env.data.items[0].title, 'Demo 0');
});

test('failed backup persistence cancels the operation with a specific error', async () => {
  const env = memoryEnvironment(sampleData());
  db.saveBackup = async () => { throw new Error('Disk quota exceeded'); };
  await assert.rejects(createBackup('before-delete-all'), { code: 'backupFailed' });
  assert.equal(env.data.items.length, 1);
});

test('Delete All is one atomic snapshot edit and preserves prior deletions', async () => {
  const env = memoryEnvironment(sampleData(2));
  const old = { key: 'item:old', entityType: 'item', entityId: 'old', deletedAt: 10 };
  env.data.tombstones.push(old);
  let commits = 0;
  db._editSnapshot = async transform => {
    const result = transform(structuredClone(snapshotData(env.data)));
    env.data = { version: 5, ...result.data };
    commits++;
    return result.result;
  };
  await db.clearAll({ expectedCurrent: await db.exportAll() });
  assert.equal(commits, 1);
  assert.equal(env.data.groups.length, 0);
  assert.equal(env.data.items.length, 0);
  assert.equal(env.data.tombstones.length, 4);
  assert.ok(env.data.tombstones.some(record => record.key === 'item:old'));
});

test('data changed after confirmation cannot be deleted or overwritten', async () => {
  const env = memoryEnvironment(sampleData());
  const reviewed = await db.exportAll();
  env.data.items[0].title = 'Saved after review';
  db._editSnapshot = async transform => {
    const result = transform(structuredClone(snapshotData(env.data)));
    env.data = { version: 5, ...result.data };
    return result.result;
  };
  await assert.rejects(db.clearAll({ expectedCurrent: reviewed }), /Saved data changed/);
  await assert.rejects(db.importAll(sampleData(0), { expectedCurrent: reviewed }), /Saved data changed/);
  assert.equal(env.data.items[0].title, 'Saved after review');
});
