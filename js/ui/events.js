// Shared wording for calendar events (used by Today and Calendar). Returns plain text.
import { fmtTime, fmtDate, dateOfKey } from './format.js';

/** 'Today' | 'Tomorrow' | 'Yesterday' | 'Fri, Nov 28' for a day key, relative to todayKey. */
export function dayLabel(dayKey, todayKey, dates) {
  if (dayKey === todayKey) return 'Today';
  if (dayKey === dates.addDays(todayKey, 1)) return 'Tomorrow';
  if (dayKey === dates.addDays(todayKey, -1)) return 'Yesterday';
  return fmtDate(dateOfKey(dayKey));
}

/** '9:00 AM to 10:00 AM', 'All day', 'All day until Fri, Nov 28' */
export function eventTimeText(ev, pref = 'auto') {
  if (ev.allDay) {
    return ev.end && ev.end !== ev.start ? `All day until ${fmtDate(dateOfKey(ev.end))}` : 'All day';
  }
  const start = new Date(ev.start);
  const end = ev.end ? new Date(ev.end) : null;
  if (!end || end.getTime() === start.getTime()) return fmtTime(start, pref);
  return `${fmtTime(start, pref)} to ${fmtTime(end, pref)}`;
}
