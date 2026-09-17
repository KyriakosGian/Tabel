import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData } from '../dashboard/lib/validateData.js';

const backup = () => ({ groups: [{ id: 'g1', name: 'Example' }],
  items: [{ id: 't1', groupId: 'g1', title: 'Example', url: 'https://example.com' }] });

test('legacy backups without tombstones remain valid', () => {
  assert.doesNotThrow(() => validateData(backup()));
});

test('invalid URLs, identifiers, orphan tabs and duplicate IDs are rejected', () => {
  for (const change of [
    data => { data.items[0].url = 'javascript:alert(1)'; },
    data => { delete data.groups[0].id; },
    data => { data.items[0].groupId = 'missing'; },
    data => { data.items.push({ ...data.items[0] }); },
    data => { data.groups[0].locked = 'false'; },
    data => { data.groups[0].bgColor = 'url(https://example.com/tracker.png)'; },
    data => { data.groups[0].tabCount = -1; }
  ]) {
    const data = backup();
    change(data);
    assert.throws(() => validateData(data), /Invalid/);
  }
});
