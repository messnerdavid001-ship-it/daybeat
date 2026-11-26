import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd, nextDue, occurrences, groupTasks, stepOnce, createTasks } from '../js/data/tasks.js';
import { buildCalendar, escText, fold } from '../js/data/cal-export.js';
import { prepare, DataError } from '../js/data/schema.js';
import { createStore } from '../js/data/store.js';
import { MemoryAdapter } from '../js/data/adapters.js';
import { createGame } from '../js/data/game.js';
import { createBackup } from '../js/data/backup.js';
import { migrateBundle, MIGRATIONS } from '../js/data/migrations.js';

// Wednesday 25 Nov 2026, 10:00 local
const NOW = new Date(2026, 10, 25, 10, 0, 0);
const TODAY = '2026-11-25';

test('quick add: date, time, priority, list and repeat words are understood and removed from the title', () => {
  const r = parseQuickAdd('call mum tomorrow 5pm !high #home', { now: NOW });
  assert.equal(r.title, 'call mum');
  assert.equal(r.due, '2026-11-26');
  assert.equal(r.time, '17:00');
  assert.equal(r.priority, 3);
  assert.equal(r.list, 'home');
  assert.equal(r.repeat, '');
  assert.deepEqual(r.understood.map((u) => u.kind), ['due', 'time', 'priority', 'list']);
});

test('quick add: weekdays, relative days, explicit dates and repeats', () => {
  assert.equal(parseQuickAdd('gym friday', { now: NOW }).due, '2026-11-27');
  assert.equal(parseQuickAdd('standup on mon', { now: NOW }).due, '2026-11-30');
  assert.equal(parseQuickAdd('gym wednesday', { now: NOW }).due, '2026-12-02', 'a bare weekday that is today means next week');
  assert.equal(parseQuickAdd('report in 3 days', { now: NOW }).due, '2026-11-28');
  assert.equal(parseQuickAdd('plan next week', { now: NOW }).due, '2026-12-02');
  assert.equal(parseQuickAdd('party dec 24', { now: NOW }).due, '2026-12-24');
  assert.equal(parseQuickAdd('party 24 dec', { now: NOW }).due, '2026-12-24');
  assert.equal(parseQuickAdd('birthday jan 3', { now: NOW }).due, '2027-01-03', 'a date already past this year rolls to next year');
  assert.equal(parseQuickAdd('tax 2027-04-15', { now: NOW }).due, '2027-04-15');
  const daily = parseQuickAdd('stretch every day 8am', { now: NOW });
  assert.equal(daily.repeat, 'daily');
  assert.equal(daily.time, '08:00');
  assert.equal(daily.title, 'stretch');
  const mon = parseQuickAdd('team lunch every monday', { now: NOW });
  assert.equal(mon.repeat, 'weekly');
  assert.equal(mon.due, '2026-11-30');
  assert.equal(parseQuickAdd('water plants weekdays', { now: NOW }).repeat, 'weekdays');
});

test('quick add: time rules, no false matches, empty and hostile input', () => {
  assert.equal(parseQuickAdd('call at 5:30pm', { now: NOW }).time, '17:30');
  assert.equal(parseQuickAdd('call 17:45', { now: NOW }).time, '17:45');
  assert.equal(parseQuickAdd('lunch noon', { now: NOW }).time, '12:00');
  assert.equal(parseQuickAdd('call 9am', { now: NOW }).due, '2026-11-26', '9am already passed today, so tomorrow');
  assert.equal(parseQuickAdd('call 11am', { now: NOW }).due, TODAY);
  assert.equal(parseQuickAdd('tonight pizza', { now: NOW }).time, '20:00');
  const plain = parseQuickAdd('buy sun cream and 2 apples', { now: NOW });
  assert.equal(plain.due, '', 'sun cream is not Sunday');
  assert.equal(plain.time, '', 'a bare number is not a time');
  assert.equal(plain.title, 'buy sun cream and 2 apples');
  assert.equal(parseQuickAdd('', { now: NOW }).title, '');
  assert.equal(parseQuickAdd('   tomorrow   ', { now: NOW }).title, 'tomorrow', 'never ends up with an empty title');
  const evil = parseQuickAdd('<script>alert(1)</script> tomorrow', { now: NOW });
  assert.equal(evil.title, '<script>alert(1)</script>', 'kept as plain text; the UI renders text nodes only');
  assert.equal(parseQuickAdd('x 13/45', { now: NOW }).due, '', 'impossible dates are ignored');
});

