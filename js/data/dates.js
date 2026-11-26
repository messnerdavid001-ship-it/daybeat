// Date helpers. Pure functions; every function that needs "now" or a time zone accepts it as a parameter.
// Day keys are 'YYYY-MM-DD' strings. Without an explicit tz the DEVICE time zone is used.

const DAY_MS = 86400000;
const p2 = (n) => String(n).padStart(2, '0');

/** Date | ISO string | epoch ms | undefined (= real now) -> Date. Throws on garbage. */
export function toDate(now) {
  if (now === undefined || now === null) return new Date();
  if (now instanceof Date) {
    if (Number.isNaN(now.getTime())) throw new RangeError('Invalid date');
    return now;
  }
  const d = new Date(now);
  if (Number.isNaN(d.getTime())) throw new RangeError('Invalid date');
  return d;
}

const fmtCache = new Map();
function partsFormatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** True if the IANA zone name is known to this browser. */
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    partsFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

function wallParts(ms, tz) {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Offset (wall clock minus UTC) in ms of zone tz at instant ms. */
function zoneOffsetMs(ms, tz) {
  const w = wallParts(ms, tz);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour % 24, w.minute, w.second);
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
}

/** 'YYYY-MM-DD' for the given instant in tz (default: device zone). A day key passes through unchanged. */
export function dayKey(dateOrIso, tz) {
  if (typeof dateOrIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOrIso)) {
    splitKey(dateOrIso); // throws RangeError for impossible dates such as 2026-13-45
    return dateOrIso;
  }
  const d = toDate(dateOrIso);
  if (tz) {
    const w = wallParts(d.getTime(), tz);
    return `${w.year}-${p2(w.month)}-${p2(w.day)}`;
  }
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function todayKey(now, tz) {
  return dayKey(toDate(now), tz);
}

function daysInMonth(y, m) {
  const t = new Date(Date.UTC(2000, 0, 1));
  t.setUTCFullYear(y, m, 0); // day 0 of the next month = last day of month m
  return t.getUTCDate();
}

/** True only for a real calendar date written as 'YYYY-MM-DD'. */
export function isValidDayKey(key) {
  try {
    splitKey(key);
    return true;
  } catch {
    return false;
  }
}

function splitKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  const y = m ? Number(m[1]) : 0;
  const mo = m ? Number(m[2]) : 0;
  const d = m ? Number(m[3]) : 0;
  if (!m || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) {
    throw new RangeError(`Bad day key: ${String(key).slice(0, 20)}`);
  }
  return [y, mo, d];
}

/** Local midnight (first valid moment of that day) as a Date. */
export function parseDayKey(key) {
  const [y, m, d] = splitKey(key);
  const dt = new Date(2000, 0, 1);
  dt.setFullYear(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

/** Calendar arithmetic on day keys (no time zone involved). */
export function addDays(key, n) {
  const [y, m, d] = splitKey(key);
  const t = new Date(Date.UTC(2000, 0, 1));
  t.setUTCFullYear(y, m - 1, d + n);
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}

/** Whole days from key a to key b (b - a). */
export function dayDiff(a, b) {
  const [ya, ma, da] = splitKey(a);
  const [yb, mb, db] = splitKey(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS);
}

/** 0 = Sunday .. 6 = Saturday for a day key. */
export function dayOfWeek(key) {
  const [y, m, d] = splitKey(key);
  const t = new Date(Date.UTC(2000, 0, 1));
  t.setUTCFullYear(y, m - 1, d);
  return t.getUTCDay();
}

/** First day of the week containing key. weekStartsOn: 0 Sunday, 1 Monday (default), 6 Saturday. */
export function weekStart(key, weekStartsOn = 1) {
  const back = (dayOfWeek(key) - weekStartsOn + 7) % 7;
  return addDays(key, -back);
}

/**
 * Instant (ms) for a wall-clock time in a zone.
 * w = { y, m(1-12), d, h, mi, s }; tz undefined = device zone.
 * Gap (wall time that does not exist): shifted forward by the gap (02:30 -> 03:30).
 * Overlap (wall time occurs twice): the FIRST occurrence.
 * Returns NaN for an unknown tz.
 */
export function zonedToInstant(w, tz) {
  const { y, m, d, h = 0, mi = 0, s = 0 } = w;
  if (!tz) {
    const dt = new Date(2000, 0, 1);
    dt.setFullYear(y, m - 1, d);
    dt.setHours(h, mi, s, 0);
    return dt.getTime();
  }
  if (!isValidTimeZone(tz)) return NaN;
  const t0 = new Date(Date.UTC(2000, 0, 1));
  t0.setUTCFullYear(y, m - 1, d);
  t0.setUTCHours(h, mi, s, 0);
  const naive = t0.getTime();
  const oBefore = zoneOffsetMs(naive - DAY_MS, tz);
  const oAfter = zoneOffsetMs(naive + DAY_MS, tz);
  if (oBefore === oAfter) return naive - oBefore;
  const t1 = naive - oBefore;
  const t2 = naive - oAfter;
  const ok1 = zoneOffsetMs(t1, tz) === oBefore;
  const ok2 = zoneOffsetMs(t2, tz) === oAfter;
  if (ok1 && ok2) return Math.min(t1, t2); // overlap: first occurrence
  if (ok1) return t1;
  if (ok2) return t2;
  return t1; // gap: use the offset before the change, i.e. shift forward
}

/** { startMs, endMs } of an event record; endMs is exclusive. A zero-length timed event has endMs === startMs. */
export function eventSpan(ev) {
  if (ev.allDay) {
    return { startMs: parseDayKey(ev.start).getTime(), endMs: parseDayKey(addDays(ev.end || ev.start, 1)).getTime() };
  }
  const s = Date.parse(ev.start);
  const e = ev.end ? Date.parse(ev.end) : s;
  return { startMs: s, endMs: Math.max(s, e) };
}

/** Does span overlap [fromMs, toMs)? Zero-length spans count when their start is inside. */
export function overlaps(span, fromMs, toMs) {
  const { startMs, endMs } = span;
  if (endMs === startMs) return startMs >= fromMs && startMs < toMs;
  return startMs < toMs && endMs > fromMs;
}

/**
 * Next time an alarm record would ring after `now` (a Date), or null if it is switched off.
 * time 'HH:MM' + days (0 = Sunday; [] = every day until it rings once, i.e. the next occurrence).
 * Resolved in tz (default device zone); see zonedToInstant for DST gap / overlap rules.
 */
export function nextAlarm(alarm, now, tz) {
  if (!alarm || alarm.enabled === false) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(alarm.time || '');
  if (!m) return null;
  const nowD = toDate(now);
  const days = Array.isArray(alarm.days) ? alarm.days : [];
  const today = dayKey(nowD, tz);
  for (let i = 0; i <= 9; i++) {
    const key = addDays(today, i);
    if (days.length && !days.includes(dayOfWeek(key))) continue;
    const [y, mo, d] = splitKey(key);
    const t = zonedToInstant({ y, m: mo, d, h: Number(m[1]), mi: Number(m[2]), s: 0 }, tz);
    if (Number.isFinite(t) && t > nowD.getTime()) return new Date(t);
  }
  return null;
}
