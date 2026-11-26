import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse, importFile } from '../js/data/ics.js';
import { LIMITS } from '../js/data/schema.js';

const NOW = '2026-11-25T12:00:00Z';
const cal = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fake//Test//EN', ...events.flat(), 'END:VCALENDAR', ''].join('\r\n');
const ve = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const run = (text, opts = {}) => parse(text, { now: NOW, ...opts });
const local = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString();

test('UTC, TZID and floating times become the right instants', () => {
  const r = run(
    cal(
      ve('UID:utc', 'DTSTART:20261201T143000Z', 'DTEND:20261201T153000Z', 'SUMMARY:UTC'),
      ve('UID:ny', 'DTSTART;TZID=America/New_York:20261201T090000', 'DTEND;TZID=America/New_York:20261201T100000', 'SUMMARY:NY'),
      ve('UID:flo', 'DTSTART:20261201T090000', 'DTEND:20261201T100000', 'SUMMARY:Floating'),
      ve('UID:win', 'DTSTART;TZID=Eastern Standard Time:20261201T090000', 'SUMMARY:Windows name'),
      ve('UID:kol', 'DTSTART;TZID="Asia/Kolkata":20261201T090000', 'DTEND;TZID=Asia/Kolkata:20261201T093000', 'SUMMARY:Kolkata'),
    ),
  );
  const by = Object.fromEntries(r.events.map((e) => [e.uid, e]));
  assert.equal(by.utc.start, '2026-12-01T14:30:00.000Z');
  assert.equal(by.utc.end, '2026-12-01T15:30:00.000Z');
  assert.equal(by.ny.start, '2026-12-01T14:00:00.000Z');
  assert.equal(by.ny.end, '2026-12-01T15:00:00.000Z');
  assert.equal(by.flo.start, local(2026, 12, 1, 9));
  assert.equal(by.win.start, '2026-12-01T14:00:00.000Z');
  assert.equal(by.kol.start, '2026-12-01T03:30:00.000Z');
  assert.equal(r.errors.length, 0);
});

test('unknown TZID falls back to floating (device zone) and is counted', () => {
  const r = run(cal(ve('UID:x', 'DTSTART;TZID=Customized Time Zone:20261201T090000', 'SUMMARY:x')));
  assert.equal(r.events[0].start, local(2026, 12, 1, 9));
  assert.equal(r.stats.tzFallback, 1);
});

