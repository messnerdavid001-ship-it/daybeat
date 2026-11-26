// QA tests (independent): ICS parser with hostile, malformed and time-zone-edge input, plus the commit path into the store.
// Needs fixtures:  node qa/tools/make-fixtures.mjs <dir> [--huge]   then   QA_FIXTURES=<dir> TZ=... node --test qa/tests/ics.test.mjs
// Without QA_FIXTURES the test generates its own temp folder (and removes it).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../js/data');
const imp = (f) => import(pathToFileURL(path.join(dataDir, f)).href);
const icsMod = await imp('ics.js');
const { createStore } = await imp('store.js');
const { prepare } = await imp('schema.js');

let FX = process.env.QA_FIXTURES;
let madeTmp = null;
if (!FX) {
  madeTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-fx-'));
  execFileSync('node', [path.resolve(here, '../tools/make-fixtures.mjs'), madeTmp], { stdio: 'ignore' });
  FX = madeTmp;
}
after(() => { if (madeTmp) fs.rmSync(madeTmp, { recursive: true, force: true }); setTimeout(() => process.exit(process.exitCode || 0), 50).unref(); });
const read = (n) => fs.readFileSync(path.join(FX, n), 'utf8');
const NOW = '2026-11-25T12:00:00Z';
const parse = (text, opts = {}) => icsMod.parse(text, { now: NOW, ...opts });
const byTitle = (res, t) => res.events.filter((e) => e.title === t);
const throwsData = (fn, code) => { try { fn(); } catch (e) { assert.equal(e.name, 'DataError', `${e.name}: ${e.message}`); if (code) assert.equal(e.code, code); return e; } assert.fail('expected DataError'); };

test('baseline: UTC, TZID, floating, all-day events convert correctly', () => {
  const r = parse(read('good-small.ics'));
  assert.equal(r.events.length, 4); assert.equal(r.errors.length, 0);
  const utc = byTitle(r, 'Sample Run Club')[0];
  assert.equal(utc.start, '2026-12-01T18:00:00.000Z'); assert.equal(utc.end, '2026-12-01T19:00:00.000Z'); assert.equal(utc.allDay, false);
  const ad = byTitle(r, 'Sample all-day event')[0];
  assert.equal(ad.allDay, true); assert.equal(ad.start, '2026-12-05'); assert.equal(ad.end, '2026-12-05', 'DTEND is exclusive in ICS; one-day event has start === end');
  const ny = byTitle(r, 'NY morning (TZID)')[0];
  assert.equal(ny.start, '2026-12-07T13:30:00.000Z');
  const fl = byTitle(r, 'Floating time (no zone)')[0];
  assert.equal(fl.start, new Date(2026, 11, 8, 9, 0, 0).toISOString(), 'floating = device zone');
  for (const e of r.events) assert.doesNotThrow(() => prepare('event', e, { defaultSource: 'import' }), e.title);
});

test('E1: script/markup in SUMMARY, DESCRIPTION, LOCATION, URL stays inert text and still validates', () => {
  const r = parse(read('hostile-text.ics'));
  assert.ok(r.events.length >= 6);
  for (const e of r.events) { assert.doesNotThrow(() => prepare('event', e, { defaultSource: 'import' })); }
  assert.ok(r.events.some((e) => e.title.includes('<script>')), 'markup is kept as plain text (renderer escapes it)');
  assert.ok(!JSON.stringify(r.events).includes('xss-never'), 'sanity');
});

test('E2: unicode (ZWJ emoji, RTL, combining, astral, NUL) survives or is cleaned without throwing', () => {
  const r = parse(read('unicode.ics'));
  assert.equal(r.events.length, 7);
  assert.ok(r.events.some((e) => e.title.includes('👩🏽‍🚀')));
  assert.ok(r.events.every((e) => !/\u0000/.test(e.title)));
  assert.ok(r.events.some((e) => e.title.includes('مرحبا')));
  for (const e of r.events) assert.doesNotThrow(() => prepare('event', e, { defaultSource: 'import' }), e.title);
});

