// QA tests (independent): data layer behaviour with hostile and edge input, run in node on the MEMORY adapter
// (IndexedDB is absent in node, so the store reports degraded:true; that path is itself part of the test).
// Run: TZ=Europe/London node --test qa/tests/store.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../js/data');
const imp = (f) => import(pathToFileURL(path.join(dataDir, f)).href);
const { createStore } = await imp('store.js');
const { createBackup } = await imp('backup.js');
const { createDemo } = await imp('demo.js');
const { createGame } = await imp('game.js');
const schema = await imp('schema.js');
const { makeFixtures } = { makeFixtures: null };

after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref());

async function fresh({ afterInit } = {}) {
  const store = createStore();
  const info = await store.init();
  const backup = createBackup(store);
  const demo = createDemo(store);
  const game = createGame(store);
  if (afterInit) await afterInit({ store, backup, demo, game });
  return { store, backup, demo, game, info };
}
const norm = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.exportedAt; return c; };
const rejects = async (fn, code) => {
  try { await fn(); } catch (e) { assert.equal(e.name, 'DataError', `expected DataError, got ${e && e.name}: ${e && e.message}`); if (code) assert.equal(e.code, code, `code ${e.code}`); return e; }
  assert.fail('expected a DataError but nothing was thrown');
};
const polluted = () => Object.prototype.polluted === undefined && Object.prototype.polluted2 === undefined && Object.prototype.polluted3 === undefined && ({}).polluted === undefined;

test('init in an environment without storage: reports degraded + plain-English warning, never throws', async () => {
  const { info } = await fresh();
  assert.equal(info.degraded, true);
  assert.equal(info.persistent, false);
  assert.ok(info.warnings.length >= 1 && /not available|lost|backup/i.test(info.warnings[0]));
  assert.equal(info.firstRun, true);
});

test('hostile ids (__proto__, constructor, toString, hasOwnProperty) are handled without prototype pollution', async () => {
  const { store, backup } = await fresh();
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype']) {
    const saved = await store.put('message', { id, text: 'hello ' + id });
    assert.equal(saved.id, id);
    assert.equal(store.get('message', id).text, 'hello ' + id);
  }
  assert.ok(polluted());
  const text = backup.exportJSON();
  const { store: s2, backup: b2 } = await fresh();
  const rep = await b2.importAll(text, { mode: 'replace' });
  assert.equal(rep.ok, true);
  assert.equal(s2.count('message'), 5);
  assert.ok(polluted());
  assert.equal(await store.remove('message', '__proto__'), true);
  assert.equal(store.get('message', '__proto__'), undefined);
});

test('text fields: XSS strings stored as inert text; control chars, NUL, bidi overrides and lone surrogates stripped; emoji ZWJ and RTL letters preserved', async () => {
  const { store } = await fresh();
  const evil = '<img src=x onerror=alert(1)><script>alert(1)</script>"\'`${x}';
  const m = await store.put('message', { text: evil });
  assert.equal(m.text, evil, 'markup must be preserved verbatim as text (escaping is the renderer\'s job)');
  const weird = await store.put('message', { text: 'a\u0000b‮c\u0007d\uD800e👩🏽‍🚀 مرحبا 🏳️‍🌈' });
  assert.equal(weird.text, 'abcd�e👩🏽‍🚀 مرحبا 🏳️‍🌈');
  const nl = await store.put('event', { title: 'line1\nline2\tx', start: '2026-12-01T10:00:00Z' });
  assert.equal(nl.title, 'line1 line2 x');
});

test('limits: over-long values are rejected with a DataError that names the field; 500 unbroken chars fits a title? (200 max)', async () => {
  const { store } = await fresh();
  const e1 = await rejects(() => store.put('event', { title: 'W'.repeat(201), start: '2026-12-01T10:00:00Z' }), 'invalid');
  assert.ok(e1.details.some((d) => d.field === 'title'));
  await rejects(() => store.put('message', { text: 'x'.repeat(4001) }), 'invalid');
  const ok = await store.put('message', { text: 'x'.repeat(4000) });
  assert.equal(ok.text.length, 4000);
  await rejects(() => store.put('message', { text: '   ' }), 'invalid');
  await rejects(() => store.put('nope', { text: 'x' }), 'invalid');
  await rejects(() => store.put('message', null), 'invalid');
  await rejects(() => store.put('message', [1, 2]), 'invalid');
});

