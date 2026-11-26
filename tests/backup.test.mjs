import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/data/store.js';
import { MemoryAdapter } from '../js/data/adapters.js';
import { createBackup } from '../js/data/backup.js';
import { createDemo } from '../js/data/demo.js';
import { createGame } from '../js/data/game.js';
import { BACKUP_FORMAT, LIMITS, SCHEMA_VERSION } from '../js/data/schema.js';
import { fromText, fromQuery } from '../js/data/capture.js';

const NOW = new Date('2026-11-25T12:00:00.000Z');

async function fresh() {
  const s = createStore();
  await s.init({ adapter: new MemoryAdapter(), clock: () => NOW });
  return { s, b: createBackup(s), demo: createDemo(s), game: createGame(s) };
}
const file = (data = {}, extra = {}) => JSON.stringify({ format: BACKUP_FORMAT, version: SCHEMA_VERSION, exportedAt: NOW.toISOString(), settings: {}, data, ...extra });

test('export has the documented envelope and carries settings, records and the XP ledger', async () => {
  const { s, b, demo } = await fresh();
  await demo.load({ now: NOW });
  await s.settings.set('theme', 'dark');
  const out = b.exportAll();
  assert.equal(out.format, 'daybeat-backup');
  assert.equal(out.version, SCHEMA_VERSION);
  assert.deepEqual(Object.keys(out.data).sort(), ['action', 'alarm', 'checkin', 'daily', 'event', 'message', 'task']);
  assert.equal(out.settings.theme, 'dark');
  assert.equal(out.settings.demoMode, true);
  assert.ok(out.counts.action > 0);
  const noDemo = b.exportAll({ includeDemo: false });
  assert.equal(noDemo.counts.event, 0);
  const f = await b.exportFile();
  assert.match(f.filename, /^daybeat-backup-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(f.bytes, Buffer.byteLength(f.text));
  assert.ok(s.settings.get('lastBackupAt'));
  assert.equal(JSON.parse(f.text).format, BACKUP_FORMAT);
  await s.settings.remove('lastBackupAt');
  const quiet = await b.exportFile({ markBackedUp: false });
  assert.equal(s.settings.get('lastBackupAt'), undefined, 'markBackedUp:false stamps nothing');
  assert.equal(JSON.parse(quiet.text).settings.lastBackupAt, undefined);
  assert.equal(await b.markBackedUp(), true);
  assert.equal(s.settings.get('lastBackupAt'), NOW.toISOString());
  s.close();
});

test('hostile backups are refused or sanitised and never touch existing data or Object.prototype', async () => {
  const { s, b } = await fresh();
  await s.put('message', { text: 'mine' });
  const before = JSON.stringify(b.exportAll().data);
  const refusals = [
    ['', 'bad_format'],
    ['{', 'bad_format'],
    ['[]', 'bad_format'],
    ['null', 'bad_format'],
    ['"string"', 'bad_format'],
    [JSON.stringify({ format: 'something-else', version: 1, data: {} }), 'bad_format'],
    [JSON.stringify({ format: BACKUP_FORMAT, data: {} }), 'bad_format'],
    [JSON.stringify({ format: BACKUP_FORMAT, version: 1.5, data: {} }), 'bad_format'],
    [JSON.stringify({ format: BACKUP_FORMAT, version: SCHEMA_VERSION + 1, data: {} }), 'unsupported_version'],
    [JSON.stringify({ format: BACKUP_FORMAT, version: 1 }), 'bad_format'],
    [file({ event: 'not a list' }), 'bad_format'],
    ['x'.repeat(LIMITS.backupBytes + 1), 'too_large'],
  ];
  for (const [input, code] of refusals) {
    await assert.rejects(b.importAll(input), (e) => e.code === code, `${String(input).slice(0, 30)} -> ${code}`);
  }
  assert.equal(JSON.stringify(b.exportAll().data), before, 'nothing changed');

  const polluted = `{"format":"${BACKUP_FORMAT}","version":1,"exportedAt":"x","settings":{"__proto__":{"polluted":true},"theme":"dark","evil":1,"constructor":{"prototype":{"x":1}}},"data":{"__proto__":{"polluted":true},"constructor":[1],"message":[{"id":"m1","text":"ok","__proto__":{"polluted":true},"constructor":"x","isAdmin":true},{"id":"__proto__","text":"bad id"},{"id":"m2","text":""},{"id":"m3","text":"x","at":"2026-02-30T10:00:00Z"},{"id":"m4","text":"x","at":"not a date"},{"id":"m5","text":123},null,7,"str",[]]}}`;
  const rep = await b.importAll(polluted, { mode: 'merge' });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(rep.added, 1);
  assert.equal(rep.errors.length, 12, '9 bad records + 3 bad settings (__proto__, constructor, evil)');
  assert.equal(s.get('message', 'm1').text, 'ok');
  assert.equal(Object.keys(s.get('message', 'm1')).includes('isAdmin'), false);
  assert.equal(s.settings.get('theme'), 'dark');
  assert.ok(rep.errors.some((e) => e.kind === 'setting'));
  s.close();
});

test('negative, huge, fractional and non-numeric XP rows are skipped, never applied', async () => {
  const { s, b, game } = await fresh();
  const at = NOW.toISOString();
  const row = (id, xp) => ({ id, type: 'checkin', day: '2026-11-25', at, xp, ref: id });
  const rep = await b.importAll(file({ action: [row('a1', -50), row('a2', 10 ** 9), row('a3', 1.5), row('a4', '50'), row('a5', NaN), row('a6', 25), { ...row('a7', 5), type: 'BAD TYPE' }, { ...row('a8', 5), day: '2026-13-45' }] }));
  assert.equal(rep.added, 2, 'a6 (25 XP) and a5 (NaN becomes null = no XP)');
  assert.equal(rep.errors.length, 6);
  assert.equal(game.snapshot({ now: NOW }).xp, 25);
  s.close();
});

test('strict mode aborts on any invalid record and writes nothing; dry run writes nothing', async () => {
  const { s, b } = await fresh();
  const bad = file({ message: [{ id: 'm1', text: 'fine' }, { id: 'm2', text: '' }] });
  await assert.rejects(b.importAll(bad, { strict: true }), (e) => e.code === 'invalid' && e.details.length === 1);
  assert.equal(s.count('message'), 0);
  const dry = await b.importAll(bad, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.added, 1);
  assert.equal(dry.errors.length, 1);
  assert.equal(s.count('message'), 0);
  assert.equal(b.canUndo(), null, 'a dry run takes no snapshot');
  s.close();
});

test('merge keeps the newer record and keeps device settings; replace replaces everything', async () => {
  const { s, b } = await fresh();
  const old = '2026-01-01T00:00:00.000Z';
  const newer = '2026-12-01T00:00:00.000Z';
  await s.settings.set('theme', 'light');
  const m = await s.put('message', { id: 'same', text: 'local version' });
  const incoming = (text, updatedAt) => file({ message: [{ id: 'same', text, at: old, createdAt: old, updatedAt, source: 'user' }, { id: 'other', text: 'new one', createdAt: old, updatedAt: old }] }, { settings: { theme: 'dark', accent: 'mint' } });
  let rep = await b.importAll(incoming('older incoming', old), { mode: 'merge' });
  assert.equal(s.get('message', 'same').text, 'local version');
  assert.deepEqual([rep.added, rep.updated, rep.skipped], [1, 0, 1]);
  assert.equal(s.settings.get('theme'), 'light', 'device settings win in merge');
  assert.equal(s.settings.get('accent'), 'mint', 'unset settings are filled from the backup');
  rep = await b.importAll(incoming('newer incoming', newer), { mode: 'merge' });
  assert.equal(s.get('message', 'same').text, 'newer incoming');
  assert.deepEqual([rep.updated], [1]);
  rep = await b.importAll(incoming('replace', old), { mode: 'replace' });
  assert.equal(s.count('message'), 2);
  assert.equal(s.settings.get('theme'), 'dark');
  assert.ok(m.id);
  await assert.rejects(b.importAll(file(), { mode: 'sideways' }), (e) => e.code === 'invalid');
  s.close();
});

test('importAll accepts a parsed object, a Blob/File, and text with a BOM; a huge Blob is refused before reading', async () => {
  const { s, b } = await fresh();
  const text = file({ message: [{ id: 'a', text: 'one' }] });
  await b.importAll(JSON.parse(text));
  await b.importAll(new Blob(['﻿' + file({ message: [{ id: 'b', text: 'two' }] })]));
  assert.equal(s.count('message'), 2);
  let read = false;
  class Huge extends Blob {
    get size() {
      return LIMITS.backupBytes + 1;
    }
    async text() {
      read = true;
      return '';
    }
  }
  const huge = new Huge(['x']);
  await assert.rejects(b.importAll(huge), (e) => e.code === 'too_large');
  assert.equal(read, false);
  s.close();
});

test('5,000 events import in ONE atomic commit (one change event) and a failed commit leaves nothing', async () => {
  const { s, b } = await fresh();
  const events = Array.from({ length: 5000 }, (_, i) => ({ id: `e${i}`, title: `Sample ${i}`, start: new Date(Date.UTC(2026, 0, 1) + i * 3600000).toISOString() }));
  let changes = 0;
  s.onChange(() => changes++);
  const rep = await b.importAll(file({ event: events }));
  assert.equal(rep.added, 5000);
  assert.equal(changes, 1);
  assert.equal(s.count('event'), 5000);
  // an adapter failure during the commit leaves the store exactly as it was
  const adapter = new MemoryAdapter();
  const s2 = createStore();
  await s2.init({ adapter, clock: () => NOW });
  const b2 = createBackup(s2);
  adapter.apply = async () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
  await assert.rejects(b2.importAll(file({ event: events })), (e) => e.code === 'quota_exceeded');
  assert.equal(s2.count('event'), 0);
  assert.equal(b2.canUndo(), null);
  s.close();
  s2.close();
});

test('demo data: obviously fake, idempotent, never overwrites user rows, clear() removes only demo rows', async () => {
  const { s, demo, game } = await fresh();
  const mine = await s.put('event', { title: 'My real event', start: '2026-11-26T10:00:00Z' });
  const myDaily = await s.put('daily', { date: '2026-11-24', steps: 4242 });
  const rep = await demo.load({ now: NOW });
  assert.equal(demo.isActive(), true);
  assert.ok(rep.added.event > 10 && rep.added.message >= 10 && rep.added.alarm >= 4);
  for (const kind of ['event', 'alarm', 'message']) {
    for (const r of s.list(kind).filter((x) => x.source === 'demo')) {
      assert.match(JSON.stringify(r), /Sample|Demo|Pretend|Fake|sample|demo|pretend|made-up/, `${kind} ${r.id} looks fake`);
    }
  }
  assert.equal(s.get('daily', '2026-11-24').steps, 4242, 'a real day is never overwritten by demo data');
  const snap = game.snapshot({ now: NOW });
  assert.equal(snap.streak.current, 6);
  assert.equal(snap.level, 3);
  const again = await demo.load({ now: NOW });
  assert.equal(again.removed, 0, 'second load replaces, it does not duplicate');
  assert.equal(s.count('event'), rep.added.event + 1);
  const cleared = await demo.clear();
  assert.ok(cleared.removed > 50);
  assert.equal(demo.isActive(), false);
  assert.equal(s.count('event'), 1);
  assert.equal(s.get('event', mine.id).title, 'My real event');
  assert.equal(s.get('daily', myDaily.id).steps, 4242);
  assert.equal(s.count('action'), 0);
  s.close();
});

test('demo data is deterministic for the same now and seed', async () => {
  const a = await fresh();
  const b = await fresh();
  await a.demo.load({ now: NOW, seed: 3 });
  await b.demo.load({ now: NOW, seed: 3 });
  const strip = (o) => JSON.stringify(o, (k, v) => (k === 'createdAt' || k === 'updatedAt' ? undefined : v));
  assert.equal(strip(a.b.exportAll().data), strip(b.b.exportAll().data));
  a.s.close();
  b.s.close();
});

test('capture.fromText: blocks, sender prefix, limits, hostile text', () => {
  const r = fromText('Sam: running late\n\nNo prefix here\nsecond line\n\n\n\nhttp://example.invalid/x: not a sender\n\n   \n\nVeryLong'.replace('VeryLong', 'x'.repeat(5000)), { now: NOW });
  assert.equal(r.drafts.length, 4);
  assert.deepEqual([r.drafts[0].from, r.drafts[0].text], ['Sam', 'running late']);
  assert.equal(r.drafts[1].from, '');
  assert.equal(r.drafts[1].text, 'No prefix here\nsecond line');
  assert.equal(r.drafts[2].from, '', 'a URL scheme is not a sender');
  assert.equal(r.drafts[3].text.length, 4000);
  assert.equal(r.drafts[0].via, 'paste');
  assert.equal(r.drafts[0].at, NOW.toISOString());
  const many = fromText(Array.from({ length: 300 }, (_, i) => `m${i}`).join('\n\n'));
  assert.equal(many.drafts.length, LIMITS.pasteDrafts);
  assert.equal(many.truncated, true);
  assert.deepEqual(fromText(123), { drafts: [], truncated: false });
  const evil = fromText('<img src=x onerror=alert(1)>\u0000‮');
  assert.equal(evil.drafts[0].text, '<img src=x onerror=alert(1)>');
});

test('capture.fromQuery never throws on hostile input and only reads text/add/from/at', () => {
  const inputs = ['text=%E0%A4%A', 'text=' + 'a'.repeat(200000), '__proto__[x]=1&text=hi', 'text=a%00b&from=%ZZ', 'constructor=1', '', '?', '#/messages?text=Hello&from=Sam&at=2026-11-25T10:00:00Z', 'text=%FF%FE', 'at=999999999999999999999&text=x'];
  for (const i of inputs) assert.doesNotThrow(() => fromQuery(i), i.slice(0, 30));
  assert.doesNotThrow(() => fromQuery(null));
  const ok = fromQuery('#/messages?text=Hello&from=Sam&at=2026-11-25T10:00:00Z');
  assert.deepEqual(ok.drafts[0], { text: 'Hello', from: 'Sam', at: '2026-11-25T10:00:00.000Z', via: 'shortcut' });
  assert.equal(fromQuery('text=' + 'a'.repeat(5000)).drafts[0].text.length, 4000);
  assert.equal(fromQuery('text=a%00b').drafts[0].text, 'ab');
  assert.equal({}.x, undefined);
  assert.equal(fromQuery('at=1764072000&text=epoch').drafts[0].at, '2025-11-25T12:00:00.000Z');
});
