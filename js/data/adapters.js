// Storage adapters. Each one stores records in named "stores" (the entity kinds plus 'setting' and 'meta')
// and applies a list of operations ATOMICALLY: either every op is stored or none is.
//
//   open()                   -> Promise<void>      (throws DataError)
//   readAll(stores?)         -> Promise<{store: record[]}>
//   apply(ops)               -> Promise<void>      ops: {store, put:record} | {store, del:id} | {store, clear:true}
//   close()
// Fields: label, backend ('indexeddb'|'localstorage'|'memory'), persistent (bool), shared (bool: other tabs see it)

import { KINDS, DB_NAME, DataError } from './schema.js';

export const STORES = Object.freeze([...KINDS, 'setting', 'meta']);
const IDB_VERSION = 2;

/** window.localStorage or null (also null outside a browser page, so Node never touches its experimental global). */
export function safeLocalStorage() {
  try {
    return typeof document === 'undefined' ? null : (globalThis.localStorage ?? null);
  } catch {
    return null; // access can throw when storage is blocked
  }
}

export function wrapStorageError(err) {
  if (err instanceof DataError) return err;
  const name = (err && err.name) || 'Error';
  if (name === 'QuotaExceededError' || (err && err.code === 22) || /quota/i.test(String(err && err.message))) {
    return new DataError('quota_exceeded', 'This device has no storage space left for the app. Free up space or export a backup, then try again.');
  }
  if (name === 'VersionError') {
    return new DataError('read_only', 'This device holds data from a newer version of the app. Reload to update the app.');
  }
  return new DataError('storage_failed', `The device storage refused the change (${name}). Your data was not changed.`);
}

// ------------------------------------------------------------------ memory

export class MemoryAdapter {
  /** shared: pass the same `data` map to several adapters to simulate several tabs on one database. */
  constructor({ data, shared = false } = {}) {
    this.label = 'memory';
    this.backend = 'memory';
    this.persistent = false;
    this.shared = shared;
    this.data = data ?? new Map(STORES.map((s) => [s, new Map()]));
  }

  async open() {}

  async readAll(stores = STORES) {
    const out = {};
    for (const s of stores) out[s] = [...(this.data.get(s) ?? new Map()).values()];
    return out;
  }

  async apply(ops) {
    // Stage on copies so that a failure cannot leave a half-applied state.
    const staged = new Map();
    const get = (s) => {
      if (!staged.has(s)) staged.set(s, new Map(this.data.get(s) ?? []));
      return staged.get(s);
    };
    for (const op of ops) {
      const m = get(op.store);
      if (op.clear) m.clear();
      else if (op.put) m.set(op.put.id, op.put);
      else if (op.del !== undefined) m.delete(op.del);
    }
    for (const [s, m] of staged) this.data.set(s, m);
  }

  close() {}
}

// ------------------------------------------------------------------ localStorage

export class LocalStorageAdapter {
  constructor({ storage = safeLocalStorage(), prefix = `${DB_NAME}:` } = {}) {
    this.label = 'localStorage';
    this.backend = 'localstorage';
    this.persistent = true;
    this.shared = true;
    this.ls = storage;
    this.prefix = prefix;
    this.mem = new Map();
  }

  async open() {
    if (!this.ls) throw new DataError('storage_failed', 'localStorage is not available');
    try {
      const k = `${this.prefix}probe`;
      this.ls.setItem(k, '1');
      this.ls.removeItem(k);
    } catch (e) {
      throw wrapStorageError(e);
    }
  }

  async readAll(stores = STORES) {
    const out = {};
    for (const s of stores) {
      let raw;
      try {
        raw = this.ls.getItem(this.prefix + s);
      } catch (e) {
        throw wrapStorageError(e);
      }
      if (raw === null) {
        out[s] = [];
        continue;
      }
      let arr;
      try {
        arr = JSON.parse(raw);
      } catch {
        throw new DataError('storage_failed', `Stored ${s} data is damaged; it was left untouched.`);
      }
      if (!Array.isArray(arr)) throw new DataError('storage_failed', `Stored ${s} data is damaged; it was left untouched.`);
      out[s] = arr;
    }
    return out;
  }