test('all-day events: DTEND is exclusive in ICS, our end is the last day; never before start', () => {
  const r = run(
    cal(
      ve('UID:a', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261102', 'SUMMARY:one day'),
      ve('UID:b', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261104', 'SUMMARY:three days'),
      ve('UID:c', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261101', 'SUMMARY:zero length'),
      ve('UID:d', 'DTSTART;VALUE=DATE:20261101', 'SUMMARY:no end'),
      ve('UID:e', 'DTSTART;VALUE=DATE:20261105', 'DTEND;VALUE=DATE:20261101', 'SUMMARY:end before start'),
      ve('UID:f', 'DTSTART;VALUE=DATE:20261101', 'DURATION:P2D', 'SUMMARY:duration'),
      ve('UID:g', 'DTSTART:20261201', 'SUMMARY:date without VALUE'),
    ),
  );
  const by = Object.fromEntries(r.events.map((e) => [e.uid, e]));
  for (const e of r.events) assert.equal(e.allDay, true);
  assert.deepEqual([by.a.start, by.a.end], ['2026-11-01', '2026-11-01']);
  assert.deepEqual([by.b.start, by.b.end], ['2026-11-01', '2026-11-03']);
  assert.deepEqual([by.c.start, by.c.end], ['2026-11-01', '2026-11-01']);
  assert.deepEqual([by.d.start, by.d.end], ['2026-11-01', '2026-11-01']);
  assert.deepEqual([by.e.start, by.e.end], ['2026-11-05', '2026-11-05']);
  assert.deepEqual([by.f.start, by.f.end], ['2026-11-01', '2026-11-02']);
  assert.equal(by.g.start, '2026-12-01');
});

test('timed events: DTEND before DTSTART becomes zero length, DURATION works, no end = zero length', () => {
  const r = run(
    cal(
      ve('UID:a', 'DTSTART:20261201T100000Z', 'DTEND:20261201T090000Z', 'SUMMARY:backwards'),
      ve('UID:b', 'DTSTART:20261201T100000Z', 'DURATION:PT1H30M', 'SUMMARY:dur'),
      ve('UID:c', 'DTSTART:20261201T100000Z', 'SUMMARY:no end'),
    ),
  );
  const by = Object.fromEntries(r.events.map((e) => [e.uid, e]));
  assert.equal(by.a.end, by.a.start);
  assert.equal(by.b.end, '2026-12-01T11:30:00.000Z');
  assert.equal(by.c.end, by.c.start);
});

test('line folding, BOM, LF-only and CR-only line endings, escapes', () => {
  const body = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:fold', 'DTSTART:20261201T100000Z', 'SUMMARY:A very long title that is fol', ' ded across lines\\, with a comma', 'DESCRIPTION:line one\\nline two\\; semi\\\\backslash', 'LOCATION:Sample\\, Room 5', 'END:VEVENT', 'END:VCALENDAR'];
  for (const [name, text] of [['crlf', '﻿' + body.join('\r\n')], ['lf', body.join('\n')], ['cr', body.join('\r')]]) {
    const r = run(text);
    assert.equal(r.events.length, 1, name);
    assert.equal(r.events[0].title, 'A very long title that is folded across lines, with a comma', name);
    assert.equal(r.events[0].notes, 'line one\nline two; semi\\backslash', name);
    assert.equal(r.events[0].location, 'Sample, Room 5', name);
  }
});

test('hostile text is kept as plain text, control characters stripped, lengths capped, attendees never stored', () => {
  const r = run(
    cal(
      ve(
        'UID:x',
        'DTSTART:20261201T100000Z',
        'SUMMARY:<script>alert(1)</script>‮\u0000evil',
        `DESCRIPTION:${'d'.repeat(5000)}`,
        `LOCATION:${'l'.repeat(1000)}`,
        'ATTENDEE;CN=Fake Person:mailto:fake.person@example.invalid',
        'ORGANIZER:mailto:boss@example.invalid',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:alarm text must not leak',
        'END:VALARM',
      ),
    ),
  );
  const e = r.events[0];
  assert.equal(e.title, '<script>alert(1)</script>evil');
  assert.equal(e.notes.length, 2000);
  assert.equal(e.location.length, 200);
  assert.equal(JSON.stringify(r).includes('fake.person'), false);
  assert.equal(JSON.stringify(r).includes('boss@'), false);
  assert.equal(JSON.stringify(r).includes('alarm text'), false);
  assert.deepEqual(Object.keys(e).sort(), ['allDay', 'end', 'id', 'location', 'notes', 'source', 'start', 'title', 'uid']);
  assert.equal(e.source, 'import');
});

test('bad events land in errors and the rest continues', () => {
  const r = run(
    cal(
      ve('UID:nostart', 'SUMMARY:no start'),
      ve('UID:badstart', 'DTSTART:2026-12-01', 'SUMMARY:bad format'),
      ve('UID:year0', 'DTSTART:00010101T000000Z', 'SUMMARY:year one'),
      ve('UID:year9999', 'DTSTART:99991231T000000Z', 'SUMMARY:year 9999'),
      ve('UID:feb30', 'DTSTART:20260230T100000Z', 'SUMMARY:feb 30'),
      ve('UID:cancelled', 'DTSTART:20261201T100000Z', 'STATUS:CANCELLED', 'SUMMARY:cancelled'),
      ve('UID:good', 'DTSTART:20261201T100000Z', 'SUMMARY:fine'),
    ),
  );
  assert.deepEqual(r.events.map((e) => e.uid), ['good']);
  assert.equal(r.errorsTotal, 5);
  assert.equal(r.skipped, 6);
});

test('an unclosed VEVENT does not swallow the events after it, and a cut-off file reports the loss', () => {
  const r = run('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261201T100000Z\r\nSUMMARY:never closed\r\nBEGIN:VEVENT\r\nUID:b\r\nDTSTART:20261202T100000Z\r\nSUMMARY:good after\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
  assert.deepEqual(r.events.map((e) => e.title), ['never closed', 'good after']);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /not closed/);
  const cut = run('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261201T100000Z\r\nSUMMARY:cut off');
  assert.equal(cut.events.length, 1);
  assert.match(cut.errors[0].message, /ends in the middle/);
});

test('not a calendar, empty calendar and wrong input types', () => {
  assert.throws(() => run('hello world'), (e) => e.code === 'bad_format');
  assert.throws(() => run(null), (e) => e.code === 'bad_format');
  const empty = run('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n');
  assert.deepEqual([empty.events.length, empty.errors.length], [0, 0]);
});

test('weekly repeat with BYDAY, COUNT, EXDATE and a changed single occurrence (RECURRENCE-ID)', () => {
  const r = run(
    cal(
      ve('UID:w', 'DTSTART;TZID=America/New_York:20261123T090000', 'DTEND;TZID=America/New_York:20261123T093000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6', 'EXDATE;TZID=America/New_York:20261125T090000', 'SUMMARY:Standup'),
      ve('UID:w', 'RECURRENCE-ID;TZID=America/New_York:20261130T090000', 'DTSTART;TZID=America/New_York:20261130T140000', 'DTEND;TZID=America/New_York:20261130T143000', 'SUMMARY:Standup (moved)'),
    ),
    { windowDays: { before: 365, after: 365 } },
  );
  // COUNT=6 -> Mon 23, Wed 25 (excluded), Mon 30 (moved), Wed 2, Mon 7, Wed 9
  const starts = r.events.filter((e) => e.title === 'Standup').map((e) => e.start);
  assert.deepEqual(starts, ['2026-11-23T14:00:00.000Z', '2026-12-02T14:00:00.000Z', '2026-12-07T14:00:00.000Z', '2026-12-09T14:00:00.000Z']);
  const moved = r.events.find((e) => e.title === 'Standup (moved)');
  assert.equal(moved.start, '2026-11-30T19:00:00.000Z');
});

test('repeats keep their wall-clock time across a DST change (America/New_York)', () => {
  const r = run(cal(ve('UID:d', 'DTSTART;TZID=America/New_York:20261030T090000', 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:Daily')), { windowDays: { before: 365, after: 365 } });
  assert.deepEqual(r.events.map((e) => e.start), [
    '2026-10-30T13:00:00.000Z', // EDT
    '2026-10-31T13:00:00.000Z',
    '2026-11-01T14:00:00.000Z', // EST after the change on Nov 1
    '2026-11-02T14:00:00.000Z',
    '2026-11-03T14:00:00.000Z',
  ]);
});

test('monthly (2nd Tuesday, last Friday, day 31), yearly, interval, UNTIL', () => {
  const win = { windowDays: { before: 30, after: 400 } };
  const t2 = run(cal(ve('UID:m1', 'DTSTART;VALUE=DATE:20261110', 'RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=4', 'SUMMARY:2nd Tue')), win);
  assert.deepEqual(t2.events.map((e) => e.start), ['2026-11-10', '2026-12-08', '2027-01-12', '2027-02-09']);
  const lf = run(cal(ve('UID:m2', 'DTSTART;VALUE=DATE:20261127', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3', 'SUMMARY:last Fri')), win);
  assert.deepEqual(lf.events.map((e) => e.start), ['2026-11-27', '2026-12-25', '2027-01-29']);
  const d31 = run(cal(ve('UID:m3', 'DTSTART;VALUE=DATE:20261231', 'RRULE:FREQ=MONTHLY;COUNT=4', 'SUMMARY:31st')), win);
  assert.deepEqual(d31.events.map((e) => e.start), ['2026-12-31', '2027-01-31', '2027-03-31', '2027-05-31'], 'months without a 31st are skipped');
  const yr = run(cal(ve('UID:y', 'DTSTART;VALUE=DATE:20280229', 'RRULE:FREQ=YEARLY;COUNT=2', 'SUMMARY:leap day')), { windowDays: { before: 10, after: 3000 } });
  assert.deepEqual(yr.events.map((e) => e.start), ['2028-02-29', '2032-02-29']);
  const bday = run(cal(ve('UID:b', 'DTSTART;VALUE=DATE:20260301', 'RRULE:FREQ=YEARLY', 'SUMMARY:birthday')), { windowDays: { before: 10, after: 800 } });
  assert.deepEqual(bday.events.map((e) => e.start), ['2027-03-01', '2028-03-01']);
  const everyOther = run(cal(ve('UID:i', 'DTSTART:20261201T100000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20270105T000000Z', 'SUMMARY:fortnightly')), win);
  assert.deepEqual(everyOther.events.map((e) => e.start.slice(0, 10)), ['2026-12-01', '2026-12-15', '2026-12-29']);
});

test('repeat bombs are bounded: COUNT=999999, no UNTIL, daily for 50 years, interval 1', () => {
  const t0 = Date.now();
  const r = run(
    cal(
      ve('UID:a', 'DTSTART:20200101T100000Z', 'RRULE:FREQ=DAILY;COUNT=999999', 'SUMMARY:count bomb'),
      ve('UID:b', 'DTSTART:19990101T100000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:old and endless'),
      ve('UID:c', 'DTSTART:20261201T100000Z', 'RRULE:FREQ=DAILY;INTERVAL=0;BYDAY=XX;BYSETPOS=1', 'SUMMARY:garbage rule'),
      ve('UID:d', 'DTSTART:20261201T100000Z', 'RRULE:FREQ=SECONDLY', 'SUMMARY:unknown freq'),
    ),
  );
  assert.ok(Date.now() - t0 < 2000, 'finishes quickly');
  assert.ok(r.events.length <= LIMITS.icsEvents);
  const perSeries = (u) => r.events.filter((e) => e.uid === u).length;
  assert.ok(perSeries('a') <= LIMITS.icsOccurrencesPerSeries);
  assert.ok(perSeries('b') >= 300 && perSeries('b') <= LIMITS.icsOccurrencesPerSeries, `endless series is limited to the window, got ${perSeries('b')}`);
  assert.equal(perSeries('d'), 1, 'unknown FREQ imports the event once');
  assert.ok(r.errors.some((e) => /not understood/.test(e.message)));
});

test('same file twice gives identical ids; different occurrences get different ids; duplicates inside a file collapse', () => {
  const text = cal(ve('UID:a', 'DTSTART:20261201T100000Z', 'SUMMARY:x'), ve('UID:a', 'DTSTART:20261201T100000Z', 'SUMMARY:x again'), ve('UID:a', 'DTSTART:20261202T100000Z', 'SUMMARY:next day'));
  const a = run(text);
  const b = run(text);
  assert.deepEqual(a.events.map((e) => e.id), b.events.map((e) => e.id));
  assert.equal(a.events.length, 2);
  assert.equal(a.skipped, 1);
  assert.match(a.events[0].id, /^ics:[0-9a-f]{16}$/);
  const noUid = run(cal(ve('DTSTART:20261201T100000Z', 'SUMMARY:no uid')));
  assert.ok(noUid.events[0].uid.length > 3);
});

test('size limits: huge text refused with advice, oversized File refused before reading, event cap keeps the nearest events', async () => {
  assert.throws(() => run('x'.repeat(LIMITS.icsBytes + 1)), (e) => e.code === 'too_large' && /shorter date range/.test(e.message));
  let read = false;
  const fake = { size: LIMITS.icsBytes + 1, text: async () => { read = true; return ''; } };
  await assert.rejects(importFile(fake), (e) => e.code === 'too_large');
  assert.equal(read, false, 'the file body was never read');
  await assert.rejects(importFile({}), (e) => e.code === 'bad_format');

  const many = [];
  for (let i = 0; i < LIMITS.icsEvents + 300; i++) {
    const d = new Date(Date.UTC(2020, 0, 1) + i * 86400000);
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    many.push(ve(`UID:e${i}`, `DTSTART;VALUE=DATE:${ymd}`, `SUMMARY:e${i}`));
  }
  const r = run(cal(...many));
  assert.equal(r.events.length, LIMITS.icsEvents);
  assert.equal(r.truncated, true);
  assert.ok(r.errors.some((e) => /closest to today/.test(e.message)));
  // too many components
  const tiny = [];
  for (let i = 0; i < LIMITS.icsComponents + 5; i++) tiny.push('BEGIN:VEVENT', 'END:VEVENT');
  const t = run(cal(tiny));
  assert.equal(t.truncated, true);
});

test('importFile reads a real fixture file (fake data)', async () => {
  const text = fs.readFileSync(new URL('./fixtures/sample-calendar.ics', import.meta.url), 'utf8');
  assert.match(text, /FAKE-DEMO-DATA/);
  const blob = new Blob([text]);
  const r = await importFile(blob, { now: NOW });
  assert.ok(r.events.length >= 5);
  assert.equal(r.errors.length, 0);
  for (const e of r.events) assert.match(e.title, /^Sample/);
  assert.ok(r.events.some((e) => e.allDay));
  assert.ok(r.events.filter((e) => e.uid === 'fake-weekly-1@example.invalid').length > 3, 'weekly series expanded');
});
