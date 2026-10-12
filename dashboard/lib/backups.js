import { db } from './db.js';
import { validateData } from './validateData.js';
import { byteSize, checksum, MAX_SNAPSHOT_BYTES, readConfig, snapshotData, SyncError, uniqueId } from './syncCommon.js';

export async function createBackup(reason, database = db) {
  try {
  const data = await database.exportAll();
  validateData(data);
  const payload = JSON.stringify(snapshotData(data));
  if (byteSize(payload) > MAX_SNAPSHOT_BYTES) throw new Error('Backup is too large');
  const backup = {
    id: uniqueId(),
    createdAt: Date.now(),
    reason,
    data,
    checksum: await checksum(payload),
    bytes: byteSize(payload)
  };
  const config = await readConfig();
  const pinnedIds = [config.chromeRecovery?.backupId].filter(Boolean);
  await database.saveBackup(backup, { pinnedIds });
  const saved = await database.getBackup(backup.id);
  await verifyBackup(saved);
  return saved;
  } catch {
    throw new SyncError('backupFailed');
  }
}

export async function verifyBackup(backup) {
  if (!backup?.data || !backup.checksum) throw new SyncError('backupUnavailable');
  try { validateData(backup.data); } catch { throw new SyncError('backupIntegrityError'); }
  if (await checksum(JSON.stringify(snapshotData(backup.data))) !== backup.checksum) {
    throw new SyncError('backupIntegrityError');
  }
  return backup.data;
}

export async function latestBackup(database = db) {
  const backups = await database.getBackups();
  return backups.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0] || null;
}
