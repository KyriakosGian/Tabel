globalThis.indexedDB ||= { open: () => ({}) };
export const { db } = await import('../../dashboard/lib/db.js');
const { mergeSyncData } = await import('../../dashboard/lib/merge.js');
const { snapshotData, storageBytes } = await import('../../dashboard/lib/syncCommon.js');

export function sampleData(count = 1, timestamp = Date.now()) {
  return {
    version: 5,
    groups: [{ id: 'g1', name: 'Demo', createdAt: timestamp, updatedAt: timestamp, order: 0, tabCount: count }],
    items: Array.from({ length: count }, (_, index) => ({
      id: `t${index}`, groupId: 'g1', url: `https://example.com/${index}`,
      title: `Demo ${index}`, order: index, createdAt: timestamp, updatedAt: timestamp
    })),
    tombstones: []
  };
}

export function memoryEnvironment(initial = sampleData(), { cloud = {}, local = {} } = {}) {
  const env = {
    data: structuredClone(initial), cloud: structuredClone(cloud),
    local: { tabelDeviceId: 'device-new', ...structuredClone(local) },
    backups: new Map(), writes: [], removals: [], failSet: null, failRemove: null
  };
  const storageGet = store => async keys => {
    if (keys === null || keys === undefined) return structuredClone(store);
    const selected = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    return Object.fromEntries(selected.filter(key => key in store).map(key => [key, structuredClone(store[key])]));
  };
  env.chrome = {
    runtime: { getManifest: () => ({ manifest_version: 3 }), sendMessage: async () => {} },
    storage: {
      local: {
        get: storageGet(env.local),
        set: async values => Object.assign(env.local, structuredClone(values))
      },
      sync: {
        QUOTA_BYTES: 102400,
        get: storageGet(env.cloud),
        getBytesInUse: async () => storageBytes(env.cloud),
        set: async values => {
          env.writes.push(structuredClone(values));
          env.failSet?.(values);
          for (const [key, value] of Object.entries(values)) {
            if (storageBytes({ [key]: value }) > 8192) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
          }
          const next = { ...env.cloud, ...values };
          if (storageBytes(next) > 102400) throw new Error('QUOTA_BYTES quota exceeded');
          if (Object.keys(next).length > 512) throw new Error('MAX_ITEMS quota exceeded');
          Object.assign(env.cloud, structuredClone(values));
        },
        remove: async keys => {
          env.failRemove?.(keys);
          env.removals.push([...keys]);
          for (const key of keys) delete env.cloud[key];
        }
      },
      onChanged: { addListener() {}, removeListener() {} }
    }
  };
  env.activate = () => {
    globalThis.chrome = env.chrome;
    db.exportAll = async () => ({ version: 5, ...structuredClone(snapshotData(env.data)) });
    db.mergeAll = async remote => {
      const result = mergeSyncData(env.data, remote);
      env.data = { version: 5, ...snapshotData(result) };
      return result;
    };
    db.deleteTombstones = async keys => { env.data.tombstones = env.data.tombstones.filter(record => !keys.includes(record.key)); };
    db.replaceAll = async (data, options = {}) => {
      if (options.expectedCurrent && JSON.stringify(snapshotData(options.expectedCurrent)) !== JSON.stringify(snapshotData(env.data))) {
        throw new Error('Saved data changed');
      }
      env.data = { version: 5, ...structuredClone(snapshotData(data)) };
    };
    db.saveBackup = async backup => { env.backups.set(backup.id, structuredClone(backup)); };
    db.getBackup = async id => structuredClone(env.backups.get(id));
    db.getBackups = async () => [...env.backups.values()].map(backup => structuredClone(backup));
  };
  env.activate();
  return env;
}
