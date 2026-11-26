// Browser test runner: the shared storage suite against REAL IndexedDB, plus IndexedDB-only checks.
import { storeSuite } from '../shared/store-suite.js';
import { createStore } from '../../js/data/store.js';
import { IdbAdapter } from '../../js/data/adapters.js';
import { DB_NAME } from '../../js/data/schema.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function fmt(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
class AssertionError extends Error {}
const assert = {
  ok(v, msg) {
    if (!v) throw new AssertionError(msg || 'expected a truthy value');
  },
  equal(a, b, msg) {
    if (a !== b) throw new AssertionError(msg || `expected ${fmt(a)} === ${fmt(b)}`);
  },
  notEqual(a, b, msg) {
    if (a === b) throw new AssertionError(msg || `expected ${fmt(a)} !== ${fmt(b)}`);
  },
  deepEqual(a, b, msg) {
    if (fmt(a) !== fmt(b)) throw new AssertionError(msg || `expected ${fmt(a)} to equal ${fmt(b)}`);
  },
  match(s, re, msg) {
    if (!re.test(s)) throw new AssertionError(msg || `expected ${fmt(s)} to match ${re}`);
  },
  async rejects(p, check) {
    let err;
    try {
      await (typeof p === 'function' ? p() : p);
    } catch (e) {
      err = e;
    }
    if (!err) throw new AssertionError('expected the promise to reject');
    if (typeof check === 'function' && !check(err)) throw new AssertionError(`rejection did not match: ${err && err.code} ${err && err.message}`);
  },
};

let n = 0;
const uniq = () => `browser-test-${Date.now()}-${n++}`;
const deleteDb = (name) =>
  new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });

storeSuite(
  { test, assert },
  {
    backend: 'indexeddb',
    async fresh() {
      return { dbName: uniq(), stores: [] };
    },
    async open(b, opts) {
      const s = createStore();
      await s.init({ dbName: b.dbName, ...opts });
      return s;
    },
    async dispose(b) {
      await new Promise((r) => setTimeout(r, 30));
      await deleteDb(b.dbName);
    },
  },
);

test('[indexeddb] real IndexedDB is in use, with all stores and a write probe', async () => {
  const dbName = uniq();
  const s = createStore();
  const info = await s.init({ dbName });
  assert.equal(info.backend, 'indexeddb');
  assert.equal(info.persistent, true);
  assert.equal(info.degraded, false);
  s.close();
  const names = await new Promise((resolve, reject) => {
    const r = indexedDB.open(dbName);
    r.onsuccess = () => {
      const list = [...r.result.objectStoreNames].sort();
      r.result.close();
      resolve(list);
    };
    r.onerror = () => reject(r.error);
  });
  assert.deepEqual(names, ['action', 'alarm', 'checkin', 'daily', 'event', 'message', 'meta', 'setting']);
  await deleteDb(dbName);
});

test('[indexeddb] a newer database version from another tab makes this store stale and read-only (no silent data loss)', async () => {
  const dbName = uniq();
  const s = createStore();
  await s.init({ dbName });
  await s.put('message', { text: 'before upgrade' });
  const events = [];
  s.onChange((e) => events.push(e));
  await new Promise((resolve, reject) => {
    const r = indexedDB.open(dbName, 2); // another tab with a newer app upgrades the database
    r.onupgradeneeded = () => {};
    r.onsuccess = () => {
      r.result.close();
      resolve();
    };
    r.onerror = () => reject(r.error);
  });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(events.some((e) => e.reason === 'stale'), 'stale event fired');
  await assert.rejects(s.put('message', { text: 'after' }), (e) => e.code === 'read_only');
  assert.equal(s.count('message'), 1, 'data still readable');
  s.close();
  await deleteDb(dbName);
});

test('[indexeddb] a database from a newer app version opens read-only in memory instead of being overwritten', async () => {
  const dbName = uniq();
  await new Promise((resolve, reject) => {
    const r = indexedDB.open(dbName, 5);
    r.onupgradeneeded = () => r.result.createObjectStore('message', { keyPath: 'id' });
    r.onsuccess = () => {
      r.result.close();
      resolve();
    };
    r.onerror = () => reject(r.error);
  });
  const s = createStore();
  const info = await s.init({ dbName });
  assert.equal(info.readOnly, true);
  assert.equal(info.degraded, true);
  assert.match(info.warnings.join(' '), /newer version/);
  await assert.rejects(s.put('message', { text: 'x' }), (e) => e.code === 'read_only');
  s.close();
  await deleteDb(dbName);
});

test('[indexeddb] a failed write transaction changes nothing (atomic)', async () => {
  const dbName = uniq();
  const s = createStore();
  await s.init({ dbName });
  await s.put('message', { text: 'kept' });
  // Sabotage the adapter so that the transaction aborts half way through.
  const adapter = new IdbAdapter({ name: dbName });
  await adapter.open();
  const before = await adapter.readAll(['message', 'alarm']);
  await assert.rejects(
    adapter.apply([
      { store: 'message', put: { id: 'ms_new', text: 'half' } },
      { store: 'alarm', put: { /* no id: DataError inside the transaction */ } },
    ]),
    () => true,
  );
  const after = await adapter.readAll(['message', 'alarm']);
  assert.deepEqual(after, before);
  adapter.close();
  s.close();
  await deleteDb(dbName);
});

test('[indexeddb] theme and accent are mirrored to localStorage for the boot script and removed on wipe', async () => {
  const dbName = uniq();
  const s = createStore();
  await s.init({ dbName });
  await s.settings.set('theme', 'dark');
  await s.settings.set('accent', 'mint');
  assert.equal(localStorage.getItem('app.theme'), 'dark');
  assert.equal(localStorage.getItem('app.accent'), 'mint');
  await s.wipeAll({ confirmed: true });
  assert.equal(localStorage.getItem('app.theme'), null);
  assert.equal(localStorage.getItem('app.accent'), null);
  s.close();
  await deleteDb(dbName);
});

test('[indexeddb] estimate and persistence helpers never throw', async () => {
  const s = createStore();
  await s.init({ dbName: uniq() });
  const e = await s.estimate();
  assert.ok(e === null || typeof e.quota === 'number');
  assert.equal(typeof (await s.requestPersistence()), 'boolean');
  s.close();
});

test('[indexeddb] the default database name is unique to this app', () => {
  assert.equal(DB_NAME, 'daybeat-data');
});

async function main() {
  const results = [];
  const list = document.getElementById('list');
  for (const t of tests) {
    const li = document.createElement('li');
    let ok = true;
    let msg = '';
    const t0 = performance.now();
    try {
      await t.fn();
    } catch (e) {
      ok = false;
      msg = (e && e.stack) || String(e);
    }
    li.className = ok ? 'pass' : 'fail';
    li.textContent = `${ok ? 'PASS' : 'FAIL'}  ${t.name} (${Math.round(performance.now() - t0)} ms)`;
    if (!ok) {
      const pre = document.createElement('pre');
      pre.textContent = msg;
      li.append(pre);
    }
    list.append(li);
    results.push({ name: t.name, ok, msg });
  }
  const failed = results.filter((r) => !r.ok).length;
  window.__RESULTS = { total: results.length, failed, results };
  document.getElementById('summary').textContent = `${results.length - failed} passed, ${failed} failed`;
  document.title = failed ? `FAIL ${failed}` : `PASS ${results.length}`;
}
main();
