// iCalendar (.ics) importer. Parses locally, returns event DRAFTS; nothing is written until the UI calls store.putMany.
// Hostile-input rules: size limits, a hard cap on components, events and recurrence iterations, no eval, no HTML,
// no attendee/organizer data is ever kept, a bad component lands in errors[] and the rest continues.

import { DataError, LIMITS, cleanText, truncate } from './schema.js';
import { addDays, dayDiff, dayOfWeek, weekStart, zonedToInstant, isValidTimeZone, dayKey, toDate, parseDayKey } from './dates.js';

const WINDOWS_TZ = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'GTB Standard Time': 'Europe/Bucharest',
  'FLE Standard Time': 'Europe/Kiev',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Arab Standard Time': 'Asia/Riyadh',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Singapore Standard Time': 'Asia/Singapore',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'W. Australia Standard Time': 'Australia/Perth',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'SA Pacific Standard Time': 'America/Bogota',
  'Mexico Standard Time': 'America/Mexico_City',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Egypt Standard Time': 'Africa/Cairo',
  'UTC': 'UTC',
};

const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// ------------------------------------------------------------------ low level parsing

function unfold(text) {
  const raw = text.split(/\r\n|\n|\r/);
  const lines = [];
  for (const l of raw) {
    if ((l[0] === ' ' || l[0] === '\t') && lines.length) lines[lines.length - 1] += l.slice(1);
    else lines.push(l);
    if (lines.length > 400000) break;
  }
  return lines;
}

function parseLine(line) {
  const n = line.length;
  let i = 0;
  while (i < n && line[i] !== ';' && line[i] !== ':') i++;
  if (i >= n) return null;
  const name = line.slice(0, i).trim().toUpperCase();
  const params = Object.create(null);
  while (line[i] === ';') {
    i++;
    let j = i;
    while (j < n && line[j] !== '=' && line[j] !== ';' && line[j] !== ':') j++;
    const key = line.slice(i, j).trim().toUpperCase();
    let val = '';
    if (line[j] === '=') {
      j++;
      if (line[j] === '"') {
        const e = line.indexOf('"', j + 1);
        const end = e < 0 ? n : e;
        val = line.slice(j + 1, end);
        j = end + 1;
      } else {
        let k = j;
        while (k < n && line[k] !== ';' && line[k] !== ':') k++;
        val = line.slice(j, k);
        j = k;
      }
    }
    if (key) params[key] = val;
    i = j;
  }
  if (line[i] !== ':') return null;
  return { name, params, value: line.slice(i + 1) };
}

const unescapeText = (s) => s.replace(/\\([nN,;\\])/g, (m, c) => (c === 'n' || c === 'N' ? '\n' : c));

function resolveTz(tzid) {
  if (!tzid) return null;
  let t = tzid.trim();
  if (WINDOWS_TZ[t]) return WINDOWS_TZ[t];
  if (isValidTimeZone(t)) return t;
  const parts = t.split('/');
  for (const n of [2, 1]) {
    if (parts.length >= n) {
      const cand = parts.slice(-n).join('/').replace(/ /g, '_');
      if (isValidTimeZone(cand)) return cand;
    }
  }
  return null;
}

/** -> { kind:'date', key } | { kind:'utc'|'zoned'|'floating', y,m,d,h,mi,s, tz } | null */
function parseDateValue(value, params, ctx) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(String(value).trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 1970 || y > 2199 || mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  const key = `${m[1]}-${m[2]}-${m[3]}`;
  const isDate = m[4] === undefined || String(params.VALUE || '').toUpperCase() === 'DATE';
  if (isDate) return { kind: 'date', key };
  const h = +m[4];
  const mi = +m[5];
  const s = Math.min(59, +(m[6] ?? 0));
  if (h > 23 || mi > 59) return null;
  const base = { y, m: mo, d, h, mi, s };
  if (m[7]) return { kind: 'utc', ...base, tz: 'UTC' };
  if (params.TZID) {
    const tz = resolveTz(params.TZID);
    if (tz) return { kind: 'zoned', ...base, tz };
    ctx.tzFallback++;
  }
  return { kind: 'floating', ...base, tz: null };
}

