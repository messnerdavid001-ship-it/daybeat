// The store: in-memory snapshot for synchronous reads, durable async writes, change notification,
// settings, multi-tab refresh. createStore() makes an independent instance (tests use several);
// index.js exports one shared instance.

import { KINDS, SCHEMA_VERSION, DB_NAME, DataError, ID_RE, prepare, checkSetting, tryCheckSetting, deepFreeze } from './schema.js';
import { parseDayKey, toDate, dayKey, eventSpan, overlaps } from './dates.js';
import { MemoryAdapter, LocalStorageAdapter, IdbAdapter, STORES, wrapStorageError, safeLocalStorage } from './adapters.js';
import { migrateBundle, MIGRATIONS } from './migrations.js';

const MIRROR = { theme: 'app.theme', accent: 'app.accent' }; // read by the flash-free boot script
const ID_PREFIX = { event: 'ev', alarm: 'al', message: 'ms', checkin: 'ck', daily: 'dy', action: 'ac', task: 'tk' };

const MSG_MEMORY =
  'Saving is not available on this device right now (the browser is blocking storage, for example in private browsing). What you add will be lost when you close the app. Export a backup before you leave.';
const MSG_FALLBACK =
  "The browser's main storage is unavailable, so the app is using a small fallback storage. Export a backup now and then.";

