import test from 'node:test';
import assert from 'node:assert/strict';

import {
  acknowledgePendingSweep,
  getPendingSweeps
} from '../dashboard/lib/pendingSweeps.js';

function createStorage(initialData = {}) {
  const data = { ...initialData };

  return {
    data,
    area: {
      get: async () => ({ ...data }),
      remove: async key => { delete data[key]; }
    }
  };
}

test('pending sweeps are read directly from local storage in timestamp order', async () => {
  const first = {
    id: 'sweep_first',
    timestamp: 10,
    tabs: [{ url: 'https://one.example' }]
  };
  const second = {
    id: 'sweep_second',
    timestamp: 20,
    tabs: [{ url: 'https://two.example' }]
  };
  const storage = createStorage({
    settings: { theme: 'dark' },
    tabel_pending_sweep_sweep_second: second,
    tabel_pending_sweep_sweep_first: first,
    tabel_pending_sweep_wrong_key: { ...first, id: 'sweep_mismatch' },
    tabel_pending_sweep_invalid: { id: 'sweep_invalid', tabs: 'invalid' }
  });

  const sweeps = await getPendingSweeps(storage.area);

  assert.deepEqual(sweeps, [first, second]);
});

test('a pending sweep is removed only when explicitly acknowledged', async () => {
  const key = 'tabel_pending_sweep_sweep_saved';
  const storage = createStorage({
    [key]: { id: 'sweep_saved', timestamp: 1, tabs: [] }
  });

  await getPendingSweeps(storage.area);
  assert.equal(key in storage.data, true);

  await acknowledgePendingSweep('sweep_saved', storage.area);
  assert.equal(key in storage.data, false);
});

test('an invalid sweep id cannot remove storage data', async () => {
  const storage = createStorage({ settings: { theme: 'dark' } });

  await assert.rejects(
    acknowledgePendingSweep('settings', storage.area),
    /Invalid sweep id/
  );
  assert.deepEqual(storage.data, { settings: { theme: 'dark' } });
});

test('a context menu capture can be acknowledged after it is stored', async () => {
  const key = 'tabel_pending_sweep_context_saved';
  const storage = createStorage({
    [key]: {
      id: 'context_saved',
      timestamp: 1,
      source: 'contextMenu',
      tabs: [{ url: 'https://example.com' }]
    }
  });

  await acknowledgePendingSweep('context_saved', storage.area);
  assert.equal(key in storage.data, false);
});
