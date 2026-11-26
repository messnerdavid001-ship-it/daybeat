#!/usr/bin/env node
// QA tool: generate hostile / edge-case input files into a TEMP folder (never into the repo; *.ics is git-ignored anyway).
//   node qa/tools/make-fixtures.mjs <outDir> [--huge]
// Everything is fake. Used for ICS import, JSON backup import and message-capture tests.

import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] || '');
if (!process.argv[2]) { console.error('usage: make-fixtures.mjs <outDir> [--huge]'); process.exit(2); }
const huge = process.argv.includes('--huge');
fs.mkdirSync(out, { recursive: true });
const w = (name, data) => fs.writeFileSync(path.join(out, name), data);

const CAL_HEAD = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//QA Fixture//EN\r\nCALSCALE:GREGORIAN\r\n';
const CAL_TAIL = 'END:VCALENDAR\r\n';
const ev = (lines) => 'BEGIN:VEVENT\r\n' + lines.join('\r\n') + '\r\nEND:VEVENT\r\n';
const uid = (n) => `UID:qa-${n}@example.invalid`;

// ---- baseline good file ----
w('good-small.ics', CAL_HEAD + [
  ev([uid(1), 'DTSTAMP:20260101T000000Z', 'DTSTART:20261201T180000Z', 'DTEND:20261201T190000Z', 'SUMMARY:Sample Run Club', 'LOCATION:Example Park']),
  ev([uid(2), 'DTSTAMP:20260101T000000Z', 'DTSTART;VALUE=DATE:20261205', 'DTEND;VALUE=DATE:20261206', 'SUMMARY:Sample all-day event']),
  ev([uid(3), 'DTSTAMP:20260101T000000Z', 'DTSTART;TZID=America/New_York:20261207T083000', 'DTEND;TZID=America/New_York:20261207T093000', 'SUMMARY:NY morning (TZID)']),
  ev([uid(4), 'DTSTAMP:20260101T000000Z', 'DTSTART:20261208T090000', 'DTEND:20261208T100000', 'SUMMARY:Floating time (no zone)']),
].join('') + CAL_TAIL);

// ---- hostile text ----
const evil = [
  '<script>alert("xss-summary")</script>',
  '<img src=x onerror=alert("xss-img")>',
  '"><svg onload=alert("xss-svg")>',
  'javascript:alert(1)',
  '{{constructor.constructor("alert(1)")()}}',
  '${alert(1)}',
];
w('hostile-text.ics', CAL_HEAD + evil.map((s, i) => ev([
  uid(100 + i), 'DTSTAMP:20260101T000000Z', `DTSTART:2026120${i + 1}T100000Z`, `DTEND:2026120${i + 1}T110000Z`,
  'SUMMARY:' + s.replace(/\\/g, '\\\\'), 'DESCRIPTION:' + s, 'LOCATION:' + s, 'URL:' + s,
])).join('') + CAL_TAIL);

// ---- emoji, ZWJ, RTL, combining, astral ----
const uni = ['👩🏽‍🚀 moonwalk 🌕', 'Zalgo: Z̷̢̛a̸l̶g̷o̴', 'RTL: \u202Eevil.txt\u202C and مرحبا بالعالم', 'Astral: 𝒳𝒴𝒵 😀😀😀', 'Ünïcödé — “curly” ‘quotes’ … tab\there', 'Flag 🏳️‍🌈 🇳🇿 family 👨‍👩‍👧‍👦', 'NUL:\u0000:end'];
w('unicode.ics', CAL_HEAD + uni.map((s, i) => ev([uid(200 + i), 'DTSTAMP:20260101T000000Z', `DTSTART:2026121${i}T100000Z`, 'SUMMARY:' + s.replace(/;/g, '\\;').replace(/,/g, '\\,')])).join('') + CAL_TAIL);

// ---- very long fields ----
w('long-fields.ics', CAL_HEAD + ev([uid(300), 'DTSTAMP:20260101T000000Z', 'DTSTART:20261210T100000Z', 'SUMMARY:' + 'W'.repeat(100000), 'DESCRIPTION:' + 'long words '.repeat(20000)]) +
  ev([uid(301), 'DTSTAMP:20260101T000000Z', 'DTSTART:20261211T100000Z', 'SUMMARY:' + 'A'.repeat(500) + ' (500-char unbroken title)']) + CAL_TAIL);

