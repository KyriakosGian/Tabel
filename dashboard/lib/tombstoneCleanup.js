export const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function maxDeletedAt(tombstones = []) {
  return tombstones.reduce((maximum, tombstone) => {
    const deletedAt = Number(tombstone?.deletedAt);
    return Number.isFinite(deletedAt) && deletedAt > maximum
      ? deletedAt
      : maximum;
  }, 0);
}

/**
 * A tombstone is prunable only when it is old enough and every known device
 * confirms that it has observed deletions through that timestamp.
 *
 * Known devices are intentionally never expired automatically. Forgetting a
 * device without an explicit user action could allow stale records from that
 * device to reappear later.
 */
export function getPrunableTombstoneKeys(
  tombstones = [],
  deviceStates = [],
  options = {}
) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const retentionMs = Number.isFinite(options.retentionMs)
    ? Math.max(0, options.retentionMs)
    : TOMBSTONE_RETENTION_MS;
  const knownDevices = deviceStates.filter(state =>
    typeof state?.deviceId === 'string' &&
    state.deviceId.length > 0 &&
    Number.isFinite(Number(state.acknowledgedThrough))
  );

  if (knownDevices.length === 0) return [];

  const cutoff = now - retentionMs;
  const keys = new Set();

  for (const tombstone of tombstones) {
    const deletedAt = Number(tombstone?.deletedAt);
    if (
      typeof tombstone?.key !== 'string' ||
      tombstone.key.length === 0 ||
      !Number.isFinite(deletedAt) ||
      deletedAt <= 0 ||
      deletedAt > cutoff
    ) {
      continue;
    }

    const acknowledgedByAll = knownDevices.every(state =>
      Number(state.acknowledgedThrough) >= deletedAt
    );
    if (acknowledgedByAll) keys.add(tombstone.key);
  }

  return [...keys];
}