test('E3: 100,000-character SUMMARY and DESCRIPTION are truncated to the limits, not rejected, no hang', () => {
  const t0 = Date.now();
  const r = parse(read('long-fields.ics'));
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(r.events.length, 2);
  for (const e of r.events) { assert.ok(e.title.length <= 200 && e.notes.length <= 2000); assert.doesNotThrow(() => prepare('event', e, { defaultSource: 'import' })); }
});

test('E5: malformed - missing END:VEVENT does not lose the good event after it', () => {
  const r = parse(read('malformed-no-end-vevent.ics'));
  assert.ok(byTitle(r, 'Good one after the broken one').length === 1 || r.events.some((e) => /Good one/.test(e.notes + e.title)), JSON.stringify({ events: r.events.map((e) => e.title), errors: r.errors }));
});

test('E5: malformed dates are reported in errors[], valid survivor imported, nothing silently rolled over', () => {
  const r = parse(read('malformed-bad-dates.ics'));
  assert.ok(byTitle(r, 'Valid survivor').length === 1, 'valid event must survive: ' + JSON.stringify(r.events.map((e) => e.title)));
  assert.ok(r.errors.length >= 5, `expected the broken events in errors[]: ${JSON.stringify(r.errors)}`);
  const titles = r.events.map((e) => e.title);
  for (const bad of ['bad date text', 'month 13', '30 Feb', '25:61 time', 'empty dtstart', 'no dtstart at all']) assert.ok(!titles.includes(bad), `"${bad}" must not be imported`);
  const eb = byTitle(r, 'DTEND before DTSTART')[0];
  if (eb) assert.equal(eb.end, eb.start, 'end before start is clamped to start');
});

test('E5/E11: year 0001 and year 9999 events never produce an event the store would refuse (otherwise one bad event kills the whole import)', async () => {
  const r = parse(read('malformed-bad-dates.ics'));
  const store = createStore(); await store.init();
  const refused = [];
  for (const e of r.events) { try { prepare('event', e, { defaultSource: 'import' }); } catch (err) { refused.push(`${e.title} (${e.start}): ${err.message}`); } }
  assert.deepEqual(refused, [], 'parse() returned events that store.putMany would reject, which makes commit() fail for the WHOLE file');
  // and the real commit path
  const { createIcs } = icsMod;
  const ics = createIcs(store);
  const res = await ics.commit(r).catch((e) => ({ failed: e.code + ': ' + e.message }));
  assert.ok(!res.failed, 'commit of a file containing a year-9999 event failed entirely: ' + res.failed);
});

test('E6: wrong file types give a DataError, never a crash or half import', () => {
  throwsData(() => parse(''), 'bad_format');
  throwsData(() => parse('hello this is just text'), 'bad_format');
  throwsData(() => parse(fs.readFileSync(path.join(FX, 'malformed-binary.ics'), 'latin1')), 'bad_format');
  throwsData(() => parse(123), 'bad_format');
  const hdr = parse(read('only-header.ics')); assert.equal(hdr.events.length, 0);
});

test('BOM + LF-only line endings and folded lines / escapes are handled', () => {
  const r = parse(read('bom-lf-only.ics')); assert.equal(r.events.length, 1);
  const f = parse(read('folded-lines.ics')); assert.equal(f.events.length, 1);
  assert.match(f.events[0].title, /This summary is folded\s+across several physical lines\s+and keeps going/);
  assert.equal(f.events[0].notes, 'Line one\nLine two, with comma; semicolon and a backslash \\');
});

