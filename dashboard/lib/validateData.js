import { isCapturableUrl } from './tabCapture.js';

const ALLOWED_GROUP_COLORS = new Set([
  '',
  'rgba(239, 68, 68, 0.12)',
  'rgba(249, 115, 22, 0.12)',
  'rgba(234, 179, 8, 0.12)',
  'rgba(34, 197, 94, 0.12)',
  'rgba(6, 182, 212, 0.12)',
  'rgba(99, 102, 241, 0.12)',
  'rgba(168, 85, 247, 0.12)',
  'rgba(236, 72, 153, 0.12)'
]);

/** Reject malformed backups before any destructive database operation. */
export function validateData(data) {
  const fail = () => { throw new Error('Invalid tab data'); };
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
  const text = (value, maxLength) => typeof value === 'string' && value.length <= maxLength;
  const timestamp = value => value === undefined ||
    (Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000);
  if (!data || !Array.isArray(data.groups) || !Array.isArray(data.items) ||
      (data.tombstones !== undefined && !Array.isArray(data.tombstones))) fail();
  const groups = new Set();
  const items = new Set();
  for (const group of data.groups) {
    if (!group || !id(group.id) || groups.has(group.id) ||
        !text(group.name, 500) || !timestamp(group.createdAt) ||
        !timestamp(group.updatedAt) ||
        (group.order !== undefined && !Number.isSafeInteger(group.order)) ||
        (group.tabCount !== undefined &&
          (!Number.isSafeInteger(group.tabCount) || group.tabCount < 0)) ||
        (group.width !== undefined && ![33, 50, 100].includes(group.width)) ||
        (group.bgColor !== undefined && !ALLOWED_GROUP_COLORS.has(group.bgColor)) ||
        (group.sourceSweepId !== undefined && !id(group.sourceSweepId)) ||
        ['locked', 'collapsed'].some(key => group[key] !== undefined && typeof group[key] !== 'boolean')) fail();
    groups.add(group.id);
  }
  for (const item of data.items) {
    if (!item || !id(item.id) || items.has(item.id) || !groups.has(item.groupId) ||
        !isCapturableUrl(item.url) || !text(item.url, 32768) || !text(item.title, 8192) ||
        !timestamp(item.createdAt) || !timestamp(item.updatedAt) ||
        (item.order !== undefined && !Number.isSafeInteger(item.order))) fail();
    items.add(item.id);
  }
  const deletions = new Set();
  for (const tombstone of data.tombstones || []) {
    if (!tombstone || !['group', 'item'].includes(tombstone.entityType) ||
        !id(tombstone.entityId) || !Number.isSafeInteger(tombstone.deletedAt) ||
        tombstone.deletedAt <= 0 || !timestamp(tombstone.deletedAt)) fail();
    const key = `${tombstone.entityType}:${tombstone.entityId}`;
    if ((tombstone.key !== undefined && tombstone.key !== key) || deletions.has(key)) fail();
    deletions.add(key);
  }
  return data;
}
