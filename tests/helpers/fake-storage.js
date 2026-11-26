// A tiny localStorage stand-in for tests. Optionally throws QuotaExceededError like a full browser store.
export class FakeStorage {
  constructor({ quotaChars = Infinity } = {}) {
    this.map = new Map();
    this.quotaChars = quotaChars;
    this.failNextSet = false;
  }
  get length() {
    return this.map.size;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw quota();
    }
    const next = [...this.map.entries()].filter(([key]) => key !== k).reduce((n, [key, val]) => n + key.length + val.length, 0) + k.length + String(v).length;
    if (next > this.quotaChars) throw quota();
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
}

function quota() {
  const e = new Error('The quota has been exceeded.');
  e.name = 'QuotaExceededError';
  e.code = 22;
  return e;
}