// ---- malformed ----
w('malformed-no-end-vevent.ics', CAL_HEAD + 'BEGIN:VEVENT\r\nUID:qa-m1@example.invalid\r\nDTSTART:20261201T100000Z\r\nSUMMARY:never closed\r\n' + ev([uid(401), 'DTSTART:20261202T100000Z', 'SUMMARY:Good one after the broken one']) + CAL_TAIL);
w('malformed-bad-dates.ics', CAL_HEAD + [
  ev([uid(410), 'DTSTART:notadate', 'SUMMARY:bad date text']),
  ev([uid(411), 'DTSTART:20261301T100000Z', 'SUMMARY:month 13']),
  ev([uid(412), 'DTSTART:20260230T100000Z', 'SUMMARY:30 Feb']),
  ev([uid(413), 'DTSTART:20261201T256100Z', 'SUMMARY:25:61 time']),
  ev([uid(414), 'DTSTART:', 'SUMMARY:empty dtstart']),
  ev([uid(415), 'SUMMARY:no dtstart at all']),
  ev([uid(416), 'DTSTART:20261203T120000Z', 'DTEND:20261203T110000Z', 'SUMMARY:DTEND before DTSTART']),
  ev([uid(417), 'DTSTART:00010101T000000Z', 'SUMMARY:year 0001']),
  ev([uid(418), 'DTSTART:99991231T235959Z', 'SUMMARY:year 9999']),
  ev([uid(419), 'DTSTART;TZID=Mars/Olympus_Mons:20261204T120000', 'SUMMARY:unknown TZID']),
  ev([uid(420), 'DTSTART:20261205T100000Z', 'SUMMARY:Valid survivor']),
].join('') + CAL_TAIL);
w('malformed-binary.ics', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0xff, 0xfe, 0xfd, 0x00]));
w('empty.ics', '');
w('only-header.ics', CAL_HEAD + CAL_TAIL);
w('not-a-calendar.ics', 'hello this is just text, not BEGIN:VCALENDAR\n');
w('bom-lf-only.ics', '\uFEFF' + (CAL_HEAD + ev([uid(430), 'DTSTART:20261201T100000Z', 'SUMMARY:BOM and LF line endings']) + CAL_TAIL).replace(/\r\n/g, '\n'));
w('folded-lines.ics', CAL_HEAD + 'BEGIN:VEVENT\r\nUID:qa-f1@example.invalid\r\nDTSTART:20261201T100000Z\r\nSUMMARY:This summary is folded\r\n  across several physical lines\r\n  and keeps going\r\nDESCRIPTION:Line one\\nLine two\\, with comma\\; semicolon and a backslash \\\\\r\nEND:VEVENT\r\n' + CAL_TAIL);