function dtKey(dt) {
  return dt.kind === 'date' ? dt.key : `${dt.y}-${String(dt.m).padStart(2, '0')}-${String(dt.d).padStart(2, '0')}`;
}

/** Instant (ms) of a parsed value on a given wall date (day key). */
function instantOn(dt, key) {
  if (dt.kind === 'date') return parseDayKey(key).getTime();
  const [y, m, d] = key.split('-').map(Number);
  if (dt.kind === 'utc') return Date.UTC(y, m - 1, d, dt.h, dt.mi, dt.s);
  return zonedToInstant({ y, m, d, h: dt.h, mi: dt.mi, s: dt.s }, dt.tz || undefined);
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(v).trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const [w, d, h, mi, s] = [m[2], m[3], m[4], m[5], m[6]].map((x) => (x ? Number(x) : 0));
  return { days: sign * (w * 7 + d), ms: sign * ((h * 60 + mi) * 60 + s) * 1000 };
}

function hash16(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

// ------------------------------------------------------------------ recurrence

function parseRule(value) {
  const rule = { freq: '', interval: 1, count: null, until: null, byday: [], bymonthday: [], bymonth: [], wkst: 1, simplified: false };
  for (const part of String(value).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim().toUpperCase();
    const v = part.slice(eq + 1).trim().toUpperCase();
    if (k === 'FREQ') rule.freq = v;
    else if (k === 'INTERVAL') rule.interval = Math.min(1000, Math.max(1, parseInt(v, 10) || 1));
    else if (k === 'COUNT') rule.count = Math.max(0, parseInt(v, 10) || 0);
    else if (k === 'UNTIL') rule.until = v;
    else if (k === 'WKST') rule.wkst = WD[v] ?? 1;
    else if (k === 'BYDAY') {
      for (const tok of v.split(',')) {
        const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(tok.trim());
        if (m) rule.byday.push({ n: m[1] ? parseInt(m[1], 10) : 0, wd: WD[m[2]] });
      }
    } else if (k === 'BYMONTHDAY') rule.bymonthday = v.split(',').map((x) => parseInt(x, 10)).filter((x) => x && Math.abs(x) <= 31);
    else if (k === 'BYMONTH') rule.bymonth = v.split(',').map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= 12);
    else if (['BYSETPOS', 'BYWEEKNO', 'BYYEARDAY', 'BYHOUR', 'BYMINUTE', 'BYSECOND'].includes(k)) rule.simplified = true;
  }
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.freq)) return null;
  return rule;
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad2 = (n) => String(n).padStart(2, '0');
const keyOf = (y, m, d) => `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;

/** All candidate day keys for month (y,m) given the rule, ascending. defDay = day of DTSTART. */
function monthCandidates(rule, y, m, defDay) {
  const dim = daysInMonth(y, m);
  const set = new Set();
  const nth = (n, wd) => {
    const cands = [];
    for (let d = 1; d <= dim; d++) if (dayOfWeek(keyOf(y, m, d)) === wd) cands.push(d);
    if (!n) return cands;
    const idx = n > 0 ? n - 1 : cands.length + n;
    return idx >= 0 && idx < cands.length ? [cands[idx]] : [];
  };
  if (rule.bymonthday.length) {
    const days = rule.bymonthday.map((x) => (x > 0 ? x : dim + 1 + x)).filter((x) => x >= 1 && x <= dim);
    if (rule.byday.length) {
      const wds = new Set(rule.byday.map((b) => b.wd));
      for (const d of days) if (wds.has(dayOfWeek(keyOf(y, m, d)))) set.add(d);
    } else for (const d of days) set.add(d);
  } else if (rule.byday.length) {
    for (const b of rule.byday) for (const d of nth(b.n, b.wd)) set.add(d);
  } else if (defDay <= dim) set.add(defDay);
  return [...set].sort((a, b) => a - b).map((d) => keyOf(y, m, d));
}

/**
 * Expand a recurrence into occurrence DAY KEYS (wall dates), within the window, bounded in every dimension.
 * Occurrences before windowStart still count toward COUNT. EXDATE is applied by the caller afterwards.
 */
function expandRule(rule, startKey, { windowStart, windowEnd, untilOk, maxOut, maxIter }) {
  const out = [];
  const [sy, sm, sd] = startKey.split('-').map(Number);
  let generated = 0;
  let truncated = false;
  let stop = false;
  const emit = (key) => {
    if (key < startKey) return;
    generated++;
    if (rule.count !== null && generated > rule.count) {
      stop = true;
      return;
    }
    if (key > windowEnd || !untilOk(key)) {
      stop = true;
      return;
    }
    if (rule.bymonth.length && rule.freq !== 'YEARLY' && !rule.bymonth.includes(+key.slice(5, 7))) return;
    if (key >= windowStart) {
      if (out.length >= maxOut) {
        truncated = true;
        stop = true;
        return;
      }
      out.push(key);
    }
  };

  // Fast-forward when COUNT does not force us to walk from the start.
  let k = 0;
  const canSkip = rule.count === null;
  if (rule.freq === 'DAILY') {
    if (canSkip) k = Math.max(0, Math.floor(dayDiff(startKey, windowStart) / rule.interval) - 1);
  } else if (rule.freq === 'WEEKLY') {
    if (canSkip) k = Math.max(0, Math.floor(dayDiff(weekStart(startKey, rule.wkst), windowStart) / (7 * rule.interval)) - 1);
  } else if (rule.freq === 'MONTHLY') {
    if (canSkip) {
      const months = (+windowStart.slice(0, 4) - sy) * 12 + (+windowStart.slice(5, 7) - sm);
      k = Math.max(0, Math.floor(months / rule.interval) - 1);
    }
  } else if (canSkip) k = Math.max(0, Math.floor((+windowStart.slice(0, 4) - sy) / rule.interval) - 1);

  const wk0 = weekStart(startKey, rule.wkst);
  const wds = rule.byday.length ? [...new Set(rule.byday.map((b) => b.wd))] : [dayOfWeek(startKey)];
  for (let iter = 0; iter < maxIter && !stop; iter++, k++) {
    if (rule.freq === 'DAILY') {
      const key = addDays(startKey, k * rule.interval);
      if (rule.byday.length && !rule.byday.some((b) => b.wd === dayOfWeek(key))) {
        if (key > windowEnd) break;
        continue;
      }
      if (rule.bymonthday.length && !rule.bymonthday.includes(+key.slice(8, 10))) {
        if (key > windowEnd) break;
        continue;
      }
      emit(key);
      if (key > windowEnd) break;
    } else if (rule.freq === 'WEEKLY') {
      const wk = addDays(wk0, 7 * rule.interval * k);
      if (wk > windowEnd) break;
      const days = wds.map((wd) => addDays(wk, (wd - rule.wkst + 7) % 7)).sort();
      for (const key of days) {
        if (stop) break;
        emit(key);
      }
    } else if (rule.freq === 'MONTHLY') {
      const mi = sy * 12 + (sm - 1) + k * rule.interval;
      const y = Math.floor(mi / 12);
      const m = (mi % 12) + 1;
      if (keyOf(y, m, 1) > windowEnd) break;
      for (const key of monthCandidates(rule, y, m, sd)) {
        if (stop) break;
        emit(key);
      }
    } else {
      const y = sy + k * rule.interval;
      if (keyOf(y, 1, 1) > windowEnd) break;
      const months = rule.bymonth.length ? [...rule.bymonth].sort((a, b) => a - b) : [sm];
      for (const m of months) {
        for (const key of monthCandidates(rule.byday.length || rule.bymonthday.length ? rule : { ...rule, byday: [], bymonthday: [] }, y, m, sd)) {
          if (stop) break;
          emit(key);
        }
      }
    }
  }
  return { keys: out, truncated };
}

// ------------------------------------------------------------------ main parse

/**
 * Parse an iCalendar text.
 * Returns { events, errors, errorsTotal, skipped, truncated, stats:{components, expanded, tzFallback} }.
 */
export function parse(text, { now, windowDays = {} } = {}) {
  if (typeof text !== 'string') throw new DataError('bad_format', 'Expected the text of a .ics file.');
  if (text.length > LIMITS.icsBytes) {
    throw new DataError(
      'too_large',
      `This calendar file is larger than ${Math.round(LIMITS.icsBytes / 1048576)} MB. Export a shorter date range from your calendar app (for example the last year and the next year) and try again.`,
    );
  }
  const nowD = toDate(now);
  const before = Number.isFinite(windowDays.before) ? windowDays.before : 90;
  const after = Number.isFinite(windowDays.after) ? windowDays.after : 365;
  const today = dayKey(nowD);
  const windowStart = addDays(today, -Math.abs(before));
  const windowEnd = addDays(today, Math.abs(after));

  const ctx = { tzFallback: 0 };
  const errors = [];
  let errorsTotal = 0;
  const addError = (index, message) => {
    errorsTotal++;
    if (errors.length < LIMITS.errorsReported) errors.push({ index, message });
  };

  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = unfold(src);
  if (!lines.some((l) => /^BEGIN:VCALENDAR/i.test(l.trim()))) {
    throw new DataError('bad_format', 'This does not look like a calendar (.ics) file.');
  }

  // Pass 1: collect VEVENT property bags.
  const rawEvents = [];
  let depth = 0;
  let cur = null;
  let components = 0;
  let truncated = false;
  for (const line of lines) {
    if (!line) continue;
    const p = parseLine(line.length > 8192 ? line.slice(0, 8192) : line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      const comp = p.value.trim().toUpperCase();
      if (cur && comp === 'VEVENT') {
        // A new event starts while one is still open: keep what we have of the open one and report it.
        addError(cur.index, `Event ${cur.index + 1} was not closed (END:VEVENT is missing); it was read as far as it goes`);
        rawEvents.push(cur);
        cur = null;
      }
      if (cur) {
        depth++; // nested component such as VALARM
      } else if (comp === 'VEVENT') {
        components++;
        if (components > LIMITS.icsComponents) {
          truncated = true;
          addError(-1, `Stopped after ${LIMITS.icsComponents} calendar entries; the file is too big to read completely.`);
          break;
        }
        cur = { index: components - 1, props: Object.create(null), exdates: [] };
        depth = 0;
      }
    } else if (p.name === 'END') {
      const comp = p.value.trim().toUpperCase();
      if (cur) {
        if (comp === 'VCALENDAR') {
          addError(cur.index, `Event ${cur.index + 1} was not closed (END:VEVENT is missing); it was read as far as it goes`);
          rawEvents.push(cur);
          cur = null;
        } else if (depth > 0) depth--;
        else if (comp === 'VEVENT') {
          rawEvents.push(cur);
          cur = null;
        }
      }
    } else if (cur && depth === 0) {
      if (p.name === 'EXDATE') cur.exdates.push(p);
      else if (!(p.name in cur.props)) cur.props[p.name] = p;
    }
  }
  if (cur) {
    addError(cur.index, `The file ends in the middle of event ${cur.index + 1}; ${rawEvents.length} complete event(s) were read before it`);
    rawEvents.push(cur);
    cur = null;
  }

  // Pass 2: build events.
  const overrides = new Map(); // uid -> Set of original start keys (RECURRENCE-ID)
  const built = [];
  let skipped = 0;
  const maxOut = LIMITS.icsOccurrencesPerSeries;

  const buildBase = (raw) => {
    const P = raw.props;
    const status = P.STATUS ? P.STATUS.value.trim().toUpperCase() : '';
    if (status === 'CANCELLED') return { cancelled: true };
    if (!P.DTSTART) throw new Error('event has no start date');
    const start = parseDateValue(P.DTSTART.value, P.DTSTART.params, ctx);
    if (!start) throw new Error('event has an unreadable start date');
    const allDay = start.kind === 'date';
    let end = null;
    if (P.DTEND) end = parseDateValue(P.DTEND.value, P.DTEND.params, ctx);
    let durDays = 0;
    let durMs = 0;
    if (allDay) {
      const startKey = start.key;
      let endKey = startKey;
      if (end) {
        endKey = addDays(dtKeyOnly(end), -1); // DTEND is exclusive in ICS; our end is the last day
      } else if (P.DURATION) {
        const dur = parseDuration(P.DURATION.value);
        if (dur) endKey = addDays(startKey, Math.max(0, dur.days + Math.floor(dur.ms / 86400000)) - 1);
      }
      if (endKey < startKey) endKey = startKey;
      durDays = dayDiff(startKey, endKey);
    } else {
      const s = instantOn(start, dtKey(start));
      let e = s;
      if (end) {
        e = end.kind === 'date' ? parseDayKey(end.key).getTime() : instantOn(end, dtKey(end));
      } else if (P.DURATION) {
        const dur = parseDuration(P.DURATION.value);
        if (dur) e = s + dur.days * 86400000 + dur.ms;
      }
      durMs = Number.isFinite(e) && e > s ? e - s : 0;
    }
    const title = truncate(cleanText(unescapeText(P.SUMMARY ? P.SUMMARY.value : '')), 200) || '(no title)';
    const location = truncate(cleanText(unescapeText(P.LOCATION ? P.LOCATION.value : '')), 200);
    const notes = truncate(cleanText(unescapeText(P.DESCRIPTION ? P.DESCRIPTION.value : ''), { multiline: true }), 2000);
    const uid = truncate(cleanText(P.UID ? P.UID.value : ''), 200) || `h${hash16(`${title}|${dtKey(start)}|${location}`)}`;
    return { start, allDay, durDays, durMs, title, location, notes, uid };
  };
  const dtKeyOnly = (dt) => (dt.kind === 'date' ? dt.key : dtKey(dt));

  const makeEvent = (base, occKey) => {
    let startIso;
    let endIso;
    let id;
    const startMs = base.allDay ? 0 : instantOn(base.start, occKey);
    if (!base.allDay && !Number.isFinite(startMs)) throw new Error('event time could not be converted');
    if (base.allDay) {
      startIso = occKey;
      endIso = addDays(occKey, base.durDays);
      id = `ics:${hash16(`${base.uid}|${startIso}`)}`;
    } else {
      startIso = new Date(startMs).toISOString();
      endIso = new Date(startMs + base.durMs).toISOString();
      id = `ics:${hash16(`${base.uid}|${startIso}`)}`;
    }
    return { id, title: base.title, allDay: base.allDay, start: startIso, end: endIso, location: base.location, notes: base.notes, uid: base.uid, source: 'import' };
  };

  // Overrides first (RECURRENCE-ID), so series expansion can skip the replaced occurrences.
  const prepared = [];
  for (const raw of rawEvents) {
    try {
      const base = buildBase(raw);
      if (base.cancelled) {
        skipped++;
        continue;
      }
      let recId = null;
      if (raw.props['RECURRENCE-ID']) {
        const r = parseDateValue(raw.props['RECURRENCE-ID'].value, raw.props['RECURRENCE-ID'].params, ctx);
        if (r) recId = r;
      }
      prepared.push({ raw, base, recId });
      if (recId) {
        if (!overrides.has(base.uid)) overrides.set(base.uid, new Set());
        overrides.get(base.uid).add(recId.kind === 'date' ? recId.key : String(instantOn(recId, dtKey(recId))));
      }
    } catch (e) {
      skipped++;
      addError(raw.index, e.message);
    }
  }

  let expanded = 0;
  for (const { raw, base, recId } of prepared) {
    try {
      const P = raw.props;
      const startKey = dtKeyOnly(base.start);
      if (!P.RRULE || recId) {
        built.push(makeEvent(base, startKey));
        continue;
      }
      const rule = parseRule(P.RRULE.value);
      if (!rule) {
        addError(raw.index, 'Repeat rule not understood; imported once');
        built.push(makeEvent(base, startKey));
        continue;
      }
      if (rule.simplified) addError(raw.index, `"${base.title}": part of its repeat rule is not supported, so some repeats may be missing`);
      // UNTIL
      let untilOk = () => true;
      if (rule.until) {
        const u = parseDateValue(rule.until, {}, ctx);
        if (u) {
          if (base.allDay) untilOk = (key) => key <= dtKeyOnly(u);
          else {
            const untilMs = u.kind === 'date' ? parseDayKey(addDays(u.key, 1)).getTime() - 1 : instantOn(u, dtKey(u));
            untilOk = (key) => instantOn(base.start, key) <= untilMs;
          }
        }
      }
      const excluded = new Set();
      for (const ex of raw.exdates) {
        for (const v of ex.value.split(',')) {
          const d = parseDateValue(v, ex.params, ctx);
          if (d) excluded.add(d.kind === 'date' ? d.key : String(instantOn(d, dtKey(d))));
        }
      }
      const ov = overrides.get(base.uid);
      const { keys, truncated: tr } = expandRule(rule, startKey, { windowStart, windowEnd, untilOk, maxOut, maxIter: LIMITS.icsIterationsPerSeries });
      if (tr) truncated = true;
      for (const key of keys) {
        const id = base.allDay ? key : String(instantOn(base.start, key));
        if (excluded.has(id) || (ov && ov.has(id))) continue;
        built.push(makeEvent(base, key));
        expanded++;
      }
    } catch (e) {
      skipped++;
      addError(raw.index, e.message);
    }
  }

  // De-duplicate by id, then cap the total (keep the events closest to today).
  const seen = new Set();
  let events = [];
  for (const ev of built) {
    if (seen.has(ev.id)) {
      skipped++;
      continue;
    }
    seen.add(ev.id);
    events.push(ev);
  }
  if (events.length > LIMITS.icsEvents) {
    const nowMs = nowD.getTime();
    const dist = (ev) => Math.abs((ev.allDay ? parseDayKey(ev.start).getTime() : Date.parse(ev.start)) - nowMs);
    events.sort((a, b) => dist(a) - dist(b));
    events = events.slice(0, LIMITS.icsEvents);
    truncated = true;
    addError(-1, `Only the ${LIMITS.icsEvents} events closest to today were kept.`);
  }
  events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1));
  return { events, errors, errorsTotal, skipped, truncated, stats: { components, expanded, tzFallback: ctx.tzFallback } };
}

/** File/Blob -> same result as parse(). Rejects by size BEFORE reading the file into memory. */
export async function importFile(file, opts) {
  if (!file || typeof file.size !== 'number' || typeof file.text !== 'function') throw new DataError('bad_format', 'Pick a .ics file.');
  if (file.size > LIMITS.icsBytes) {
    throw new DataError(
      'too_large',
      `This calendar file is larger than ${Math.round(LIMITS.icsBytes / 1048576)} MB. Export a shorter date range from your calendar app (for example the last year and the next year) and try again.`,
    );
  }
  return parse(await file.text(), opts);
}

/** Store-aware helpers: preview which parsed events are new, and write them. */
export function createIcs(store) {
  const I = store._internal;
  return {
    parse,
    importFile,
    preview(res) {
      let fresh = 0;
      let existing = 0;
      for (const ev of res.events) (I.cache('event').has(ev.id) ? existing++ : fresh++);
      return { new: fresh, existing };
    },
    async commit(res) {
      const p = this.preview(res);
      if (res.events.length) await store.putMany('event', res.events);
      return { added: p.new, updated: p.existing, total: res.events.length };
    },
  };
}
