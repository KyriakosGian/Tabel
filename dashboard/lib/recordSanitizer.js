/**
 * Legacy versions stored a remote favicon URL with every tab. Favicons are now
 * derived from the saved page URL through Chrome's favicon API.
 */
export function sanitizeTabRecord(record) {
  return pick(record, ['id', 'groupId', 'url', 'title', 'order', 'createdAt', 'updatedAt']);
}

function pick(record, fields) {
  return Object.fromEntries(fields.filter(field => record[field] !== undefined).map(field => [field, record[field]]));
}

export function sanitizeGroupRecord(record) {
  return pick(record, ['id', 'name', 'createdAt', 'updatedAt', 'order', 'collapsed', 'locked', 'tabCount', 'width', 'bgColor', 'sourceSweepId']);
}

export function sanitizeTombstoneRecord(record) {
  return {
    key: record.key || `${record.entityType}:${record.entityId}`,
    entityType: record.entityType, entityId: record.entityId, deletedAt: record.deletedAt
  };
}