test('F-010: impossible calendar days and instants are rejected everywhere', async () => {
  const { store } = await fresh();
  for (const bad of ['2026-13-45', '2026-02-30', '2027-02-29', '0000-01-01', '1969-12-31', '2200-01-01', '2026-1-1', '2026-11-25T00:00']) {
    await rejects(() => store.put('checkin', { day: bad, at: '2026-11-25T10:00:00Z' }), 'invalid');
    await rejects(() => store.put('event', { title: 't', allDay: true, start: bad }), 'invalid');
  }
  await store.put('event', { title: 'leap', allDay: true, start: '2028-02-29' });
  for (const bad of ['2026-11-25T25:00:00Z', '2026-11-25T10:61:00Z', 'tomorrow', '', 12345678901234567890, NaN, {}]) {
    await rejects(() => store.put('event', { title: 't', start: bad }), 'invalid');
  }
  await rejects(() => store.put('daily', { date: '2026-02-30', steps: 1 }), 'invalid');
  await rejects(() => store.put('daily', { date: '2026-11-25', steps: -1 }), 'invalid');
  await rejects(() => store.put('daily', { date: '2026-11-25', steps: 1.5 }), 'invalid');
  await rejects(() => store.put('daily', { date: '2026-11-25', restingHr: 5 }), 'invalid');
  await rejects(() => store.put('alarm', { time: '24:00' }), 'invalid');
  await rejects(() => store.put('alarm', { time: '7:00' }), 'invalid');
  await rejects(() => store.put('alarm', { time: '07:00', days: [7] }), 'invalid');
  await rejects(() => store.put('alarm', { time: '07:00', days: 'mon' }), 'invalid');
});

test('F-010: an instant with an impossible day (Feb 30, Apr 31, 29 Feb in a non-leap year) is rejected, not silently rolled into the next month', async () => {
  const { store } = await fresh();
  const rolled = [];
  for (const bad of ['2026-02-30T10:00:00Z', '2027-02-29T10:00:00Z', '2026-04-31T10:00:00Z', '2026-06-31T00:00:00Z']) {
    try { const r = await store.put('event', { title: 't', start: bad }); rolled.push(`${bad} -> ${r.start}`); } catch (e) { assert.equal(e.name, 'DataError'); }
  }
  assert.deepEqual(rolled, [], 'silently rolled over: ' + rolled.join('; '));
});

test('event ordering rule: end before start is rejected; zero-length ok; all-day single day start===end', async () => {
  const { store } = await fresh();
  await rejects(() => store.put('event', { title: 't', start: '2026-12-01T10:00:00Z', end: '2026-12-01T09:00:00Z' }), 'invalid');
  const z = await store.put('event', { title: 't', start: '2026-12-01T10:00:00Z' });
  assert.equal(z.end, z.start);
  const ad = await store.put('event', { title: 'all day', allDay: true, start: '2026-12-05' });
  assert.equal(ad.end, '2026-12-05');
  await rejects(() => store.put('event', { title: 'x', allDay: true, start: '2026-12-05', end: '2026-12-04' }), 'invalid');
});

test('unknown fields are dropped; records are frozen; id with bad characters rejected', async () => {
  const { store } = await fresh();
  const r = await store.put('message', { text: 'hi', admin: true, __proto__: { polluted: 1 }, evil: '<x>' });
  assert.equal('admin' in r, false); assert.equal('evil' in r, false);
  assert.ok(Object.isFrozen(r));
  assert.ok(polluted());
  await rejects(() => store.put('message', { id: 'a b', text: 'x' }), 'invalid');
  await rejects(() => store.put('message', { id: '../../x', text: 'x' }), 'invalid');
  await rejects(() => store.put('message', { id: 'x'.repeat(101), text: 'x' }), 'invalid');
});

test('settings: unknown keys and wrong types rejected; __proto__ key rejected; ui_ keys bounded', async () => {
  const { store } = await fresh();
  await rejects(() => store.settings.set('__proto__', 'x'), 'invalid');
  await rejects(() => store.settings.set('isAdmin', true), 'invalid');
  await rejects(() => store.settings.set('theme', 'neon'), 'invalid');
  await rejects(() => store.settings.set('weekStart', 3), 'invalid');
  await rejects(() => store.settings.set('name', 'x'.repeat(41)), 'invalid');
  await rejects(() => store.settings.set('ui_big', 'x'.repeat(201)), 'invalid');
  await store.settings.set('theme', 'dark');
  assert.equal(store.settings.get('theme'), 'dark');
  assert.ok(polluted());
});