test('repeat rules: next due is strictly after today, month ends clamp, weekdays skip weekends', () => {
  assert.equal(stepOnce('2026-11-27', 'weekdays'), '2026-11-30');
  assert.equal(nextDue({ due: '2026-11-25', repeat: 'daily' }, TODAY), '2026-11-26');
  assert.equal(nextDue({ due: '2026-11-10', repeat: 'daily' }, TODAY), '2026-11-26', 'an old overdue repeat jumps to the future');
  assert.equal(nextDue({ due: '2026-12-01', repeat: 'daily' }, TODAY), '2026-12-02', 'finished early: the next one follows the due day');
  assert.equal(nextDue({ due: '2026-11-25', repeat: 'weekly' }, TODAY), '2026-12-02');
  assert.equal(nextDue({ due: '2026-01-31', repeat: 'monthly' }, '2026-01-31'), '2026-02-28');
  assert.equal(nextDue({ due: '2026-11-30', repeat: 'monthly' }, '2026-11-30'), '2026-12-30');
  assert.equal(nextDue({ due: '', repeat: 'daily' }, TODAY), null);
  assert.equal(nextDue({ due: TODAY, repeat: '' }, TODAY), null);
  assert.deepEqual(occurrences({ due: '2026-11-25', repeat: 'weekly', done: false }, '2026-11-25', '2026-12-20'), ['2026-11-25', '2026-12-02', '2026-12-09', '2026-12-16']);
  assert.deepEqual(occurrences({ due: '2026-01-31', repeat: 'monthly', done: false }, '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.deepEqual(occurrences({ due: '', repeat: 'daily' }, '2026-01-01', '2027-01-01'), []);
  assert.equal(occurrences({ due: '2026-01-01', repeat: 'daily', done: false }, '2026-01-01', '2030-01-01').length, 400, 'capped');
});

test('groupTasks: overdue, today, upcoming, someday and done are split and sorted', () => {
  const mk = (id, due, time = '', priority = 0, done = false) => ({ id, title: id, due, time, priority, done, doneAt: done ? `2026-11-2${id}T10:00:00.000Z` : '', createdAt: `2026-11-01T00:00:0${id}.000Z` });
  const g = groupTasks([mk('1', '2026-11-20'), mk('2', TODAY, '15:00'), mk('3', TODAY, '09:00'), mk('4', TODAY, '', 3), mk('5', '2026-12-01'), mk('6', ''), mk('7', TODAY, '', 0, true)], TODAY);
  assert.deepEqual(g.overdue.map((t) => t.id), ['1']);
  assert.deepEqual(g.today.map((t) => t.id), ['3', '2', '4'], 'timed first by time, untimed last');
  assert.deepEqual(g.upcoming.map((t) => t.id), ['5']);
  assert.deepEqual(g.someday.map((t) => t.id), ['6']);
  assert.deepEqual(g.done.map((t) => t.id), ['7']);
  assert.equal(g.openCount, 6);
});

test('task schema: validates, drops unknown fields, keeps time only with a due day', () => {
  const ok = prepare('task', { id: 'tk_1', title: '  Pay rent  ', due: TODAY, time: '09:30', priority: 2, subtasks: [{ t: 'a', d: true }], evil: '<b>' });
  assert.equal(ok.title, 'Pay rent');
  assert.equal(ok.evil, undefined);
  assert.equal(ok.done, false);
  assert.equal(ok.repeat, '');
  for (const bad of [{ title: '' }, { title: 'x', due: '2026-13-01' }, { title: 'x', time: '25:00', due: TODAY }, { title: 'x', time: '10:00' },
    { title: 'x', priority: 9 }, { title: 'x', repeat: 'hourly' }, { title: 'x', subtasks: [{ t: '' }] }, { title: 'x', subtasks: Array.from({ length: 21 }, () => ({ t: 'a' })) }]) {
    assert.throws(() => prepare('task', { id: 'tk_2', ...bad }), (e) => e instanceof DataError && e.code === 'invalid', JSON.stringify(bad).slice(0, 60));
  }
});

async function fresh() {
  const s = createStore();
  await s.init({ adapter: new MemoryAdapter(), clock: () => NOW });
  const game = createGame(s);
  return { s, game, t: createTasks(s, game), b: createBackup(s) };
}

test('completing: one-off closes, repeating moves on, XP is paid once per occurrence, undo restores', async () => {
  const { s, t, game } = await fresh();
  const a = await t.add({ title: 'Write report', due: TODAY, priority: 2 }, { now: NOW });
  assert.equal(a.award.action.type, 'todo_add');
  const done = await t.complete(a.task.id, { now: NOW });
  assert.equal(done.task.done, true);
  assert.ok(done.task.doneAt);
  assert.ok(done.award.xpGained >= 6);
  assert.equal(game.snapshot({ now: NOW }).streak.current, 1, 'finishing a task counts for the streak');
  const again = await t.complete(a.task.id, { now: NOW });
  assert.equal(again.award, null, 'already done: nothing happens');
  await t.reopen(a.task.id);
  const second = await t.complete(a.task.id, { now: NOW });
  assert.equal(second.award.duplicate, true, 'finishing the same occurrence again pays nothing (no XP farming)');
  assert.equal(second.award.xpGained, 0);

  const rep = await t.add({ title: 'Stretch', due: TODAY, repeat: 'daily', subtasks: [{ t: 'neck', d: true }] }, { now: NOW });
  const r1 = await t.complete(rep.task.id, { now: NOW });
  assert.equal(r1.task.done, false);
  assert.equal(r1.task.due, '2026-11-26');
  assert.equal(r1.task.lastDone, TODAY);
  assert.deepEqual(r1.task.subtasks, [{ t: 'neck', d: false }], 'subtasks reset for the next round');
  await t.restore(r1.previous);
  assert.equal(s.get('task', rep.task.id).due, TODAY, 'undo puts the task back');
  await assert.rejects(() => t.complete('nope', { now: NOW }), (e) => e.code === 'not_found');
});

test('quests and badges: finishing tasks drives the daily quest, the weekly challenge and the badge', async () => {
  const { t, game } = await fresh();
  const cat = game.catalog();
  assert.ok(cat.quests.some((q) => q.metric === 'todo'));
  assert.ok(cat.badges.some((b) => b.id === 'b_todo_1'));
  const x = await t.add({ title: 'one', due: TODAY }, { now: NOW });
  const r = await t.complete(x.task.id, { now: NOW });
  assert.ok(r.award.badgesEarned.some((b) => b.id === 'b_todo_1'));
});

test('between(): shows one-off tasks and future repeats for the calendar', async () => {
  const { t } = await fresh();
  await t.add({ title: 'solo', due: '2026-12-02' });
  await t.add({ title: 'weekly', due: '2026-11-25', repeat: 'weekly' });
  const list = t.between('2026-11-25', '2026-12-10');
  assert.deepEqual(list.map((x) => `${x.day} ${x.task.title}`), ['2026-11-25 weekly', '2026-12-02 solo', '2026-12-02 weekly', '2026-12-09 weekly']);
});

test('migration 1 -> 2 adds the task kind; a version 1 backup still imports', async () => {
  const b = migrateBundle({ kinds: { event: [] }, settings: {} }, 1, 2, MIGRATIONS);
  assert.deepEqual(b.kinds.task, []);
  const { b: backup, s } = await fresh();
  const rep = await backup.importAll(JSON.stringify({ format: 'daybeat-backup', version: 1, exportedAt: NOW.toISOString(), settings: {}, data: { alarm: [{ id: 'a1', time: '07:00', days: [1] }] } }));
  assert.equal(rep.ok, true);
  assert.equal(s.count('alarm'), 1);
  assert.equal(s.count('task'), 0);
});

test('calendar export: valid ICS with alerts, escapes, folding and floating local times', () => {
  const tasks = [
    { id: 't1', title: 'Call mum, then dad; ok', notes: 'line1\nline2', due: '2026-11-26', time: '17:00', repeat: 'weekly', priority: 3, remindMin: null, done: false, subtasks: [{ t: 'flowers', d: false }] },
    { id: 't2', title: 'All day thing', notes: '', due: '2026-11-27', time: '', repeat: '', priority: 0, remindMin: 60, done: false, subtasks: [] },
    { id: 't3', title: 'No date', due: '', done: false, subtasks: [] },
    { id: 't4', title: 'Finished', due: TODAY, done: true, subtasks: [] },
  ];
  const alarms = [
    { id: 'a1', time: '06:30', days: [1, 2, 3, 4, 5], enabled: true, label: 'Work', note: '' },
    { id: 'a2', time: '07:00', days: [0, 1, 2, 3, 4, 5, 6], enabled: true, label: '', note: '' },
    { id: 'a3', time: '09:00', days: [], enabled: true, label: 'Once', note: '' },
    { id: 'a4', time: '10:00', days: [1], enabled: false, label: 'Off', note: '' },
  ];
  const r = buildCalendar({ tasks, alarms }, { now: NOW, remindMin: 10 });
  assert.deepEqual(r.counts, { tasks: 2, alarms: 3, skipped: 3 });
  const lines = r.text.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines.at(-2), 'END:VCALENDAR');
  assert.equal(lines.at(-1), '', 'ends with CRLF');
  assert.ok(lines.every((l) => new TextEncoder().encode(l).length <= 75), 'all lines folded to 75 octets');
  const unfolded = r.text.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:Call mum\\, then dad\\; ok'));
  assert.ok(unfolded.includes('DTSTART:20261126T170000'), 'floating local time, no Z');
  assert.ok(unfolded.includes('DTEND:20261126T173000'));
  assert.ok(unfolded.includes('RRULE:FREQ=WEEKLY\r\n'));
  assert.ok(unfolded.includes('TRIGGER:-PT10M'), 'task default lead is 10 minutes');
  assert.ok(unfolded.includes('DTSTART;VALUE=DATE:20261127'));
  assert.ok(unfolded.includes('TRIGGER:PT480M'), 'all-day with 60 min lead: 09:00 minus 60 = 08:00');
  assert.ok(unfolded.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'));
  assert.ok(unfolded.includes('RRULE:FREQ=DAILY'));
  assert.ok(unfolded.includes('SUMMARY:Alarm: Work'));
  assert.ok(unfolded.includes('TRIGGER:PT0S'), 'alarms alert at the time');
  assert.ok(!unfolded.includes('Off'), 'switched-off alarms are not exported');
  assert.equal((unfolded.match(/BEGIN:VEVENT/g) || []).length, 5);
  assert.equal((unfolded.match(/BEGIN:VALARM/g) || []).length, 5);
  assert.match(r.filename, /^daybeat-reminders-2026-11-25\.ics$/);
  assert.equal(escText('a\\b'), 'a\\\\b');
  assert.ok(fold('x'.repeat(200)).split('\r\n').every((l) => l.length <= 75));
  assert.ok(fold('é'.repeat(100)).split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75), 'never splits a multi-byte character');
});

test('calendar export round-trips through our own ICS importer', async () => {
  const icsMod = await import('../js/data/ics.js');
  const r = buildCalendar({ tasks: [{ id: 't1', title: 'Dentist', notes: '', due: '2026-11-26', time: '08:15', repeat: '', priority: 0, remindMin: 0, done: false, subtasks: [] }], alarms: [] }, { now: NOW });
  const parsed = icsMod.parse(r.text, { now: NOW });
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].title, 'Dentist');
  const start = new Date(parsed.events[0].start);
  assert.equal(`${start.getHours()}:${start.getMinutes()}`, '8:15');
});

test('page settings: ui_ names may use capital letters (ui_stepGoal), but not spaces or other characters', async () => {
  const { checkSetting } = await import('../js/data/schema.js');
  assert.equal(checkSetting('ui_stepGoal', 9000), 9000);
  assert.equal(checkSetting('ui_taskView', 'upcoming'), 'upcoming');
  assert.throws(() => checkSetting('ui_bad key', 1), (e) => e.code === 'invalid');
  assert.throws(() => checkSetting('ui_x/y', 1), (e) => e.code === 'invalid');
  assert.throws(() => checkSetting('notui_x', 1), (e) => e.code === 'invalid');
});
