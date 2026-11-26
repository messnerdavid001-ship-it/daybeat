// Date, time and number formatting. All output is plain text (callers set it as text nodes).
// `pref` is the 'timeFormat' setting: 'auto' | '12h' | '24h'.

const hour12 = (pref) => (pref === '12h' ? true : pref === '24h' ? false : undefined);

export function fmtTime(date, pref = 'auto') {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: hour12(pref) }).format(date);
}

/** 'HH:MM' (24h wall clock string) -> '6:45 AM' / '06:45' following the user's preference. */
export function fmtClock(hhmm, pref = 'auto') {
  const [h, m] = String(hhmm).split(':').map((n) => parseInt(n, 10));
  const d = new Date(2000, 0, 1, h || 0, m || 0);
  return fmtTime(d, pref);
}

/** Split a clock into big digits and a small suffix, e.g. { main: '6:45', suffix: 'AM' } */
export function clockParts(hhmm, pref = 'auto') {
  const [h, m] = String(hhmm).split(':').map((n) => parseInt(n, 10));
  const d = new Date(2000, 0, 1, h || 0, m || 0);
  const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: hour12(pref) }).formatToParts(d);
  const suffix = parts.find((p) => p.type === 'dayPeriod');
  const main = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
  return { main, suffix: suffix ? suffix.value : '' };
}

export const fmtDate = (date, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat(undefined, opts).format(date);
export const fmtDayLong = (date) => fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' });
export const fmtMonthYear = (date) => fmtDate(date, { month: 'long', year: 'numeric' });

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

/** 7 -> "in 7 min", 135 -> "in 2h 15m", 3000 -> "in 2 days". Pass a millisecond difference. */
export function untilText(ms) {
  const past = ms < 0;
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60000);
  let body;
  if (min < 1) body = 'now';
  else if (min < 60) body = `${min} min`;
  else if (min < 60 * 24) {
    const h = Math.floor(min / 60), m = min % 60;
    body = m ? `${h}h ${m}m` : `${h}h`;
  } else body = plural(Math.round(min / (60 * 24)), 'day');
  if (body === 'now') return 'now';
  return past ? `${body} ago` : `in ${body}`;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export const fmtNumber = (n) => new Intl.NumberFormat().format(n);

export function minutesToHM(min) {
  if (min === null || min === undefined) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function dayKeyOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Day key -> local-midnight Date */
export function dateOfKey(key) {
  const [y, m, d] = key.split('-').map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d);
}