test('first-run demo, demo.load twice does not duplicate, demo.clear keeps the user rows', async () => {
  const { store, demo } = await fresh();
  await demo.load({ now: '2026-11-25T12:00:00Z' });
  const n1 = store.counts();
  assert.ok(demo.isActive());
  const mine = await store.put('message', { text: 'my own note' });
  await demo.load({ now: '2026-11-25T12:00:00Z' });
  const n2 = store.counts();
  assert.deepEqual({ ...n2, message: n2.message - 1 }, n1, 'second demo.load must replace, not add');
  assert.equal(store.hasUserData(), true);
  await demo.clear();
  assert.equal(demo.isActive(), false);
  assert.equal(store.get('message', mine.id).text, 'my own note');
  assert.ok(store.list('event').every((e) => e.source !== 'demo'));
  assert.ok(store.list('message').every((e) => e.source !== 'demo'));
});

test('demo data is obviously fake: no emails, phone numbers, URLs with real hosts; names are sample names', async () => {
  const { store, demo } = await fresh();
  await demo.load({ now: '2026-11-25T12:00:00Z' });
  const TEXT_FIELDS = ['title', 'notes', 'location', 'text', 'from', 'label', 'note', 'tags'];
  const all = JSON.stringify(['event', 'alarm', 'message', 'checkin', 'daily'].map((k) => store.list(k).map((r) => Object.fromEntries(TEXT_FIELDS.filter((f) => f in r).map((f) => [f, r[f]])))));
  assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(all), 'email-like string in demo data');
  assert.ok(!/\+?\d[\d ()-]{8,}\d/.test(all), 'phone-like number in demo data');
  assert.ok(!/https?:\/\//.test(all), 'URL in demo data');
  assert.ok(!/garmin/i.test(all), 'Garmin name inside demo data');
  assert.ok(/sample|demo|example/i.test(all), 'demo data should say it is sample data');
  const sources = new Set(['event', 'alarm', 'message', 'checkin', 'daily'].flatMap((k) => store.list(k).map((r) => r.source)));
  assert.deepEqual([...sources], ['demo']);
});

test('D5: export -> wipe -> import is lossless in replace mode and in merge mode (with demo data, own data and XP)', async () => {
  const { store, backup, demo, game } = await fresh();
  await demo.load({ now: '2026-11-25T12:00:00Z' });
  const ev = await store.put('event', { title: 'Mine 😀', start: '2026-12-01T10:00:00Z', end: '2026-12-01T11:00:00Z', location: 'Somewhere', notes: 'a\nb' });
  const al = await store.put('alarm', { time: '06:45', days: [1, 2, 3], label: 'gym' });
  const ms = await store.put('message', { text: 'ping <b>x</b>', tags: ['a', 'b'], pinned: true });
  await game.award('event', { ref: ev.id, now: '2026-11-25T12:00:00Z' });
  await game.award('alarm', { ref: al.id, now: '2026-11-25T12:00:00Z' });
  await game.award('message', { ref: ms.id, now: '2026-11-25T12:00:00Z' });
  await store.settings.set('theme', 'dark'); await store.settings.set('accent', 'coral'); await store.settings.set('name', 'Sam'); await store.settings.set('weekStart', 0);
  const before = norm(backup.exportAll());
  const snapBefore = game.snapshot({ now: '2026-11-25T12:00:00Z' });
  const text = backup.exportJSON();
  for (const mode of ['replace', 'merge']) {
    await rejects(() => store.wipeAll(), 'not_confirmed');
    await store.wipeAll({ confirmed: true });
    assert.equal(store.isEmpty(), true, 'store empty after wipe');
    const wiped = norm(backup.exportAll());
    assert.deepEqual(Object.values(wiped.counts).reduce((a, b) => a + b, 0), 0);
    const rep = await backup.importAll(text, { mode });
    assert.equal(rep.ok, true, JSON.stringify(rep.errors).slice(0, 300));
    const after = norm(backup.exportAll());
    assert.deepEqual(after.counts, before.counts, `${mode}: counts`);
    assert.deepEqual(after.data, before.data, `${mode}: records identical`);
    assert.deepEqual(after.settings, before.settings, `${mode}: settings identical (theme/accent/name/weekStart/demoMode)`);
    const snapAfter = game.snapshot({ now: '2026-11-25T12:00:00Z' });
    assert.equal(snapAfter.xp, snapBefore.xp, `${mode}: xp`);
    assert.equal(snapAfter.level, snapBefore.level);
    assert.deepEqual(snapAfter.streak, snapBefore.streak);
    assert.deepEqual(snapAfter.badges.map((b) => [b.id, b.earned]), snapBefore.badges.map((b) => [b.id, b.earned]));
  }
});