// ---- recurrence bombs ----
w('rrule-bombs.ics', CAL_HEAD + [
  ev([uid(500), 'DTSTART:20260101T000000Z', 'RRULE:FREQ=SECONDLY;COUNT=999999999', 'SUMMARY:every second, a billion times']),
  ev([uid(501), 'DTSTART:20260101T000000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:daily forever (no UNTIL/COUNT)']),
  ev([uid(502), 'DTSTART:20260101T000000Z', 'RRULE:FREQ=MINUTELY;INTERVAL=1', 'SUMMARY:every minute forever']),
  ev([uid(503), 'DTSTART:20260101T000000Z', 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30', 'SUMMARY:impossible date (30 Feb yearly)']),
  ev([uid(504), 'DTSTART:20260101T000000Z', 'RRULE:FREQ=WEEKLY;BYDAY=XX;COUNT=3', 'SUMMARY:bad BYDAY']),
  ev([uid(505), 'DTSTART:20260101T000000Z', 'RRULE:FREQ=DAILY;INTERVAL=0', 'SUMMARY:INTERVAL=0']),
  ev([uid(506), 'DTSTART:20260101T000000Z', 'RRULE:FREQ=DAILY;INTERVAL=-5;COUNT=3', 'SUMMARY:negative interval']),
  ev([uid(507), 'DTSTART:20260101T000000Z', 'RRULE:FREQ=MONTHLY;BYDAY=5FR;COUNT=12', 'SUMMARY:5th Friday monthly (skips months)']),
  ev([uid(508), 'DTSTART:20260101T000000Z', 'RRULE:FREQ=WEEKLY;UNTIL=20250101T000000Z', 'SUMMARY:UNTIL before DTSTART']),
  ev([uid(509), 'DTSTART:20261201T100000Z', 'RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE:20261208T100000Z', 'SUMMARY:weekly with an EXDATE (should be 3 occurrences)']),
].join('') + CAL_TAIL);

// ---- time-zone / DST edges (assume the browser time zone is America/New_York or Europe/London while testing) ----
w('tz-dst-edges.ics', CAL_HEAD + [
  ev([uid(600), 'DTSTART;TZID=America/New_York:20270314T023000', 'DTEND;TZID=America/New_York:20270314T033000', 'SUMMARY:NY 02:30 on spring-forward day (does not exist)']),
  ev([uid(601), 'DTSTART;TZID=America/New_York:20261101T013000', 'DTEND;TZID=America/New_York:20261101T023000', 'SUMMARY:NY 01:30 on fall-back day (happens twice)']),
  ev([uid(602), 'DTSTART;TZID=Europe/London:20270328T013000', 'SUMMARY:London 01:30 spring-forward gap']),
  ev([uid(603), 'DTSTART;TZID=Australia/Lord_Howe:20261004T020000', 'SUMMARY:Lord Howe 30-minute DST shift']),
  ev([uid(604), 'DTSTART;TZID=Asia/Kolkata:20261201T053000', 'SUMMARY:Kolkata +5:30']),
  ev([uid(605), 'DTSTART;TZID=Pacific/Kiritimati:20261231T233000', 'SUMMARY:Kiritimati +14 late New Year']),
  ev([uid(606), 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261102', 'SUMMARY:all-day on fall-back day (must stay on 1 Nov in every zone)']),
  ev([uid(607), 'DTSTART;TZID=America/New_York:20270308T100000', 'RRULE:FREQ=WEEKLY;COUNT=4', 'SUMMARY:weekly 10:00 NY across spring-forward (stays 10:00 local)']),
  ev([uid(608), 'DTSTART:20261231T235959Z', 'DTEND:20270101T000100Z', 'SUMMARY:spans midnight and the new year']),
  ev([uid(609), 'DTSTART:20280229T120000Z', 'SUMMARY:29 Feb leap day']),
].join('') + CAL_TAIL);

// ---- generated huge ICS ----
const nEvents = huge ? 100000 : 5000;
let big = CAL_HEAD;
for (let i = 0; i < nEvents; i++) {
  const d = new Date(Date.UTC(2026, 0, 1) + i * 3600e3);
  const s = d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  big += ev([uid(1000 + i), `DTSTART:${s}`, `SUMMARY:Bulk sample event ${i}`, 'DESCRIPTION:' + 'x'.repeat(200)]);
}
big += CAL_TAIL;
w(huge ? 'huge-100k.ics' : 'big-5k.ics', big);

// ---- JSON backups (generic shape; refine after the real schema is published) ----
w('backup-truncated.json', '{"app":"qa","schemaVersion":1,"events":[{"id":"a","title":"cut off');
w('backup-not-json.json', 'this is not json');
w('backup-empty-object.json', '{}');
w('backup-array.json', '[1,2,3]');
w('backup-null.json', 'null');
w('backup-proto-pollution.json', '{"schemaVersion":1,"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}},"events":[{"id":"p1","title":"proto","__proto__":{"polluted3":"yes"}}]}');
w('backup-wrong-types.json', JSON.stringify({ schemaVersion: 1, xp: 'lots', level: -3, streak: { current: 'NaN', best: 1e308 }, events: 'not an array', alarms: [null, 5, 'x', {}], messages: [{ id: 1, text: { nested: true } }], settings: { theme: 12345 } }));
w('backup-future-version.json', JSON.stringify({ schemaVersion: 999, events: [], note: 'from a newer app' }));
w('backup-xss.json', JSON.stringify({ schemaVersion: 1, events: evil.map((s, i) => ({ id: 'x' + i, title: s, notes: s, location: s, start: '2026-12-01T10:00:00Z', end: '2026-12-01T11:00:00Z' })), messages: evil.map((s, i) => ({ id: 'm' + i, text: s, createdAt: '2026-12-01T10:00:00Z' })), alarms: evil.map((s, i) => ({ id: 'a' + i, label: s, time: '07:00', days: [1, 2, 3] })) }));
w('backup-xp-edges.json', JSON.stringify({ schemaVersion: 1, xp: 9007199254740993, totalXp: -1, level: 1e21, streak: { current: -4, best: 'x' } }));
w('backup-duplicate-ids.json', JSON.stringify({ schemaVersion: 1, events: [{ id: 'dup', title: 'one' }, { id: 'dup', title: 'two' }], alarms: [{ id: 'dup', time: '07:00' }] }));
if (huge) {
  const arr = []; for (let i = 0; i < 400000; i++) arr.push({ id: 'h' + i, title: 'bulk ' + i, notes: 'y'.repeat(100) });
  w('backup-huge.json', JSON.stringify({ schemaVersion: 1, events: arr }));
}

// ---- messages (text fed to quick capture / URL fragment) ----
w('fragment-payloads.txt', [
  '#/messages?add=' + encodeURIComponent('<img src=x onerror=alert(1)>'),
  '#/messages?add=' + 'A'.repeat(200000),
  '#/messages?add=%E0%A4%A',          // malformed percent-encoding
  '#/messages?add=' + encodeURIComponent('line1\nline2\u0000nul'),
  '#add=' + encodeURIComponent('javascript:alert(1)'),
  '#/../../etc/passwd',
  '#/__proto__',
  '#/alarms?x=' + encodeURIComponent('"><script>alert(1)</script>'),
].join('\n') + '\n');

// ---- wrong file types ----
w('fake.png.ics', Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
fs.mkdirSync(path.join(out, 'a-folder.ics'), { recursive: true });

console.log(`fixtures written to ${out}: ${fs.readdirSync(out).length} entries${huge ? ' (huge mode)' : ''}`);
