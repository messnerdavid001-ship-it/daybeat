// Runs the shared storage suite against the memory adapter and the localStorage adapter (fake storage),
// then the Node-only storage tests (fault injection, migrations, read-only, fallback).
import test from 'node:test';
import assert from 'node:assert/strict';
import { storeSuite } from './shared/store-suite.js';
import { createStore } from '../js/data/store.js';
import { MemoryAdapter, LocalStorageAdapter, STORES } from '../js/data/adapters.js';
import { DataError, SCHEMA_VERSION } from '../js/data/schema.js';
import { FakeStorage } from './helpers/fake-storage.js';

let n = 0;
const uniq = () => `test-${process.pid}-${Date.now()}-${n++}`;

async function openStore(adapter, opts = {}) {
  const s = createStore();
  await s.init({ adapter, ...opts });
  return s;
}

storeSuite(
  { test, assert },
  {
    backend: 'memory',
    async fresh() {
      return { data: new MemoryAdapter({ shared: true }).data, dbName: uniq() };
    },
    async open(b, opts) {
      return openStore(new MemoryAdapter({ data: b.data, shared: true }), { dbName: b.dbName, ...opts });
    },
    async dispose() {},
  },
);

storeSuite(
  { test, assert },
  {
    backend: 'localstorage',
    async fresh() {
      return { storage: new FakeStorage(), dbName: uniq() };
    },
    async open(b, opts) {
      return openStore(new LocalStorageAdapter({ storage: b.storage, prefix: `${b.dbName}:` }), { dbName: b.dbName, ...opts });
    },
    async dispose() {},
  },
);

const NOW = new Date('2026-11-25T12:00:00.000Z');

test('a write that fails leaves memory and storage unchanged and reports quota_exceeded', async () => {
  const storage = new FakeStorage();
  const s = await openStore(new LocalStorageAdapter({ storage, prefix: 'q:' }), { dbName: uniq(), clock: () => NOW });
  await s.put('message', { text: 'kept' });
  const events = [];
  s.onChange((e) => events.push(e));
  storage.failNextSet = true;
  await assert.rejects(s.put('message', { text: 'lost' }), (e) => e instanceof DataError && e.code === 'quota_exceeded');
  assert.equal(s.count('message'), 1);
  assert.equal(events.length, 0, 'no change event for a failed write');
  await s.put('message', { text: 'works again' });
  assert.equal(s.count('message'), 2);
  s.close();
});

test('a multi-store write is rolled back completely when the second key cannot be written', async () => {
  const storage = new FakeStorage();
  const a = new LocalStorageAdapter({ storage, prefix: 'r:' });
  const s = await openStore(a, { dbName: uniq(), clock: () => NOW });
  await s.put('message', { text: 'm1' });
  const before = JSON.stringify([...storage.map.entries()]);
  const realSet = storage.setItem.bind(storage);
  let calls = 0;
  storage.setItem = (k, v) => {
    if (++calls === 2) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    realSet(k, v);
  };
  await assert.rejects(
    s.batch([
      { op: 'put', kind: 'message', record: { text: 'm2' } },
      { op: 'put', kind: 'alarm', record: { time: '07:00' } },
    ]),
    (e) => e.code === 'quota_exceeded',
  );
  storage.setItem = realSet;
  assert.equal(JSON.stringify([...storage.map.entries()]), before, 'storage identical to before the failed batch');
  assert.equal(s.count('message'), 1);
  assert.equal(s.count('alarm'), 0);
  s.close();
});

test('damaged stored data is never replaced by an empty store: init falls back and says so, the damaged key stays', async () => {
  const storage = new FakeStorage();
  storage.setItem('dmg:message', '{not json');
  const s = createStore();
  const info = await s.init({ adapter: new LocalStorageAdapter({ storage, prefix: 'dmg:' }) });
  // With an explicit adapter there is no fallback chain: the memory adapter takes over (degraded) and nothing is deleted.
  assert.equal(info.degraded, true);
  assert.equal(storage.getItem('dmg:message'), '{not json');
  s.close();
});

test('backend fallback: storage that cannot be opened gives a degraded memory store with a plain warning', async () => {
  const s = createStore();
  const info = await s.init({ backend: 'localstorage' }); // no localStorage in Node -> falls through to memory
  assert.equal(info.backend, 'memory');
  assert.equal(info.persistent, false);
  assert.equal(info.degraded, true);
  assert.match(info.warnings.join(' '), /lost when you close the app/);
  await s.put('message', { text: 'still usable' });
  assert.equal(s.count('message'), 1);
  s.close();
});

