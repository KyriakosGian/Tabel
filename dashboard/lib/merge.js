function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function createTombstone(entityType, entityId, deletedAt = Date.now()) {
  return {
    key: `${entityType}:${entityId}`,
    entityType,
    entityId,
    deletedAt
  };
}

function recordEvent(record) {
  if (!record) return null;
  return {
    kind: 'record',
    timestamp: record.updatedAt || record.createdAt || 0,
    value: record
  };
}

function tombstoneEvent(tombstone) {
  if (!tombstone) return null;
  return {
    kind: 'tombstone',
    timestamp: tombstone.deletedAt || 0,
    value: tombstone
  };
}

function eventSignature(event) {
  if (!event) return 'none';
  return `${event.kind}:${event.timestamp}:${stableStringify(event.value)}`;
}

function pickLatest(first, second) {
  if (!first) return second;
  if (!second) return first;
  if (first.timestamp !== second.timestamp) {
    return first.timestamp > second.timestamp ? first : second;
  }

  // A deletion wins an exact timestamp tie. Record ties use a deterministic
  // payload comparison so concurrent devices converge on the same result.
  if (first.kind !== second.kind) {
    return first.kind === 'tombstone' ? first : second;
  }
  return eventSignature(first) >= eventSignature(second) ? first : second;
}

function normalizeData(data) {
  if (!data || !Array.isArray(data.groups) || !Array.isArray(data.items)) {
    throw new Error('Invalid sync data');
  }
  return {
    groups: data.groups,
    items: data.items,
    tombstones: Array.isArray(data.tombstones) ? data.tombstones : []
  };
}

function tombstoneMap(tombstones, entityType) {
  return new Map(
    tombstones
      .filter(t => t?.entityType === entityType && t.entityId)
      .map(t => [t.entityId, {
        ...t,
        key: t.key || `${entityType}:${t.entityId}`
      }])
  );
}

export function mergeSyncData(localInput, remoteInput) {
  const local = normalizeData(localInput);
  const remote = normalizeData(remoteInput);
  const result = { groups: [], items: [], tombstones: [] };
  let localChangedCount = 0;
  let cloudNeedsUpdateCount = 0;

  for (const definition of [
    { entityType: 'group', field: 'groups' },
    { entityType: 'item', field: 'items' }
  ]) {
    const { entityType, field } = definition;
    const localRecords = new Map(local[field].filter(r => r?.id).map(r => [r.id, r]));
    const remoteRecords = new Map(remote[field].filter(r => r?.id).map(r => [r.id, r]));
    const localTombstones = tombstoneMap(local.tombstones, entityType);
    const remoteTombstones = tombstoneMap(remote.tombstones, entityType);
    const ids = new Set([
      ...localRecords.keys(),
      ...remoteRecords.keys(),
      ...localTombstones.keys(),
      ...remoteTombstones.keys()
    ]);

    for (const id of ids) {
      const localEvent = pickLatest(
        recordEvent(localRecords.get(id)),
        tombstoneEvent(localTombstones.get(id))
      );
      const remoteEvent = pickLatest(
        recordEvent(remoteRecords.get(id)),
        tombstoneEvent(remoteTombstones.get(id))
      );
      let finalEvent = pickLatest(localEvent, remoteEvent);

      // A tab cannot survive without its group. Group deletion wins over a
      // concurrent orphaned item and produces a tombstone for convergence.
      if (
        entityType === 'item' &&
        finalEvent.kind === 'record' &&
        !result.groups.some(group => group.id === finalEvent.value.groupId)
      ) {
        const groupDeletion = result.tombstones.find(t =>
          t.entityType === 'group' && t.entityId === finalEvent.value.groupId
        );
        finalEvent = tombstoneEvent(createTombstone(
          'item',
          id,
          Math.max(finalEvent.timestamp, groupDeletion?.deletedAt || 0) + 1
        ));
      }

      if (finalEvent.kind === 'record') {
        result[field].push(finalEvent.value);
      } else {
        result.tombstones.push({
          ...finalEvent.value,
          key: finalEvent.value.key || `${entityType}:${id}`
        });
      }

      if (eventSignature(finalEvent) !== eventSignature(localEvent)) localChangedCount++;
      if (eventSignature(finalEvent) !== eventSignature(remoteEvent)) cloudNeedsUpdateCount++;
    }
  }

  result.groups.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  result.items.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  result.tombstones.sort((a, b) => a.key.localeCompare(b.key));

  return {
    ...result,
    localOnlyCount: cloudNeedsUpdateCount,
    remoteOnlyCount: localChangedCount,
    updatedCount: 0
  };
}