test('importing the same file twice changes nothing (merge), and dryRun writes nothing', async () => {
  const { store, backup, demo } = await fresh();
  await demo.load({ now: '2026-11-25T12:00:00Z' });
  await store.put('message', { text: 'one' });
  const text = backup.exportJSON();
  const a = norm(backup.exportAll());
  const dry = await backup.importAll(text, { mode: 'replace', dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.deepEqual(norm(backup.exportAll()), a);
  const rep = await backup.importAll(text, { mode: 'merge' });
  assert.equal(rep.added, 0);
  assert.deepEqual(norm(backup.exportAll()), a);
});

// ---------------- hostile backup files (generated with qa/tools/make-fixtures.mjs logic, inlined here) ----------------
const evil = ['<script>alert("xss-summary")</script>', '<img src=x onerror=alert("xss-img")>', '"><svg onload=alert("xss-svg")>', 'javascript:alert(1)'];
const hostile = {
  truncated: '{"format":"daybeat-backup","version":1,"data":{"event":[{"id":"a","title":"cut off',
  notJson: 'this is not json',
  emptyObject: '{}',
  array: '[1,2,3]',
  nullJson: 'null',
  number: '42',
  protoPollution: '{"format":"daybeat-backup","version":1,"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}},"settings":{"__proto__":{"polluted3":"yes"}},"data":{"message":[{"id":"p1","text":"proto","__proto__":{"polluted3":"yes"}}],"__proto__":{"polluted":"yes"}}}',
  wrongType: JSON.stringify({ format: 'daybeat-backup', version: 1, settings: { theme: 12345 }, data: { event: 'not an array', alarm: [null, 5, 'x', {}], message: [{ id: 'm1', text: { nested: true } }] } }),
  futureVersion: JSON.stringify({ format: 'daybeat-backup', version: 999, data: {} }),
  wrongFormat: JSON.stringify({ format: 'somebody-elses-backup', version: 1, data: {} }),
  xss: JSON.stringify({ format: 'daybeat-backup', version: 1, data: { event: evil.map((s, i) => ({ id: 'x' + i, title: s, notes: s, location: s, start: '2026-12-01T10:00:00Z', end: '2026-12-01T11:00:00Z' })), message: evil.map((s, i) => ({ id: 'm' + i, text: s, at: '2026-12-01T10:00:00Z' })), alarm: evil.map((s, i) => ({ id: 'a' + i, label: s, time: '07:00', days: [1, 2, 3] })) } }),
  xpEdges: JSON.stringify({ format: 'daybeat-backup', version: 1, data: { action: [{ id: 'visit:2026-11-25', type: 'visit', day: '2026-11-25', at: '2026-11-25T10:00:00Z', xp: 9007199254740993 }, { id: 'neg', type: 'visit', day: '2026-11-24', at: '2026-11-24T10:00:00Z', xp: -5 }, { id: 'big', type: 'visit', day: '2026-11-23', at: '2026-11-23T10:00:00Z', xp: 10000 }] } }),
  dupIds: JSON.stringify({ format: 'daybeat-backup', version: 1, data: { event: [{ id: 'dup', title: 'one', start: '2026-12-01T10:00:00Z' }, { id: 'dup', title: 'two', start: '2026-12-02T10:00:00Z' }], alarm: [{ id: 'dup', time: '07:00' }] } }),
};

test('hostile backup files: never crash with a non-DataError, never pollute prototypes, never change existing data when rejected', async () => {
  const { store, backup } = await fresh();
  await store.put('message', { text: 'precious' });
  const before = norm(backup.exportAll());
  const outcomes = {};
  for (const [name, text] of Object.entries(hostile)) {
    for (const mode of ['merge', 'replace']) {
      let outcome;
      try {
        const rep = await backup.importAll(text, { mode, dryRun: true });
        outcome = { ok: rep.ok, added: rep.added, errors: rep.errors.length };
      } catch (e) {
        assert.equal(e.name, 'DataError', `${name}/${mode} threw ${e && e.name}: ${e && e.message}`);
        outcome = { code: e.code };
      }
      outcomes[`${name}/${mode}`] = outcome;
    }
    assert.deepEqual(norm(backup.exportAll()), before, `${name}: dryRun must not change anything`);
    assert.ok(polluted(), `${name}: prototype polluted`);
  }
  console.log('hostile dry-run outcomes:', JSON.stringify(outcomes));
  // The clearly invalid files must be refused outright.
  for (const name of ['truncated', 'notJson', 'array', 'nullJson', 'number', 'emptyObject', 'futureVersion', 'wrongFormat']) {
    assert.ok(outcomes[`${name}/merge`].code, `${name} should be rejected with a DataError code, got ${JSON.stringify(outcomes[`${name}/merge`])}`);
  }
});

test('hostile backup files, real import: failure leaves existing data untouched; accepted records are sanitised', async () => {
  for (const name of ['protoPollution', 'wrongType', 'xss', 'xpEdges', 'dupIds']) {
    const { store, backup } = await fresh();
    await store.put('message', { text: 'precious' });
    const before = norm(backup.exportAll());
    let rep = null;
    try { rep = await backup.importAll(hostile[name], { mode: 'merge' }); } catch (e) { assert.equal(e.name, 'DataError', `${name}: ${e.message}`); }
    assert.ok(polluted(), `${name}: prototype polluted`);
    if (!rep) { assert.deepEqual(norm(backup.exportAll()), before, `${name}: rejected import must not change data`); continue; }
    const after = norm(backup.exportAll());
    assert.ok(after.data.message.some((m) => m.text === 'precious'), `${name}: existing message must survive a merge`);
    for (const kind of ['event', 'alarm', 'message', 'checkin', 'daily', 'action']) for (const r of after.data[kind]) {
      assert.ok(!('__proto__' in JSON.parse(JSON.stringify(r)) && Object.prototype.hasOwnProperty.call(JSON.parse(JSON.stringify(r)), '__proto__')), 'record keeps an own __proto__ key');
      if (kind === 'action') { assert.ok(Number.isInteger(r.xp) && r.xp >= 0 && r.xp <= 10000, `${name}: action xp out of range ${r.xp}`); }
    }
  }
});

test('F-009 evidence: ledger rows with large xp produce a level/progress the UI can draw (progress within 0..1)', async () => {
  const { store, backup, game } = await fresh();
  const actions = [];
  for (let i = 0; i < 100; i++) actions.push({ id: 'a' + i, type: 'visit', day: '2026-01-' + String((i % 28) + 1).padStart(2, '0'), at: '2026-01-01T10:00:00Z', xp: 10000 });
  await backup.importAll(JSON.stringify({ format: 'daybeat-backup', version: 1, data: { action: actions } }), { mode: 'merge' });
  const s = game.snapshot({ now: '2026-12-01T10:00:00Z' });
  assert.ok(Number.isFinite(s.level));
  assert.ok(s.levelProgress >= 0 && s.levelProgress <= 1, `levelProgress=${s.levelProgress}, level=${s.level}, xp=${s.xp}`);
});

test('size limits: a backup above 25 MB is refused quickly with too_large', async () => {
  const { backup } = await fresh();
  const big = '{"format":"daybeat-backup","version":1,"pad":"' + 'x'.repeat(26 * 1024 * 1024) + '"}';
  const t0 = Date.now();
  await rejects(() => backup.importAll(big, { mode: 'merge' }), 'too_large');
  assert.ok(Date.now() - t0 < 3000, 'too_large check should not parse the whole thing');
});

test('strict mode: one invalid record aborts and writes nothing', async () => {
  const { store, backup } = await fresh();
  const file = JSON.stringify({ format: 'daybeat-backup', version: 1, data: { message: [{ id: 'ok1', text: 'fine' }, { id: 'bad1', text: '' }], event: [] } });
  await rejects(() => backup.importAll(file, { mode: 'merge', strict: true }), 'invalid');
  assert.equal(store.count('message'), 0);
  const lenient = await backup.importAll(file, { mode: 'merge' });
  assert.equal(lenient.ok, true); assert.equal(store.count('message'), 1); assert.equal(lenient.errors.length, 1);
});

test('undo of the last import restores the previous state', async () => {
  const { store, backup } = await fresh();
  await store.put('message', { text: 'before import' });
  const prior = norm(backup.exportAll());
  const file = JSON.stringify({ format: 'daybeat-backup', version: 1, data: { message: [{ id: 'imp1', text: 'imported' }] } });
  await backup.importAll(file, { mode: 'replace' });
  assert.equal(store.count('message'), 1);
  assert.ok(backup.canUndo());
  await backup.undoLastImport();
  assert.deepEqual(norm(backup.exportAll()).data, prior.data);
});

test('G2/G3: award is idempotent per ref and per day, also under concurrent double-taps', async () => {
  const { store, game } = await fresh();
  const ck = await store.put('checkin', { day: '2026-11-25', at: '2026-11-25T06:30:00Z' });
  const results = await Promise.all(Array.from({ length: 12 }, () => game.award('checkin', { ref: ck.id, now: '2026-11-25T06:31:00Z' })));
  const xpGains = results.map((r) => r.xpGained);
  assert.equal(xpGains.filter((x) => x > 0).length, 1, `exactly one award should pay: ${JSON.stringify(xpGains)}`);
  const rows = store.list('action').filter((r) => r.id === `checkin:${ck.id}`);
  assert.equal(rows.length, 1);
  const v = await Promise.all(Array.from({ length: 5 }, () => game.award('visit', { now: '2026-11-25T06:31:00Z' })));
  assert.equal(v.filter((r) => r.xpGained > 0).length, 1);
  assert.equal(store.list('action').filter((r) => r.type === 'visit').length, 1);
  const before = game.snapshot({ now: '2026-11-25T06:31:00Z' }).xp;
  await game.award('visit', { now: '2026-11-25T06:45:00Z' });
  assert.equal(game.snapshot({ now: '2026-11-25T06:45:00Z' }).xp, before, 'same day: no second visit XP');
});

test('G5: XP farming by creating many records the same day is capped', async () => {
  const { store, game } = await fresh();
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const m = await store.put('message', { text: 'spam ' + i });
    const r = await game.award('message', { ref: m.id, now: '2026-11-25T10:00:00Z' });
    total += r.xpGained;
  }
  assert.ok(total <= 5 * 25 + 200, `message XP in one day should be capped, got ${total}`);
  const rows = store.list('action').length;
  assert.ok(rows <= 60, `ledger rows should be capped, got ${rows}`);
});

test('G7: deleting a record that earned XP leaves XP consistent (no negative, no crash)', async () => {
  const { store, game } = await fresh();
  const m = await store.put('message', { text: 'x' });
  await game.award('message', { ref: m.id, now: '2026-11-25T10:00:00Z' });
  const xp = game.snapshot({ now: '2026-11-25T10:00:00Z' }).xp;
  await store.remove('message', m.id);
  assert.equal(game.snapshot({ now: '2026-11-25T10:00:00Z' }).xp, xp);
});

test('store.list range queries by local day work for all-day and timed events and respect the device zone', async () => {
  const { store } = await fresh();
  await store.put('event', { title: 'allday', allDay: true, start: '2026-11-25' });
  await store.put('event', { title: 'span', allDay: true, start: '2026-11-24', end: '2026-11-26' });
  await store.put('event', { title: 'late', start: new Date(2026, 10, 25, 23, 59, 0).toISOString() });
  await store.put('event', { title: 'early', start: new Date(2026, 10, 26, 0, 0, 0).toISOString() });
  const day = store.list('event', { from: '2026-11-25', to: '2026-11-26' }).map((e) => e.title).sort();
  assert.deepEqual(day, ['allday', 'late', 'span'], 'local-day window [25th, 26th) must include 23:59 local and exclude 00:00 local of the next day');
});

test('wipeAll clears records, settings (theme, accent, demo flag), and the app starts empty not demo', async () => {
  const { store, demo } = await fresh();
  await demo.load({ now: '2026-11-25T12:00:00Z' });
  await store.settings.set('theme', 'light'); await store.settings.set('accent', 'mint'); await store.settings.set('name', 'Sam');
  await store.wipeAll({ confirmed: true });
  assert.equal(store.isEmpty(), true);
  assert.equal(demo.isActive(), false);
  assert.notEqual(store.settings.get('name'), 'Sam');
  assert.notEqual(store.settings.get('theme'), 'light');
  assert.notEqual(store.settings.get('accent'), 'mint');
  assert.equal(store.settings.get('demoMode', false), false);
});

// ---------------- persistence across a "reload" using a fake localStorage (node has no IndexedDB) ----------------
function fakeLocalStorage() {
  const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear(), _keys: () => [...m.keys()] };
}
async function withLocalStorage(fn) {
  const ls = fakeLocalStorage();
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const hadDoc = 'document' in globalThis;
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  if (!hadDoc) globalThis.document = {}; // adapters.safeLocalStorage() only trusts localStorage inside a browser page
  try { await fn(ls); } finally { if (desc) Object.defineProperty(globalThis, 'localStorage', desc); else delete globalThis.localStorage; if (!hadDoc) delete globalThis.document; }
}
const boot = async () => { const store = createStore(); const info = await store.init(); return { store, info, backup: createBackup(store), demo: createDemo(store), game: createGame(store) }; };