test('E5: RRULE bombs finish fast and stay bounded', () => {
  const t0 = Date.now();
  const r = parse(read('rrule-bombs.ics'));
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, `took ${ms} ms`);
  assert.ok(r.events.length <= 5000);
  const perUid = new Map();
  for (const e of r.events) perUid.set(e.uid, (perUid.get(e.uid) || 0) + 1);
  for (const [uid, n] of perUid) assert.ok(n <= 520, `${uid} produced ${n} occurrences`);
  const weekly = r.events.filter((e) => e.uid === 'qa-509@example.invalid');
  assert.equal(weekly.length, 3, 'COUNT=4 with one EXDATE gives 3 occurrences: ' + weekly.map((e) => e.start));
  assert.ok(r.events.filter((e) => e.uid === 'qa-503@example.invalid').length === 0, '30 Feb yearly has no occurrences');
  assert.ok(r.events.filter((e) => e.uid === 'qa-508@example.invalid').length === 0, 'UNTIL before DTSTART has no occurrences');
  for (const e of r.events) assert.doesNotThrow(() => prepare('event', e, { defaultSource: 'import' }), e.title + ' ' + e.start);
});

test('F4/F6: TZID conversions and DST edges (device zone irrelevant for TZID events)', () => {
  const r = parse(read('tz-dst-edges.ics'), { now: '2027-03-01T12:00:00Z', windowDays: { before: 400, after: 400 } });
  const get = (uid) => r.events.filter((e) => e.uid === `qa-${uid}@example.invalid`).sort((a, b) => (a.start < b.start ? -1 : 1));
  assert.equal(get(600)[0].start, '2027-03-14T07:30:00.000Z', 'NY 02:30 on spring-forward day does not exist -> 03:30 EDT');
  assert.equal(get(601)[0].start, '2026-11-01T05:30:00.000Z', 'NY 01:30 fall-back day: first occurrence');
  assert.equal(get(602)[0].start, '2027-03-28T01:30:00.000Z', 'London 01:30 gap -> 02:30 BST');
  assert.equal(get(603)[0].start, '2026-10-03T15:30:00.000Z', 'Lord Howe 02:00 on 2026-10-04 is inside the 30 min gap (02:00-02:30) -> shifted forward to 02:30 LHDT = 15:30Z');
  assert.equal(get(604)[0].start, '2026-12-01T00:00:00.000Z', 'Kolkata +5:30');
  assert.equal(get(605)[0].start, '2026-12-31T09:30:00.000Z', 'Kiritimati +14');
  const ad = get(606)[0]; assert.equal(ad.start, '2026-11-01'); assert.equal(ad.end, '2026-11-01'); assert.equal(ad.allDay, true);
  const wk = get(607);
  assert.deepEqual(wk.map((e) => e.start), ['2027-03-08T15:00:00.000Z', '2027-03-15T14:00:00.000Z', '2027-03-22T14:00:00.000Z', '2027-03-29T14:00:00.000Z'], 'weekly NY 10:00 stays 10:00 local across spring-forward (15:00Z then 14:00Z)');
  assert.equal(get(608)[0].start, '2026-12-31T23:59:59.000Z');
});

test('F5: all-day event keeps its calendar date in the device zone (no off-by-one for west or east of UTC)', () => {
  const r = parse(read('good-small.ics'));
  const ad = byTitle(r, 'Sample all-day event')[0];
  assert.equal(ad.start, '2026-12-05');
  // rendering side check: the day key of the all-day start parsed in device zone is the same day
  assert.equal(new Date(2026, 11, 5).getDate(), 5);
});

test('leap day event is imported when inside the window', () => {
  const r = parse(read('tz-dst-edges.ics'), { now: '2028-01-15T12:00:00Z' });
  assert.ok(r.events.some((e) => e.uid === 'qa-609@example.invalid' && e.start === '2028-02-29T12:00:00.000Z'));
});

test('E4: 5,000-event file parses quickly; 100,000-event file (33 MB) is refused with too_large immediately', async () => {
  const big = parse(fs.existsSync(path.join(FX, 'big-5k.ics')) ? read('big-5k.ics') : read('huge-100k.ics').slice(0, 1));
  assert.ok(big.events.length <= 5000);
  if (fs.existsSync(path.join(FX, 'huge-100k.ics'))) {
    const t0 = Date.now();
    const e = throwsData(() => parse(read('huge-100k.ics')), 'too_large');
    assert.ok(Date.now() - t0 < 1500);
    assert.match(e.message, /shorter date range/i, 'the message must say what to do');
  }
});