test('data written by a newer app version opens read-only and refuses every write', async () => {
  const data = new MemoryAdapter().data;
  data.get('meta').set('schemaVersion', { id: 'schemaVersion', value: SCHEMA_VERSION + 1 });
  data.get('message').set('ms_1', { id: 'ms_1', text: 'future', from: '', at: NOW.toISOString(), via: 'manual', pinned: false, tags: [], source: 'user', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
  const s = await openStore(new MemoryAdapter({ data }), { clock: () => NOW });
  assert.equal(s.info().readOnly, true);
  assert.equal(s.count('message'), 1, 'can still read');
  await assert.rejects(s.put('message', { text: 'x' }), (e) => e.code === 'read_only');
  await assert.rejects(s.wipeAll({ confirmed: true }), (e) => e.code === 'read_only');
  assert.equal(data.get('message').size, 1);
  s.close();
});

test('migrations run once, after a safety snapshot, atomically with the new version', async () => {
  const data = new MemoryAdapter().data;
  const rec = { id: 'ms_1', text: 'old', from: '', at: NOW.toISOString(), via: 'manual', pinned: false, tags: [], source: 'user', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
  data.get('message').set('ms_1', rec);
  data.get('meta').set('schemaVersion', { id: 'schemaVersion', value: 1 });
  const migrations = [
    {
      from: 1,
      to: 2,
      run(b) {
        b.kinds.message = b.kinds.message.map((m) => ({ ...m, text: m.text + ' (migrated)' }));
        return b;
      },
    },
  ];
  const s = await openStore(new MemoryAdapter({ data }), { clock: () => NOW, migrations, schemaVersion: 2 });
  assert.equal(s.info().migratedFrom, 1);
  assert.equal(s.info().schemaVersion, 2);
  assert.equal(s.get('message', 'ms_1').text, 'old (migrated)');
  assert.equal(data.get('meta').get('schemaVersion').value, 2);
  const snap = data.get('meta').get('snapshot').value;
  assert.equal(snap.data.kinds.message[0].text, 'old', 'the snapshot holds the pre-migration data');
  s.close();
  // second open: nothing to migrate
  const s2 = await openStore(new MemoryAdapter({ data }), { clock: () => NOW, migrations, schemaVersion: 2 });
  assert.equal(s2.info().migratedFrom, null);
  s2.close();
});

test('a failing migration leaves the data untouched and read-only', async () => {
  const data = new MemoryAdapter().data;
  const rec = { id: 'ms_1', text: 'old', from: '', at: NOW.toISOString(), via: 'manual', pinned: false, tags: [], source: 'user', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
  data.get('message').set('ms_1', rec);
  data.get('meta').set('schemaVersion', { id: 'schemaVersion', value: 1 });
  const migrations = [{ from: 1, to: 2, run() { throw new Error('boom'); } }];
  const s = await openStore(new MemoryAdapter({ data }), { clock: () => NOW, migrations, schemaVersion: 2 });
  assert.equal(s.info().readOnly, true);
  assert.deepEqual(data.get('message').get('ms_1'), rec);
  s.close();
});

test('concurrent writes are serialised: 50 parallel puts and updates all land', async () => {
  const s = await openStore(new MemoryAdapter(), { clock: () => NOW });
  const first = await s.put('message', { text: 'seed' });
  await Promise.all([
    ...Array.from({ length: 50 }, (_, i) => s.put('message', { text: `m${i}` })),
    ...Array.from({ length: 20 }, (_, i) => s.update('message', first.id, { from: `u${i}` })),
  ]);
  assert.equal(s.count('message'), 51);
  assert.equal(s.get('message', first.id).from, 'u19');
  s.close();
});

test('list: range, sort, where and limit', async () => {
  const s = await openStore(new MemoryAdapter(), { clock: () => NOW });
  await s.putMany('event', [
    { id: 'e1', title: 'timed', start: '2026-11-25T10:00:00Z', end: '2026-11-25T11:00:00Z' },
    { id: 'e2', title: 'all-day', allDay: true, start: '2026-11-24', end: '2026-11-26' },
    { id: 'e3', title: 'later', start: '2026-12-25T10:00:00Z' },
    { id: 'e4', title: 'zero-length', start: '2026-11-25T12:00:00Z' },
  ]);
  assert.deepEqual(s.list('event').map((e) => e.id), ['e2', 'e1', 'e4', 'e3']);
  assert.deepEqual(s.list('event', { sort: 'title' }).map((e) => e.title), ['all-day', 'later', 'timed', 'zero-length']);
  assert.deepEqual(s.list('event', { where: (e) => e.allDay }).map((e) => e.id), ['e2']);
  assert.equal(s.list('event', { limit: 2 }).length, 2);
  // an all-day event overlaps every day it spans (local days; the test runs in several zones)
  assert.ok(s.list('event', { from: '2026-11-25', to: '2026-11-26' }).some((e) => e.id === 'e2'));
  assert.ok(!s.list('event', { from: '2026-11-27', to: '2026-12-01' }).some((e) => e.id === 'e2'));
  assert.ok(!s.list('event', { from: '2026-11-27', to: '2026-12-01' }).length);
  assert.ok(s.list('event', { from: '2026-12-25T00:00:00Z' }).some((e) => e.id === 'e3'));
  s.close();
});

test('records are sanitised: control characters, bidi overrides, lone surrogates, newlines in single-line fields', async () => {
  const s = await openStore(new MemoryAdapter(), { clock: () => NOW });
  const m = await s.put('message', { text: 'a\u0000b‮c\ud800d\r\ne', from: 'Sam\nSmith\t', tags: ['  x  ', 'x'] });
  assert.equal(m.text, 'ab' + 'c' + '�' + 'd\ne');
  assert.equal(m.from, 'Sam Smith');
  assert.deepEqual(m.tags, ['x']);
  const ev = await s.put('event', { title: '<img src=x onerror=alert(1)>', start: '2026-11-25T10:00:00Z' });
  assert.equal(ev.title, '<img src=x onerror=alert(1)>', 'HTML is kept as plain text; the UI escapes on render');
  assert.equal(Object.keys(await s.put('event', { title: 't', start: '2026-11-25T10:00:00Z', __proto__x: 1, constructor: 'x', evil: 1 })).includes('evil'), false);
  await assert.rejects(s.put('message', { text: 'x'.repeat(4001) }), (e) => e.code === 'invalid');
  s.close();
});