test('persistence: data survives a reload (localStorage fallback), first run only once', async () => {
  await withLocalStorage(async () => {
    const a = await boot();
    assert.equal(a.info.firstRun, true); assert.equal(a.info.backend, 'localstorage'); assert.equal(a.info.degraded, true);
    await a.demo.load({ now: '2026-11-25T12:00:00Z' });
    const m = await a.store.put('message', { text: 'survives reload' });
    await a.store.settings.set('theme', 'dark'); await a.store.settings.set('accent', 'coral');
    a.store.close?.();
    const b = await boot();
    assert.equal(b.info.firstRun, false, 'second launch must not be a first run');
    assert.equal(b.store.get('message', m.id)?.text, 'survives reload');
    assert.equal(b.store.settings.get('theme'), 'dark');
    assert.ok(b.demo.isActive());
    b.store.close?.();
  });
});

test('I7/D6: wipe then reload stays EMPTY (demo is not silently refilled) and leaves no theme/data keys behind', async () => {
  await withLocalStorage(async (ls) => {
    const a = await boot();
    await a.demo.load({ now: '2026-11-25T12:00:00Z' });
    await a.store.settings.set('theme', 'light'); await a.store.settings.set('accent', 'mint'); await a.store.settings.set('name', 'Sam');
    await a.store.put('message', { text: 'private note' });
    await a.store.wipeAll({ confirmed: true });
    const keys = ls._keys();
    const dump = keys.map((k) => k + '=' + ls.getItem(k)).join('\n');
    assert.ok(!/private note|Sample|Sam\b/.test(dump), 'wipe left user text or demo text in localStorage:\n' + dump.slice(0, 500));
    assert.ok(!keys.includes('app.theme') && !keys.includes('app.accent'), 'theme mirror keys must be removed by wipe, got: ' + keys.join(','));
    a.store.close?.();
    const b = await boot();
    assert.equal(b.info.firstRun, false, 'after a wipe the next launch must not look like a first run (demo would come back)');
    assert.equal(b.store.isEmpty(), true);
    assert.equal(b.demo.isActive(), false);
    b.store.close?.();
  });
});

test('D8: storage that throws on write (quota full) surfaces quota_exceeded/storage_failed and leaves nothing half-written', async () => {
  await withLocalStorage(async (ls) => {
    const a = await boot();
    await a.store.put('message', { text: 'kept' });
    const realSet = ls.setItem;
    ls.setItem = () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
    const e = await rejects(() => a.store.put('message', { text: 'will not fit' }));
    assert.ok(['quota_exceeded', 'storage_failed'].includes(e.code), 'code ' + e.code);
    assert.equal(a.store.list('message').some((m) => m.text === 'will not fit'), false, 'failed write must not appear in the in-memory snapshot');
    ls.setItem = realSet;
    await a.store.put('message', { text: 'works again' });
    assert.equal(a.store.count('message'), 2);
    a.store.close?.();
  });
});