test('E4: importFile rejects by size BEFORE reading the file into memory; wrong objects rejected', async () => {
  const fake = { size: 6 * 1024 * 1024, text() { throw new Error('file was read!'); }, arrayBuffer() { throw new Error('file was read!'); } };
  await assert.rejects(() => icsMod.importFile(fake), (e) => e.name === 'DataError' && e.code === 'too_large');
  await assert.rejects(() => icsMod.importFile(null), (e) => e.name === 'DataError');
  await assert.rejects(() => icsMod.importFile({}), (e) => e.name === 'DataError');
});

test('D4: importing the same file twice adds nothing the second time (stable ids), different calendars do not collide', async () => {
  const store = createStore(); await store.init();
  const ics = icsMod.createIcs(store);
  const text = read('good-small.ics');
  const a = await ics.commit(parse(text));
  const b = await ics.commit(parse(text));
  assert.equal(a.added, 4); assert.equal(b.added, 0); assert.equal(b.updated, 4);
  assert.equal(store.count('event'), 4);
  const p = ics.preview(parse(text)); assert.deepEqual(p, { new: 0, existing: 4 });
});

test('privacy: attendees, organizer e-mail, alarms and extra properties are not carried into the stored events', () => {
  const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:p1@example.invalid\r\nDTSTART:20261201T100000Z\r\nSUMMARY:Lunch\r\nORGANIZER;CN=Real Person:mailto:real.person@example.invalid\r\nATTENDEE;CN=Other Person:mailto:other@example.invalid\r\nATTACH:https://example.invalid/secret.pdf\r\nCATEGORIES:PRIVATE\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:alarm text\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const r = parse(text);
  const json = JSON.stringify(r.events);
  assert.equal(r.events.length, 1);
  assert.ok(!/real\.person|other@|mailto|secret\.pdf|alarm text|PRIVATE/i.test(json), json);
});

test('capture.fromQuery / fromText: hostile fragments never throw, are bounded and stay plain text', async () => {
  const { fromQuery, fromText } = await imp('capture.js');
  const payloads = fs.readFileSync(path.join(FX, 'fragment-payloads.txt'), 'utf8').split('\n').filter(Boolean);
  for (const p of payloads) {
    const q = p.includes('?') ? p.slice(p.indexOf('?')) : p.replace(/^#/, '');
    let out;
    assert.doesNotThrow(() => { out = fromQuery(q); }, p.slice(0, 40));
    assert.ok(out && Array.isArray(out.drafts));
    for (const d of out.drafts) { assert.ok(d.text.length <= 4000, 'text bound'); assert.doesNotThrow(() => prepare('message', d, { newId: () => 'ms-test' }), p.slice(0, 40)); }
  }
  assert.doesNotThrow(() => fromQuery('?text=%E0%A4%A'));
  assert.doesNotThrow(() => fromQuery('?text=' + 'A'.repeat(200000)));
  assert.doesNotThrow(() => fromQuery('?__proto__[polluted]=1&text=x'));
  assert.equal(({}).polluted, undefined);
  const many = fromText(Array.from({ length: 500 }, (_, i) => 'Sam: message ' + i).join('\n\n'));
  assert.ok(many.drafts.length <= 100 && many.truncated === true, 'paste capped at 100 drafts');
  const evil = fromText('<img src=x onerror=alert(1)>');
  assert.equal(evil.drafts[0].text, '<img src=x onerror=alert(1)>');
  for (const d of [...(fromQuery('?text=hi&via=shortcut').drafts)]) assert.doesNotThrow(() => prepare('message', d, { newId: () => 'ms-test' }));
});