function randomHex(bytes) {
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    const a = new Uint8Array(bytes);
    c.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let s = '';
  for (let i = 0; i < bytes; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return s;
}

function assertKind(kind) {
  if (!KINDS.includes(kind)) throw new DataError('invalid', `Unknown kind "${String(kind).slice(0, 40)}"`);
}

function boundMs(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return parseDayKey(v).getTime();
  return toDate(v).getTime();
}

function stripMeta(id, value) {
  // The safety snapshot can be big; keep only its label/date in memory.
  if (id === 'snapshot' && value && typeof value === 'object') return { label: value.label, takenAt: value.takenAt };
  return value;
}

export function createStore() {
  let adapter = null;
  let ready = false;
  let readOnly = false;
  let readOnlyMessage = '';
  let info = null;
  let clock = () => new Date();
  let cache = new Map(KINDS.map((k) => [k, new Map()]));
  const settings = new Map();
  const meta = new Map();
  const listeners = new Set();
  let queue = Promise.resolve();
  let channel = null;
  let storageHandler = null;
  let initPromise = null;
  const instanceId = randomHex(6);

  const now = () => clock();
  const nowIso = () => now().toISOString();

  function enqueue(fn) {
    const p = queue.then(() => fn());
    queue = p.catch(() => {});
    return p;
  }

  function emit(ev) {
    for (const cb of [...listeners]) {
      try {
        cb(ev);
      } catch (e) {
        console.error('[data] onChange listener failed', e);
      }
    }
  }

  function broadcast(ev) {
    const msg = { from: instanceId, reason: ev.reason, kinds: ev.kinds };
    try {
      channel?.postMessage(msg);
    } catch {
      /* ignore */
    }
    if (storageHandler) {
      try {
        safeLocalStorage()?.setItem(`${DB_NAME}:ping`, JSON.stringify({ ...msg, n: Math.random() }));
      } catch {
        /* ignore */
      }
    }
  }

  function mirrorSettings() {
    const ls = safeLocalStorage();
    if (!ls) return;
    for (const [key, lsKey] of Object.entries(MIRROR)) {
      try {
        const v = settings.get(key);
        if (v === undefined) ls.removeItem(lsKey);
        else ls.setItem(lsKey, String(v));
      } catch {
        /* storage blocked: the mirror is only a convenience */
      }
    }
  }

  function assertReady() {
    if (!ready) throw new DataError('not_initialized', 'The data store is not ready yet. Call store.init() first.');
  }
  function assertWritable() {
    assertReady();
    if (readOnly) throw new DataError('read_only', readOnlyMessage || 'The data is read-only right now.');
  }

  // ---------------------------------------------------------------- loading

  function fillCache(data) {
    let skipped = 0;
    for (const k of KINDS) {
      const m = new Map();
      for (const rec of data[k] ?? []) {
        if (rec && typeof rec === 'object' && typeof rec.id === 'string' && ID_RE.test(rec.id)) m.set(rec.id, deepFreeze(rec));
        else skipped++;
      }
      cache.set(k, m);
    }
    settings.clear();
    for (const rec of data.setting ?? []) {
      if (rec && typeof rec.id === 'string') {
        const r = tryCheckSetting(rec.id, rec.value);
        if (r.ok) settings.set(rec.id, r.value);
        else skipped++;
      }
    }
    meta.clear();
    for (const rec of data.meta ?? []) if (rec && typeof rec.id === 'string') meta.set(rec.id, stripMeta(rec.id, rec.value));
    return skipped;
  }

  function refreshStores(data, stores) {
    for (const s of stores) {
      if (KINDS.includes(s)) {
        const m = new Map();
        for (const rec of data[s] ?? []) if (rec && typeof rec.id === 'string' && ID_RE.test(rec.id)) m.set(rec.id, deepFreeze(rec));
        cache.set(s, m);
      } else if (s === 'setting') {
        settings.clear();
        for (const rec of data.setting ?? []) {
          const r = tryCheckSetting(rec.id, rec.value);
          if (r.ok) settings.set(rec.id, r.value);
        }
        mirrorSettings();
      } else if (s === 'meta') {
        meta.clear();
        for (const rec of data.meta ?? []) meta.set(rec.id, stripMeta(rec.id, rec.value));
      }
    }
  }

  function bundleFromCache() {
    const kinds = {};
    for (const k of KINDS) kinds[k] = [...cache.get(k).values()];
    return { kinds, settings: Object.fromEntries(settings) };
  }

  async function takeSnapshotOps(label) {
    const b = bundleFromCache();
    return { id: 'snapshot', value: { label, takenAt: nowIso(), version: meta.get('schemaVersion') ?? SCHEMA_VERSION, data: b } };
  }

  async function doInit(opts) {
    if (opts.clock) clock = opts.clock;
    const warnings = [];
    let candidates;
    const onStale = () => {
      readOnly = true;
      readOnlyMessage = 'Another window updated the app. Reload to continue.';
      emit({ reason: 'stale', kinds: [], origin: 'remote' });
    };
    if (opts.adapter) candidates = [opts.adapter];
    else if (opts.backend === 'memory') candidates = [new MemoryAdapter()];
    else if (opts.backend === 'localstorage') candidates = [new LocalStorageAdapter(), new MemoryAdapter()];
    else candidates = [new IdbAdapter({ name: opts.dbName ?? DB_NAME, onStale }), new LocalStorageAdapter(), new MemoryAdapter()];

    let chosen = null;
    let loaded = null;
    let fellBack = false;
    let newerMessage = '';
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      try {
        await cand.open();
        loaded = await cand.readAll(STORES);
        chosen = cand;
        break;
      } catch (e) {
        try {
          cand.close();
        } catch {
          /* ignore */
        }
        if (e && e.code === 'read_only') newerMessage = e.message;
        else if (cand.backend !== 'memory') warnings.push(`${cand.label} is unavailable: ${e.message}`);
        if (i < candidates.length - 1) fellBack = true;
      }
    }
    if (!chosen) {
      chosen = new MemoryAdapter();
      loaded = await chosen.readAll(STORES);
      fellBack = true;
    }
    adapter = chosen;
    readOnly = false;
    readOnlyMessage = '';
    if (newerMessage) {
      readOnly = true;
      readOnlyMessage = newerMessage;
      warnings.push(newerMessage);
    }

    const skipped = fillCache(loaded);
    if (skipped > 0) warnings.push(`${skipped} stored item(s) could not be read and were left untouched.`);
    const hadRecords = KINDS.some((k) => cache.get(k).size > 0);
    const wasInitialized = meta.get('initialized') === true;
    const firstRun = !wasInitialized && !hadRecords && settings.size === 0;

    // Schema version / migrations
    let migratedFrom = null;
    const stored = meta.get('schemaVersion');
    const migrations = opts.migrations ?? MIGRATIONS;
    const target = opts.schemaVersion ?? SCHEMA_VERSION;
    if (!readOnly) {
      try {
        if (stored === undefined) {
          await adapter.apply([{ store: 'meta', put: { id: 'schemaVersion', value: target } }]);
          meta.set('schemaVersion', target);
        } else if (typeof stored !== 'number' || stored > target) {
          readOnly = true;
          readOnlyMessage = 'Your data was saved by a newer version of the app, so it is read-only here. Reload to get the update.';
          warnings.push(readOnlyMessage);
        } else if (stored < target) {
          const snap = await takeSnapshotOps(`before upgrade from version ${stored}`);
          const migrated = migrateBundle(bundleFromCache(), stored, target, migrations);
          const ops = [{ store: 'meta', put: snap }];
          for (const k of KINDS) {
            ops.push({ store: k, clear: true });
            for (const rec of migrated.kinds[k] ?? []) ops.push({ store: k, put: rec });
          }
          ops.push({ store: 'setting', clear: true });
          for (const [key, value] of Object.entries(migrated.settings ?? {})) ops.push({ store: 'setting', put: { id: key, value } });
          ops.push({ store: 'meta', put: { id: 'schemaVersion', value: target } });
          await adapter.apply(ops);
          fillCache(await adapter.readAll(STORES));
          migratedFrom = stored;
        }
      } catch (e) {
        readOnly = true;
        readOnlyMessage = `Your data could not be upgraded and was left untouched (${e.message}).`;
        warnings.push(readOnlyMessage);
      }
    }

    const degraded = fellBack || adapter.backend === 'memory' || readOnly;
    if (adapter.backend === 'memory' && !opts.adapter && opts.backend !== 'memory') warnings.unshift(MSG_MEMORY);
    else if (adapter.backend === 'localstorage' && fellBack) warnings.unshift(MSG_FALLBACK);

    // multi-tab
    if (adapter.shared && !opts.noChannel) {
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          channel = new BroadcastChannel(`${opts.dbName ?? DB_NAME}-changes`);
          channel.onmessage = (e) => onRemote(e.data);
        } else if (globalThis.addEventListener && safeLocalStorage()) {
          storageHandler = (e) => {
            if (e.key === `${DB_NAME}:ping` && e.newValue) {
              try {
                onRemote(JSON.parse(e.newValue));
              } catch {
                /* ignore */
              }
            }
          };
          globalThis.addEventListener('storage', storageHandler);
        }
      } catch {
        /* single-tab is acceptable */
      }
    }

    mirrorSettings();
    ready = true;
    info = Object.freeze({
      backend: adapter.backend,
      persistent: adapter.persistent && !readOnly,
      degraded,
      readOnly,
      firstRun,
      schemaVersion: meta.get('schemaVersion') ?? target,
      migratedFrom,
      warnings: Object.freeze(warnings),
    });
    return info;
  }

  function onRemote(msg) {
    if (!msg || typeof msg !== 'object' || msg.from === instanceId || !ready) return;
    const raw = Array.isArray(msg.kinds) ? msg.kinds : [];
    const all = raw.includes('*');
    const stores = all ? [...STORES] : [...new Set(raw.filter((k) => STORES.includes(k)))];
    if (!stores.length) return;
    enqueue(async () => {
      const data = await adapter.readAll(stores);
      refreshStores(data, stores);
      emit({ reason: typeof msg.reason === 'string' ? msg.reason : 'bulk', kinds: all ? ['*'] : stores, origin: 'remote' });
    }).catch(() => {});
  }

  // ---------------------------------------------------------------- write path

  /**
   * Apply one atomic change. MUST be called inside enqueue() (or from a function that was).
   * spec: { puts:[{kind,record}], removes:[{kind,id}], clearKinds:[kind], clearSettings, settingSet:{k:v}, settingRemove:[k],
   *         metaPuts:[{id,value}], metaDels:[id], reason, kinds, markInit }
   */
  async function commitNow(spec) {
    assertWritable();
    const {
      puts = [],
      removes = [],
      clearKinds = [],
      clearSettings = false,
      settingSet = {},
      settingRemove = [],
      metaPuts = [],
      metaDels = [],
      reason,
      markInit = true,
    } = spec;
    const ops = [];
    for (const k of clearKinds) ops.push({ store: k, clear: true });
    if (clearSettings) ops.push({ store: 'setting', clear: true });
    for (const { kind, record } of puts) ops.push({ store: kind, put: record });
    for (const { kind, id } of removes) ops.push({ store: kind, del: id });
    for (const [k, v] of Object.entries(settingSet)) ops.push({ store: 'setting', put: { id: k, value: v } });
    for (const k of settingRemove) ops.push({ store: 'setting', del: k });
    for (const m of metaPuts) ops.push({ store: 'meta', put: m });
    for (const id of metaDels) ops.push({ store: 'meta', del: id });
    const touchesData = puts.length || removes.length || clearKinds.length;
    const addInit = markInit && touchesData && meta.get('initialized') !== true;
    if (addInit) ops.push({ store: 'meta', put: { id: 'initialized', value: true } });
    if (!ops.length) return;

    try {
      await adapter.apply(ops);
    } catch (e) {
      throw wrapStorageError(e);
    }

    // Durable: now mirror the same operations into the in-memory snapshot.
    for (const op of ops) {
      if (KINDS.includes(op.store)) {
        const m = cache.get(op.store);
        if (op.clear) m.clear();
        else if (op.put) m.set(op.put.id, deepFreeze(op.put));
        else if (op.del !== undefined) m.delete(op.del);
      } else if (op.store === 'setting') {
        if (op.clear) settings.clear();
        else if (op.put) settings.set(op.put.id, op.put.value);
        else if (op.del !== undefined) settings.delete(op.del);
      } else if (op.store === 'meta') {
        if (op.clear) meta.clear();
        else if (op.put) meta.set(op.put.id, stripMeta(op.put.id, op.put.value));
        else if (op.del !== undefined) meta.delete(op.del);
      }
    }
    if (clearSettings || Object.keys(settingSet).length || settingRemove.length) mirrorSettings();

    const kinds = new Set(spec.kinds ?? []);
    if (!spec.kinds) {
      for (const p of puts) kinds.add(p.kind);
      for (const r of removes) kinds.add(r.kind);
      for (const k of clearKinds) kinds.add(k);
      if (clearSettings || Object.keys(settingSet).length || settingRemove.length) kinds.add('setting');
    }
    const ev = { reason: reason ?? 'bulk', kinds: [...kinds], origin: 'local' };
    emit(ev);
    broadcast(ev);
  }

  const commit = (spec) => enqueue(() => commitNow(spec));

  // ---------------------------------------------------------------- reads

  const DEFAULT_SORT = {
    event: { by: (r) => eventSpan(r).startMs, desc: false },
    alarm: { by: (r) => r.time, desc: false },
    message: { by: (r) => r.at, desc: true },
    checkin: { by: (r) => r.at, desc: true },
    daily: { by: (r) => r.date, desc: false },
    action: { by: (r) => r.at, desc: true },
    task: { by: (r) => `${r.due || '9999-99-99'} ${r.time || '99:99'}`, desc: false },
  };

  function list(kind, opts = {}) {
    assertReady();
    assertKind(kind);
    let arr = [...cache.get(kind).values()];
    const hasFrom = opts.from !== undefined && opts.from !== null;
    const hasTo = opts.to !== undefined && opts.to !== null;
    if (hasFrom || hasTo) {
      const fromMs = hasFrom ? boundMs(opts.from) : -Infinity;
      const toMs = hasTo ? boundMs(opts.to) : Infinity;
      if (kind === 'event') arr = arr.filter((r) => overlaps(eventSpan(r), fromMs, toMs));
      else if (kind === 'daily') {
        const f = hasFrom ? dayKey(new Date(fromMs)) : '';
        const t = hasTo ? dayKey(new Date(toMs)) : '9999-99-99';
        arr = arr.filter((r) => r.date >= f && r.date < t);
      } else if (kind === 'task') {
        const f = hasFrom ? dayKey(new Date(fromMs)) : '';
        const t = hasTo ? dayKey(new Date(toMs)) : '9999-99-99';
        arr = arr.filter((r) => r.due && r.due >= f && r.due < t);
      } else if (kind !== 'alarm') {
        arr = arr.filter((r) => {
          const ms = Date.parse(r.at);
          return ms >= fromMs && ms < toMs;
        });
      }
    }
    if (typeof opts.where === 'function') arr = arr.filter(opts.where);
    let keyFn;
    let desc;
    if (typeof opts.sort === 'function') {
      keyFn = opts.sort;
      desc = !!opts.desc;
    } else if (typeof opts.sort === 'string') {
      const f = opts.sort;
      keyFn = (r) => r[f];
      desc = !!opts.desc;
    } else {
      keyFn = DEFAULT_SORT[kind].by;
      desc = opts.desc === undefined ? DEFAULT_SORT[kind].desc : !!opts.desc;
    }
    const dec = arr.map((r) => [keyFn(r), r]);
    dec.sort((a, b) => {
      const x = a[0];
      const y = b[0];
      let c = x < y ? -1 : x > y ? 1 : 0;
      if (desc) c = -c;
      if (c !== 0) return c;
      return a[1].id < b[1].id ? -1 : a[1].id > b[1].id ? 1 : 0;
    });
    arr = dec.map((d) => d[1]);
    if (Number.isInteger(opts.limit) && opts.limit >= 0) arr = arr.slice(0, opts.limit);
    return arr;
  }

  function get(kind, id) {
    assertReady();
    assertKind(kind);
    return cache.get(kind).get(id);
  }

  function newId(kind) {
    assertKind(kind);
    return `${ID_PREFIX[kind]}_${Date.now().toString(36)}${randomHex(4)}`;
  }

  const prepOpts = (existing, defaultSource = 'user') => ({ existing, nowIso: nowIso(), defaultSource, newId });

  // ---------------------------------------------------------------- public writes

  async function put(kind, obj) {
    assertKind(kind);
    return enqueue(async () => {
      assertWritable();
      const existing = obj && typeof obj.id === 'string' ? cache.get(kind).get(obj.id) : undefined;
      const rec = prepare(kind, obj, prepOpts(existing));
      await commitNow({ puts: [{ kind, record: rec }], reason: 'put' });
      return rec;
    });
  }

  async function update(kind, id, patch) {
    assertKind(kind);
    return enqueue(async () => {
      assertWritable();
      const existing = cache.get(kind).get(id);
      if (!existing) throw new DataError('not_found', 'That item no longer exists.');
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new DataError('invalid', 'patch must be an object');
      const merged = { ...existing, ...patch, id: existing.id };
      const rec = prepare(kind, merged, prepOpts(existing));
      await commitNow({ puts: [{ kind, record: rec }], reason: 'put' });
      return rec;
    });
  }

  async function remove(kind, id) {
    assertKind(kind);
    return enqueue(async () => {
      assertWritable();
      if (!cache.get(kind).has(id)) return false;
      await commitNow({ removes: [{ kind, id }], reason: 'remove' });
      return true;
    });
  }

  function prepareMany(kind, objs, extra) {
    if (!Array.isArray(objs)) throw new DataError('invalid', 'Expected a list of items.');
    const recs = [];
    const seen = new Set();
    objs.forEach((o, i) => {
      try {
        const existing = o && typeof o.id === 'string' ? cache.get(kind).get(o.id) : undefined;
        const rec = prepare(kind, o, { ...prepOpts(existing), ...extra });
        if (seen.has(rec.id)) throw new DataError('invalid', `duplicate id ${rec.id}`);
        seen.add(rec.id);
        recs.push(rec);
      } catch (e) {
        if (!(e instanceof DataError)) throw e;
        throw new DataError('invalid', `Item ${i + 1}: ${e.message}`, [{ index: i, ...(e.details?.[0] ?? { field: '', message: e.message }) }]);
      }
    });
    return recs;
  }

  async function putMany(kind, objs) {
    assertKind(kind);
    return enqueue(async () => {
      assertWritable();
      const recs = prepareMany(kind, objs);
      if (!recs.length) return [];
      await commitNow({ puts: recs.map((record) => ({ kind, record })), reason: 'bulk' });
      return recs;
    });
  }

  async function removeMany(kind, ids) {
    assertKind(kind);
    return enqueue(async () => {
      assertWritable();
      if (!Array.isArray(ids)) throw new DataError('invalid', 'Expected a list of ids.');
      const present = [...new Set(ids)].filter((id) => cache.get(kind).has(id));
      if (!present.length) return 0;
      await commitNow({ removes: present.map((id) => ({ kind, id })), reason: 'bulk' });
      return present.length;
    });
  }

  async function batch(opList) {
    return enqueue(async () => {
      assertWritable();
      if (!Array.isArray(opList)) throw new DataError('invalid', 'Expected a list of operations.');
      const puts = [];
      const removes = [];
      const putRecs = [];
      const removedIds = [];
      opList.forEach((op, i) => {
        if (!op || typeof op !== 'object') throw new DataError('invalid', `Operation ${i + 1} is not an object`);
        assertKind(op.kind);
        if (op.op === 'put') {
          const existing = op.record && typeof op.record.id === 'string' ? cache.get(op.kind).get(op.record.id) : undefined;
          const rec = prepare(op.kind, op.record, prepOpts(existing));
          puts.push({ kind: op.kind, record: rec });
          putRecs.push(rec);
        } else if (op.op === 'remove') {
          if (typeof op.id !== 'string') throw new DataError('invalid', `Operation ${i + 1} needs an id`);
          if (cache.get(op.kind).has(op.id)) {
            removes.push({ kind: op.kind, id: op.id });
            removedIds.push(op.id);
          }
        } else throw new DataError('invalid', `Operation ${i + 1}: op must be "put" or "remove"`);
      });
      await commitNow({ puts, removes, reason: 'bulk' });
      return { put: putRecs, removed: removedIds };
    });
  }

  // ---------------------------------------------------------------- settings

  const settingsApi = {
    get(key, fallback) {
      assertReady();
      return settings.has(key) ? settings.get(key) : fallback;
    },
    all() {
      assertReady();
      return Object.freeze(Object.fromEntries(settings));
    },
    async set(key, value) {
      const v = checkSetting(key, value);
      return enqueue(async () => {
        assertWritable();
        await commitNow({ settingSet: { [key]: v }, reason: 'settings', markInit: false });
        return v;
      });
    },
    async setMany(obj) {
      const clean = {};
      for (const [k, v] of Object.entries(obj ?? {})) clean[k] = checkSetting(k, v);
      return enqueue(async () => {
        assertWritable();
        await commitNow({ settingSet: clean, reason: 'settings', markInit: false });
        return clean;
      });
    },
    async remove(key) {
      return enqueue(async () => {
        assertWritable();
        if (!settings.has(key)) return false;
        await commitNow({ settingRemove: [key], reason: 'settings', markInit: false });
        return true;
      });
    },
  };

  // ---------------------------------------------------------------- wipe, persistence, lifecycle

  async function wipeAll(opts = {}) {
    if (!opts || opts.confirmed !== true) throw new DataError('not_confirmed', 'Deleting everything needs an explicit confirmation.');
    return enqueue(async () => {
      assertWritable();
      await commitNow({
        clearKinds: [...KINDS],
        clearSettings: true,
        metaDels: ['snapshot'],
        metaPuts: [{ id: 'initialized', value: true }],
        reason: 'wipe',
        kinds: ['*'],
      });
    });
  }

  async function requestPersistence() {
    try {
      if (globalThis.navigator?.storage?.persist) return !!(await globalThis.navigator.storage.persist());
    } catch {
      /* ignore */
    }
    return false;
  }

  async function estimate() {
    try {
      if (globalThis.navigator?.storage?.estimate) {
        const e = await globalThis.navigator.storage.estimate();
        return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  async function init(opts = {}) {
    if (ready) return info;
    if (!initPromise) {
      initPromise = doInit(opts).finally(() => {
        initPromise = null;
      });
    }
    return initPromise;
  }

  function close() {
    ready = false;
    try {
      adapter?.close();
    } catch {
      /* ignore */
    }
    try {
      channel?.close();
    } catch {
      /* ignore */
    }
    channel = null;
    if (storageHandler) {
      globalThis.removeEventListener?.('storage', storageHandler);
      storageHandler = null;
    }
    listeners.clear();
    cache = new Map(KINDS.map((k) => [k, new Map()]));
    settings.clear();
    meta.clear();
    adapter = null;
    info = null;
    queue = Promise.resolve();
  }

  const api = {
    init,
    close,
    info: () => info,
    list,
    get,
    put,
    update,
    remove,
    putMany,
    removeMany,
    batch,
    count(kind) {
      assertReady();
      assertKind(kind);
      return cache.get(kind).size;
    },
    counts() {
      assertReady();
      return Object.fromEntries(KINDS.map((k) => [k, cache.get(k).size]));
    },
    hasUserData() {
      assertReady();
      return KINDS.some((k) => [...cache.get(k).values()].some((r) => r.source !== 'demo'));
    },
    isEmpty() {
      assertReady();
      return KINDS.every((k) => cache.get(k).size === 0);
    },
    newId,
    settings: settingsApi,
    wipeAll,
    onChange(cb) {
      if (typeof cb !== 'function') throw new DataError('invalid', 'onChange needs a function');
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    requestPersistence,
    estimate,
  };

  // Internal hooks for game.js / backup.js / demo.js (not part of the public contract).
  Object.defineProperty(api, '_internal', {
    enumerable: false,
    value: {
      enqueue,
      commitNow,
      commit,
      now,
      nowIso,
      prepOpts,
      prepareMany,
      cache: (kind) => cache.get(kind),
      bundle: bundleFromCache,
      takeSnapshotOp: takeSnapshotOps,
      readMeta: async (id) => {
        const d = await adapter.readAll(['meta']);
        return d.meta.find((m) => m.id === id)?.value;
      },
      metaInfo: (id) => meta.get(id),
      assertWritable,
      isReadOnly: () => readOnly,
    },
  });

  return api;
}
