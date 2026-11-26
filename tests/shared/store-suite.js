import { SCHEMA_VERSION } from '../../js/data/schema.js';
// Storage tests that run UNCHANGED in Node (memory adapter) and in a real browser (IndexedDB).
// ctx = { backend, fresh(), open(backing, opts?) -> initialized store, dispose(backing) }
//   fresh() makes a new empty backing database; open() opens a store on it (several opens = several "tabs").
import { createGame } from '../../js/data/game.js';
import { createDemo } from '../../js/data/demo.js';
import { createBackup } from '../../js/data/backup.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await sleep(15);
  }
  return cond();
}

export function storeSuite({ test, assert }, ctx) {
  const NOW = new Date('2026-11-25T12:00:00.000Z');
  const clock = () => new Date(NOW);
  const fixedOpts = { clock };

  async function withStore(fn, opts = {}) {
    const backing = await ctx.fresh();
    const stores = [];
    const open = async (o = {}) => {
      const s = await ctx.open(backing, { ...fixedOpts, ...opts, ...o });
      stores.push(s);
      return s;
    };
    try {
      return await fn(open, backing);
    } finally {
      for (const s of stores) s.close();
      await ctx.dispose(backing);
    }
  }

  test(`[${ctx.backend}] init on an empty database reports first run and a healthy backend`, () =>
    withStore(async (open) => {
      const s = await open();
      const info = s.info();
      assert.equal(info.firstRun, true);
      assert.equal(info.readOnly, false);
      assert.equal(info.backend, ctx.backend);
      assert.equal(info.schemaVersion, SCHEMA_VERSION);
      assert.equal(s.isEmpty(), true);
      assert.equal(await s.init(), info, 'second init() returns the same info');
    }));

  test(`[${ctx.backend}] put/get/list/update/remove round trip and survive a reopen`, () =>
    withStore(async (open) => {
      const s = await open();
      const ev = await s.put('event', { title: 'Dentist', start: '2026-11-26T09:00:00Z', end: '2026-11-26T09:30:00Z', location: 'Sample Dental' });
      assert.match(ev.id, /^ev_/);
      assert.equal(ev.source, 'user');
      assert.ok(Object.isFrozen(ev));
      assert.equal(s.get('event', ev.id).title, 'Dentist');
      const upd = await s.update('event', ev.id, { title: 'Dentist (moved)' });
      assert.equal(upd.title, 'Dentist (moved)');
      assert.equal(upd.createdAt, ev.createdAt);
      await s.put('alarm', { time: '06:30', days: [5, 1, 1, 3], label: 'Work' });
      assert.deepEqual(s.list('alarm')[0].days, [1, 3, 5]);
      s.close();

      const s2 = await open();
      assert.equal(s2.info().firstRun, false);
      assert.equal(s2.list('event').length, 1);
      assert.equal(s2.get('event', ev.id).title, 'Dentist (moved)');
      assert.equal(await s2.remove('event', ev.id), true);
      assert.equal(await s2.remove('event', ev.id), false);
      assert.equal(s2.count('event'), 0);
    }));

  test(`[${ctx.backend}] invalid input is rejected with field details and nothing is written`, () =>
    withStore(async (open) => {
      const s = await open();
      await assert.rejects(s.put('event', { title: '', start: 'nope' }), (e) => e.code === 'invalid' && Array.isArray(e.details) && e.details.length >= 2);
      await assert.rejects(s.put('alarm', { time: '25:00' }), (e) => e.code === 'invalid');
      await assert.rejects(s.put('checkin', { day: '2026-02-30' }), (e) => e.code === 'invalid');
      await assert.rejects(s.put('nonsense', {}), (e) => e.code === 'invalid');
      await assert.rejects(s.update('event', 'missing', { title: 'x' }), (e) => e.code === 'not_found');
      assert.equal(s.isEmpty(), true);
    }));

  test(`[${ctx.backend}] putMany is all-or-nothing`, () =>
    withStore(async (open) => {
      const s = await open();
      await assert.rejects(
        s.putMany('message', [{ text: 'good one' }, { text: 'good two' }, { text: '' }]),
        (e) => e.code === 'invalid' && /Item 3/.test(e.message),
      );
      assert.equal(s.count('message'), 0);
      const recs = await s.putMany('message', [{ text: 'a' }, { text: 'b' }]);
      assert.equal(recs.length, 2);
      assert.equal(s.count('message'), 2);
      const r = await s.batch([{ op: 'put', kind: 'alarm', record: { time: '07:00' } }, { op: 'remove', kind: 'message', id: recs[0].id }]);
      assert.equal(r.put.length, 1);
      assert.equal(s.count('message'), 1);
    }));

  test(`[${ctx.backend}] onChange fires once per write with kinds and reason, and can be unsubscribed`, () =>
    withStore(async (open) => {
      const s = await open();
      const seen = [];
      const off = s.onChange((ev) => seen.push(ev));
      await s.put('message', { text: 'hi' });
      await s.batch([{ op: 'put', kind: 'alarm', record: { time: '07:00' } }, { op: 'put', kind: 'event', record: { title: 'x', start: '2026-11-26T09:00:00Z' } }]);
      await s.settings.set('theme', 'dark');
      assert.deepEqual(seen.map((e) => e.reason), ['put', 'bulk', 'settings']);
      assert.deepEqual(seen[0].kinds, ['message']);
      assert.deepEqual([...seen[1].kinds].sort(), ['alarm', 'event']);
      assert.deepEqual(seen[2].kinds, ['setting']);
      assert.equal(seen[0].origin, 'local');
      off();
      await s.put('message', { text: 'again' });
      assert.equal(seen.length, 3);
      s.onChange(() => {
        throw new Error('listener bug');
      });
      await s.put('message', { text: 'listener errors must not break writes' });
    }));

  test(`[${ctx.backend}] settings are validated and persisted`, () =>
    withStore(async (open) => {
      const s = await open();
      await s.settings.set('theme', 'dark');
      await s.settings.set('ui_tab', 'quests');
      await assert.rejects(s.settings.set('theme', 'neon'), (e) => e.code === 'invalid');
      await assert.rejects(s.settings.set('__proto__', 'x'), (e) => e.code === 'invalid');
      await assert.rejects(s.settings.set('whatever', 1), (e) => e.code === 'invalid');
      s.close();
      const s2 = await open();
      assert.equal(s2.settings.get('theme'), 'dark');
      assert.equal(s2.settings.get('ui_tab'), 'quests');
      assert.equal(s2.settings.get('accent', 'violet'), 'violet');
    }));

  test(`[${ctx.backend}] wipeAll needs confirmation, deletes everything and never re-triggers first run`, () =>
    withStore(async (open) => {
      const s = await open();
      await demoFill(s);
      await assert.rejects(s.wipeAll(), (e) => e.code === 'not_confirmed');
      await assert.rejects(s.wipeAll({ confirmed: 'yes' }), (e) => e.code === 'not_confirmed');
      assert.ok(s.count('event') > 0);
      await s.wipeAll({ confirmed: true });
      assert.equal(s.isEmpty(), true);
      assert.deepEqual({ ...s.settings.all() }, {});
      s.close();
      const s2 = await open();
      assert.equal(s2.isEmpty(), true);
      assert.equal(s2.info().firstRun, false, 'a wiped app stays empty after reload');
    }));

  test(`[${ctx.backend}] a second window sees changes made in the first (multi-tab refresh)`, () =>
    withStore(async (open) => {
      const a = await open();
      const b = await open();
      const seen = [];
      b.onChange((ev) => seen.push(ev));
      await a.put('message', { text: 'from tab A' });
      assert.ok(await waitFor(() => b.count('message') === 1), 'tab B receives the new message');
      assert.equal(seen[0].origin, 'remote');
      assert.ok(seen[0].kinds.includes('message'));
      await a.wipeAll({ confirmed: true });
      assert.ok(await waitFor(() => b.count('message') === 0), 'tab B sees the wipe');
    }));

  test(`[${ctx.backend}] XP awards are written in one transaction, are idempotent and persist`, () =>
    withStore(async (open) => {
      const s = await open();
      const game = createGame(s);
      const ck = await s.put('checkin', { mood: 4 });
      const r1 = await game.award('checkin', { ref: ck.id });
      assert.equal(r1.duplicate, false);
      assert.ok(r1.xpGained >= 10);
      const r2 = await game.award('checkin', { ref: ck.id });
      assert.equal(r2.duplicate, true);
      assert.equal(r2.xpGained, 0);
      const xp = game.snapshot().xp;
      s.close();
      const s2 = await open();
      assert.equal(createGame(s2).snapshot().xp, xp);
      assert.ok(s2.count('action') >= 1);
    }));

  test(`[${ctx.backend}] backup export, wipe and import is lossless in merge and replace mode, and undo works`, () =>
    withStore(async (open) => {
      const s = await open();
      const backup = createBackup(s);
      await s.settings.set('theme', 'light');
      await s.settings.set('accent', 'mint');
      await demoFill(s);
      const before = backup.exportAll();
      const text = backup.exportJSON();
      await s.wipeAll({ confirmed: true });
      let rep = await backup.importAll(text, { mode: 'merge' });
      assert.equal(rep.errors.length, 0);
      assert.equal(rep.settingsApplied, true);
      const after = backup.exportAll();
      assert.deepEqual(strip(after), strip(before));

      await s.wipeAll({ confirmed: true });
      rep = await backup.importAll(text, { mode: 'replace' });
      assert.deepEqual(strip(backup.exportAll()), strip(before));

      // undo restores what was there before the last import
      await s.put('message', { text: 'only in the current state' });
      const cur = strip(backup.exportAll());
      await backup.importAll(text, { mode: 'replace' });
      assert.ok(backup.canUndo());
      await backup.undoLastImport();
      assert.deepEqual(strip(backup.exportAll()), cur);
      assert.equal(backup.canUndo(), null);
    }));

  async function demoFill(s) {
    const demo = createDemo(s);
    await demo.load({ now: NOW });
    await s.put('message', { text: 'a real message', from: 'Someone' });
  }
}

function strip(o) {
  const c = JSON.parse(JSON.stringify(o));
  delete c.exportedAt;
  return c;
}
