// Calendar export: turns tasks and alarms into an .ics file with alerts (VALARM), so the phone's own Calendar app can
// fire REAL notifications (and, through the phone, the watch can show them). A web page cannot ring when it is closed;
// this is the honest bridge. Times are written as floating local times (no zone), so they stay at the same wall clock
// on whatever device opens the file. Pure functions, no I/O.

import { addDays, dayDiff, dayOfWeek, dayKey, nextAlarm, toDate } from './dates.js';

const CRLF = '\r\n';
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const p2 = (n) => String(n).padStart(2, '0');

/** RFC 5545 text escaping. */
export function escText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

/** Fold a content line at 75 octets (UTF-8 aware; never splits a character). */
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join(CRLF);
}

const dateStr = (key) => key.replace(/-/g, '');
const localStr = (key, hhmm) => `${dateStr(key)}T${hhmm.replace(':', '')}00`;
const stampStr = (d) => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;

/** Add minutes to a wall-clock day+time without any time-zone arithmetic. */
function addWall(key, hhmm, minutes) {
  const [y, m, d] = key.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, h, mi + minutes, 0));
  return { key: `${String(t.getUTCFullYear()).padStart(4, '0')}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`, time: `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}` };
}

const durationOf = (min) => (min === 0 ? 'PT0S' : min < 0 ? `-PT${-min}M` : `PT${min}M`);

function rrule(repeat) {
  if (repeat === 'daily') return 'RRULE:FREQ=DAILY';
  if (repeat === 'weekdays') return 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  if (repeat === 'weekly') return 'RRULE:FREQ=WEEKLY';
  if (repeat === 'monthly') return 'RRULE:FREQ=MONTHLY';
  return null;
}

function valarm(triggerMin, text) {
  return ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText(text)}`, `TRIGGER:${durationOf(triggerMin)}`, 'END:VALARM'];
}

export const REMIND_CHOICES = Object.freeze([
  { value: 0, label: 'At the time' },
  { value: 10, label: '10 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
]);

function taskLines(task, { stamp, remindMin }) {
  if (!task.due || task.done) return null;
  const lead = task.remindMin ?? remindMin;
  const desc = [task.notes, ...(task.subtasks || []).map((s) => `${s.d ? '[x]' : '[ ]'} ${s.t}`), 'From Daybeat'].filter(Boolean).join('\n');
  const lines = ['BEGIN:VEVENT', `UID:daybeat-task-${task.id}@daybeat.local`, `DTSTAMP:${stamp}`];
  if (task.time) {
    const end = addWall(task.due, task.time, 30);
    lines.push(`DTSTART:${localStr(task.due, task.time)}`, `DTEND:${localStr(end.key, end.time)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${dateStr(task.due)}`, `DTEND;VALUE=DATE:${dateStr(addDays(task.due, 1))}`);
  }
  lines.push(`SUMMARY:${escText(task.title)}`, `DESCRIPTION:${escText(desc)}`);
  const rule = rrule(task.repeat);
  if (rule) lines.push(rule);
  if (task.priority === 3) lines.push('PRIORITY:1');
  else if (task.priority === 2) lines.push('PRIORITY:5');
  else if (task.priority === 1) lines.push('PRIORITY:9');
  // timed: alert `lead` minutes before. all-day: alert at 09:00 on the day, moved earlier by `lead`.
  lines.push(...valarm(task.time ? -lead : 9 * 60 - lead, task.title));
  lines.push('END:VEVENT');
  return lines;
}

function alarmLines(alarm, { stamp, now }) {
  const first = nextAlarm({ ...alarm, enabled: true }, now);
  if (!first) return null;
  const key = dayKey(first);
  const time = `${p2(first.getHours())}:${p2(first.getMinutes())}`;
  const end = addWall(key, time, 5);
  const title = alarm.label ? `Alarm: ${alarm.label}` : 'Alarm';
  const lines = ['BEGIN:VEVENT', `UID:daybeat-alarm-${alarm.id}@daybeat.local`, `DTSTAMP:${stamp}`,
    `DTSTART:${localStr(key, time)}`, `DTEND:${localStr(end.key, end.time)}`, `SUMMARY:${escText(title)}`,
    `DESCRIPTION:${escText([alarm.note, 'From Daybeat. Set the same alarm on your watch if you want it to buzz.'].filter(Boolean).join('\n'))}`];
  const days = [...new Set(alarm.days || [])].sort((a, b) => a - b);
  if (days.length === 7) lines.push('RRULE:FREQ=DAILY');
  else if (days.length) lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(',')}`);
  lines.push(...valarm(0, title));
  lines.push('END:VEVENT');
  return lines;
}

/**
 * buildCalendar({ tasks, alarms }, { now, name, remindMin, includeDisabledAlarms })
 * -> { text, filename, counts: { tasks, alarms, skipped }, bytes }
 * Done tasks, tasks without a due day and (by default) switched-off alarms are skipped and counted.
 */
export function buildCalendar({ tasks = [], alarms = [] } = {}, { now, name = 'Daybeat', remindMin = 10, includeDisabledAlarms = false } = {}) {
  const when = toDate(now ?? new Date());
  const stamp = stampStr(when);
  const body = [];
  const counts = { tasks: 0, alarms: 0, skipped: 0 };
  for (const t of tasks) {
    const l = taskLines(t, { stamp, remindMin });
    if (l) { body.push(...l); counts.tasks++; } else counts.skipped++;
  }
  for (const a of alarms) {
    if (!a.enabled && !includeDisabledAlarms) { counts.skipped++; continue; }
    const l = alarmLines(a, { stamp, now: when });
    if (l) { body.push(...l); counts.alarms++; } else counts.skipped++;
  }
  const head = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daybeat//Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escText(name)}`];
  const text = [...head, ...body, 'END:VCALENDAR'].map(fold).join(CRLF) + CRLF;
  const stampDay = dayKey(when);
  return { text, filename: `daybeat-reminders-${stampDay}.ics`, counts, bytes: new TextEncoder().encode(text).length };
}

export { dayDiff, dayOfWeek };