  async apply(ops) {
    const touched = [...new Set(ops.map((o) => o.store))];
    const current = await this.readAll(touched);
    const maps = {};
    for (const s of touched) maps[s] = new Map(current[s].map((r) => [r.id, r]));
    for (const op of ops) {
      const m = maps[op.store];
      if (op.clear) m.clear();
      else if (op.put) m.set(op.put.id, op.put);
      else if (op.del !== undefined) m.delete(op.del);
    }
    const written = [];
    try {
      for (const s of touched) {
        const key = this.prefix + s;
        const old = this.ls.getItem(key);
        this.ls.setItem(key, JSON.stringify([...maps[s].values()]));
        written.push([key, old]);
      }
    } catch (e) {
      for (const [key, old] of written.reverse()) {
        try {
          if (old === null) this.ls.removeItem(key);
          else this.ls.setItem(key, old);
        } catch {
          /* best effort rollback */
        }
      }
      throw wrapStorageError(e);
    }
  }

  close() {}
}

// ------------------------------------------------------------------ IndexedDB

export class IdbAdapter {
  constructor({ name = DB_NAME, factory = globalThis.indexedDB, onStale } = {}) {
    this.label = 'IndexedDB';
    this.backend = 'indexeddb';
    this.persistent = true;
    this.shared = true;
    this.name = name;
    this.factory = factory;
    this.onStale = onStale;
    this.db = null;
  }

  async open() {
    if (!this.factory) throw new DataError('storage_failed', 'IndexedDB is not available');
    this.db = await new Promise((resolve, reject) => {
      let req;
      try {
        req = this.factory.open(this.name, IDB_VERSION);
      } catch (e) {
        reject(wrapStorageError(e));
        return;
      }
      const timer = setTimeout(
        () => reject(new DataError('storage_failed', 'Storage is blocked by another open window of the app. Close the other windows and reload.')),
        8000,
      );
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        resolve(req.result);
      };
      req.onerror = () => {
        clearTimeout(timer);
        reject(wrapStorageError(req.error));
      };
    });
    this.db.onversionchange = () => {
      try {
        this.db.close();
      } catch {
        /* ignore */
      }
      this.db = null;
      this.onStale?.();
    };
    // Prove that we can really write (some private modes open fine but refuse writes).
    await this.apply([{ store: 'meta', put: { id: 'probe', value: 1 } }]);
  }

  _tx(stores, mode) {
    if (!this.db) throw new DataError('storage_failed', 'The storage connection was closed. Reload the app.');
    return this.db.transaction(stores, mode);
  }

  readAll(stores = STORES) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = this._tx(stores, 'readonly');
      } catch (e) {
        reject(wrapStorageError(e));
        return;
      }
      const out = {};
      for (const s of stores) {
        const r = tx.objectStore(s).getAll();
        r.onsuccess = () => {
          out[s] = r.result;
        };
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(wrapStorageError(tx.error));
      tx.onabort = () => reject(wrapStorageError(tx.error));
    });
  }

  apply(ops) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = this._tx([...new Set(ops.map((o) => o.store))], 'readwrite');
        for (const op of ops) {
          const os = tx.objectStore(op.store);
          if (op.clear) os.clear();
          else if (op.put) os.put(op.put);
          else if (op.del !== undefined) os.delete(op.del);
        }
      } catch (e) {
        try {
          tx?.abort();
        } catch {
          /* already finished */
        }
        reject(wrapStorageError(e));
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(wrapStorageError(tx.error));
      tx.onabort = () => reject(wrapStorageError(tx.error));
    });
  }

  close() {
    try {
      this.db?.close();
    } catch {
      /* ignore */
    }
    this.db = null;
  }
}
