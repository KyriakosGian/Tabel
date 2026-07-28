const PENDING_SWEEP_PREFIX = 'tabel_pending_sweep_';

function pendingSweepKey(id) {
  return `${PENDING_SWEEP_PREFIX}${id}`;
}

/** Read valid pending sweeps directly from extension-local storage. */
export async function getPendingSweeps(storageArea = chrome.storage.local) {
  const stored = await storageArea.get(null);

  return Object.entries(stored)
    .filter(([key, value]) =>
      key.startsWith(PENDING_SWEEP_PREFIX) &&
      value?.id &&
      key === pendingSweepKey(value.id) &&
      Array.isArray(value.tabs)
    )
    .map(([, value]) => value)
    .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
}

/** Remove a sweep only after its tabs have been stored in IndexedDB. */
export async function acknowledgePendingSweep(id, storageArea = chrome.storage.local) {
  if (
    typeof id !== 'string' ||
    (!id.startsWith('sweep_') && !id.startsWith('context_'))
  ) {
    throw new TypeError('Invalid sweep id');
  }

  await storageArea.remove(pendingSweepKey(id));
}
