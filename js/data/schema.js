// Entity definitions, limits, validation and sanitising. Pure functions, no I/O.
// Every record that enters the store (from the UI, an importer or a backup file) goes through prepare().

export const SCHEMA_VERSION = 2;
export const BACKUP_FORMAT = 'daybeat-backup';
// Unique on purpose: IndexedDB/localStorage/CacheStorage are shared by every page of the same origin
// (for example all project pages of one github.io account).
export const DB_NAME = 'daybeat-data';
export const KINDS = Object.freeze(['event', 'alarm', 'message', 'checkin', 'daily', 'action', 'task']);
export const TASK_REPEATS = Object.freeze(['', 'daily', 'weekdays', 'weekly', 'monthly']);
export const SOURCES = Object.freeze(['user', 'demo', 'import']);

export const LIMITS = Object.freeze({
  backupBytes: 25 * 1024 * 1024,
  recordsPerKind: 100000,
  icsBytes: 5 * 1024 * 1024,
  icsComponents: 20000,
  icsEvents: 5000,
  icsOccurrencesPerSeries: 520,
  icsIterationsPerSeries: 20000,
  pasteDrafts: 100,
  queryTextChars: 4000,
  errorsReported: 100,
  zipEntries: 20000,
  zipEntryBytes: 200 * 1024 * 1024,
  zipTotalBytes: 1024 * 1024 * 1024,
});

export class DataError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = 'DataError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

// ---------------------------------------------------------------- text helpers

const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const BIDI_RE = /[‪-‮⁦-⁩﻿]/g;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Plain-text clean-up: no control chars, no bidi overrides, no lone surrogates. Newlines kept only if multiline. */
export function cleanText(value, { multiline = false } = {}) {
  let s = String(value);
  s = s.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n');
  s = s.replace(CTRL_RE, '').replace(BIDI_RE, '').replace(LONE_SURROGATE_RE, '�');
  if (multiline) {
    s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n');
  } else {
    s = s.replace(/[\n\t]+/g, ' ');
  }
  return s.trim();
}

/** Truncate to max UTF-16 units without splitting a surrogate pair. */
export function truncate(s, max) {
  if (s.length <= max) return s;
  let end = max;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end -= 1;
  return s.slice(0, end);
}

export const ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']);
export const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const MIN_MS = Date.UTC(1970, 0, 1);
const MAX_MS = Date.UTC(2200, 0, 1);

export function isDayKey(s) {
  if (typeof s !== 'string') return false;
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 1970 || y > 2199 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Accepts ISO string with zone, Date or epoch ms; returns canonical ISO (Z) or null. */
export function toInstant(v) {
  let ms;
  if (v instanceof Date) ms = v.getTime();
  else if (typeof v === 'number') ms = v;
  else if (typeof v === 'string' && INSTANT_RE.test(v) && isDayKey(v.slice(0, 10)) && +v.slice(11, 13) < 24 && +v.slice(14, 16) < 60) ms = Date.parse(v);
  else return null;
  if (!Number.isFinite(ms) || ms < MIN_MS || ms >= MAX_MS) return null;
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------- field validators
// Each validator pushes into errs and returns the cleaned value (or undefined).

function fText(errs, obj, field, { max, required = false, multiline = false, def = '' } = {}) {
  let v = obj[field];
  if (v === undefined || v === null) {
    if (required) errs.push({ field, message: `${field} is required` });
    return def;
  }
  if (typeof v !== 'string') {
    errs.push({ field, message: `${field} must be text` });
    return def;
  }
  v = cleanText(v, { multiline });
  if (required && v.length === 0) errs.push({ field, message: `${field} is required` });
  if (v.length > max) {
    errs.push({ field, message: `${field} is too long (max ${max} characters)` });
    return def;
  }
  return v;
}

function fBool(errs, obj, field, def) {
  const v = obj[field];
  if (v === undefined || v === null) return def;
  if (typeof v !== 'boolean') {
    errs.push({ field, message: `${field} must be true or false` });
    return def;
  }
  return v;
}

function fInt(errs, obj, field, { min, max, def, nullable = false }) {
  const v = obj[field];
  if (v === undefined || v === null) return nullable ? null : def;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    errs.push({ field, message: `${field} must be a whole number from ${min} to ${max}` });
    return def;
  }
  return v;
}

function fEnum(errs, obj, field, allowed, def) {
  const v = obj[field];
  if (v === undefined || v === null) return def;
  if (!allowed.includes(v)) {
    errs.push({ field, message: `${field} must be one of: ${allowed.join(', ')}` });
    return def;
  }
  return v;
}

function fInstant(errs, obj, field, def) {
  const v = obj[field];
  if (v === undefined || v === null || v === '') {
    if (def === undefined) errs.push({ field, message: `${field} is required` });
    return def;
  }
  const iso = toInstant(v);
  if (!iso) {
    errs.push({ field, message: `${field} must be an ISO date-time such as 2026-11-25T14:30:00Z` });
    return def;
  }
  return iso;
}

function fDay(errs, obj, field, def) {
  const v = obj[field];
  if (v === undefined || v === null || v === '') {
    if (def === undefined) errs.push({ field, message: `${field} is required` });
    return def;
  }
  if (!isDayKey(v)) {
    errs.push({ field, message: `${field} must be a date like 2026-11-25` });
    return def;
  }
  return v;
}

function localDayOf(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------- per-kind normalisers
// (obj, nowIso) -> { value, errs }. Output contains only whitelisted fields.

const NORMALIZERS = {
  event(o, nowIso, errs) {
    const allDay = fBool(errs, o, 'allDay', false);
    const title = fText(errs, o, 'title', { max: 200, required: true });
    let start;
    let end;
    if (allDay) {
      start = fDay(errs, o, 'start');
      end = fDay(errs, o, 'end', start);
    } else {
      start = fInstant(errs, o, 'start');
      end = fInstant(errs, o, 'end', start);
    }
    if (start && end && end < start) errs.push({ field: 'end', message: 'end must not be before start' });
    return {
      title,
      allDay,
      start: start ?? '',
      end: end ?? '',
      location: fText(errs, o, 'location', { max: 200 }),
      notes: fText(errs, o, 'notes', { max: 2000, multiline: true }),
      uid: fText(errs, o, 'uid', { max: 200 }),
    };
  },

  alarm(o, nowIso, errs) {
    let time = o.time;
    if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      errs.push({ field: 'time', message: 'time must look like 07:30 (24 hour)' });
      time = '';
    }
    let days = o.days;
    if (days === undefined || days === null) days = [];
    if (!Array.isArray(days) || days.length > 7 || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      errs.push({ field: 'days', message: 'days must be a list of weekday numbers 0 (Sunday) to 6 (Saturday)' });
      days = [];
    }
    return {
      time,
      days: [...new Set(days)].sort((a, b) => a - b),
      enabled: fBool(errs, o, 'enabled', true),
      label: fText(errs, o, 'label', { max: 60 }),
      note: fText(errs, o, 'note', { max: 200 }),
    };
  },

  message(o, nowIso, errs) {
    let tags = o.tags;
    if (tags === undefined || tags === null) tags = [];
    if (!Array.isArray(tags) || tags.length > 5 || !tags.every((t) => typeof t === 'string')) {
      errs.push({ field: 'tags', message: 'tags must be up to 5 short texts' });
      tags = [];
    } else {
      tags = tags.map((t) => cleanText(t)).filter(Boolean);
      if (tags.some((t) => t.length > 24)) {
        errs.push({ field: 'tags', message: 'each tag must be 24 characters or fewer' });
        tags = [];
      }
      tags = [...new Set(tags)];
    }
    return {
      text: fText(errs, o, 'text', { max: 4000, required: true, multiline: true }),
      from: fText(errs, o, 'from', { max: 80 }),
      at: fInstant(errs, o, 'at', nowIso),
      via: fEnum(errs, o, 'via', ['manual', 'paste', 'shortcut', 'import'], 'manual'),
      pinned: fBool(errs, o, 'pinned', false),
      tags,
    };
  },

  checkin(o, nowIso, errs) {
    const at = fInstant(errs, o, 'at', nowIso);
    const day = fDay(errs, o, 'day', at ? localDayOf(at) : undefined);
    let alarmId = o.alarmId;
    if (alarmId === undefined || alarmId === null) alarmId = '';
    if (typeof alarmId !== 'string' || (alarmId !== '' && !ID_RE.test(alarmId))) {
      errs.push({ field: 'alarmId', message: 'alarmId must be an id or empty' });
      alarmId = '';
    }
    return {
      day: day ?? '',
      at: at ?? '',
      alarmId,
      mood: fInt(errs, o, 'mood', { min: 0, max: 5, def: 0 }),
      note: fText(errs, o, 'note', { max: 200 }),
    };
  },

  daily(o, nowIso, errs) {
    const date = fDay(errs, o, 'date', typeof o.id === 'string' && isDayKey(o.id) ? o.id : undefined);
    return {
      date: date ?? '',
      steps: fInt(errs, o, 'steps', { min: 0, max: 1000000, def: null, nullable: true }),
      sleepMinutes: fInt(errs, o, 'sleepMinutes', { min: 0, max: 2880, def: null, nullable: true }),
      restingHr: fInt(errs, o, 'restingHr', { min: 20, max: 250, def: null, nullable: true }),
      activeMinutes: fInt(errs, o, 'activeMinutes', { min: 0, max: 1440, def: null, nullable: true }),
      note: fText(errs, o, 'note', { max: 200 }),
    };
  },

  task(o, nowIso, errs) {
    const title = fText(errs, o, 'title', { max: 200, required: true });
    let due = o.due;
    if (due === undefined || due === null) due = '';
    if (due !== '' && !isDayKey(due)) {
      errs.push({ field: 'due', message: 'due must be a date like 2026-11-25 or empty' });
      due = '';
    }
    let time = o.time;
    if (time === undefined || time === null) time = '';
    if (time !== '' && (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
      errs.push({ field: 'time', message: 'time must look like 17:30 (24 hour) or be empty' });
      time = '';
    }
    if (time && !due) {
      errs.push({ field: 'time', message: 'a time needs a due date' });
      time = '';
    }
    let lastDone = o.lastDone;
    if (lastDone === undefined || lastDone === null) lastDone = '';
    if (lastDone !== '' && !isDayKey(lastDone)) {
      errs.push({ field: 'lastDone', message: 'lastDone must be a date or empty' });
      lastDone = '';
    }
    const done = fBool(errs, o, 'done', false);
    let doneAt = '';
    if (done) doneAt = fInstant(errs, o, 'doneAt', nowIso) || nowIso;
    let subtasks = o.subtasks;
    if (subtasks === undefined || subtasks === null) subtasks = [];
    if (!Array.isArray(subtasks) || subtasks.length > 20) {
      errs.push({ field: 'subtasks', message: 'subtasks must be a list of up to 20 items' });
      subtasks = [];
    } else {
      const clean = [];
      for (const st of subtasks) {
        const t = st && typeof st === 'object' && typeof st.t === 'string' ? cleanText(st.t) : '';
        if (!t || t.length > 100 || (st.d !== undefined && typeof st.d !== 'boolean')) {
          errs.push({ field: 'subtasks', message: 'each subtask needs text of 1 to 100 characters' });
          break;
        }
        clean.push({ t, d: st.d === true });
      }
      subtasks = clean;
    }
    return {
      title,
      notes: fText(errs, o, 'notes', { max: 2000, multiline: true }),
      due,
      time,
      priority: fInt(errs, o, 'priority', { min: 0, max: 3, def: 0 }),
      list: fText(errs, o, 'list', { max: 24 }),
      repeat: fEnum(errs, o, 'repeat', TASK_REPEATS, ''),
      remindMin: fInt(errs, o, 'remindMin', { min: 0, max: 10080, def: null, nullable: true }),
      done,
      doneAt,
      lastDone,
      subtasks,
    };
  },

  action(o, nowIso, errs) {
    let type = o.type;
    if (typeof type !== 'string' || !/^[a-z_]{1,32}$/.test(type)) {
      errs.push({ field: 'type', message: 'type must be lowercase letters and underscores' });
      type = '';
    }
    const at = fInstant(errs, o, 'at', nowIso);
    const day = fDay(errs, o, 'day', at ? localDayOf(at) : undefined);
    return {
      type,
      day: day ?? '',
      at: at ?? '',
      xp: fInt(errs, o, 'xp', { min: 0, max: 1000, def: 0 }),
      ref: fText(errs, o, 'ref', { max: 100 }),
    };
  },
};

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}
export { deepFreeze };

/**
 * Turn arbitrary input into a clean, frozen record or throw DataError('invalid').
 * opts: { existing, nowIso, defaultSource, keepTimestamps, newId }
 */
export function prepare(kind, input, opts = {}) {
  if (!KINDS.includes(kind)) throw new DataError('invalid', `Unknown kind "${String(kind).slice(0, 40)}"`);
  const { rec, errs } = prepareLoose(kind, input, opts);
  if (errs.length) throw new DataError('invalid', `${errs[0].message}`, errs);
  return rec;
}

/** Like prepare() but returns { rec, errs } instead of throwing (used by the backup importer). */
export function prepareLoose(kind, input, opts = {}) {
  const { existing, nowIso = new Date().toISOString(), defaultSource = 'user', keepTimestamps = false, newId } = opts;
  const errs = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { rec: null, errs: [{ field: '', message: 'record must be an object' }] };
  }
  let id = input.id;
  if (kind === 'daily' && (id === undefined || id === null) && typeof input.date === 'string') id = input.date;
  if (id === undefined || id === null || id === '') id = existing?.id ?? (newId ? newId(kind) : undefined);
  if (typeof id !== 'string' || !ID_RE.test(id) || RESERVED_IDS.has(id)) errs.push({ field: 'id', message: 'id must be 1-100 letters, digits, - _ . :' });
  const fields = NORMALIZERS[kind](input, nowIso, errs);
  if (kind === 'daily' && fields.date && id !== fields.date) {
    if (input.id !== undefined && input.id !== fields.date) errs.push({ field: 'id', message: 'daily id must equal its date' });
    id = fields.date;
  }
  let createdAt = existing?.createdAt ?? nowIso;
  let updatedAt = nowIso;
  if (keepTimestamps) {
    createdAt = input.createdAt === undefined ? createdAt : fInstant(errs, input, 'createdAt', createdAt);
    updatedAt = input.updatedAt === undefined ? updatedAt : fInstant(errs, input, 'updatedAt', updatedAt);
  }
  let source = input.source ?? existing?.source ?? defaultSource;
  if (!SOURCES.includes(source)) {
    errs.push({ field: 'source', message: `source must be one of: ${SOURCES.join(', ')}` });
    source = defaultSource;
  }
  if (errs.length) return { rec: null, errs };
  const rec = deepFreeze({ id, ...fields, source, createdAt, updatedAt });
  return { rec, errs };
}

// ---------------------------------------------------------------- settings

const accentRe = /^[A-Za-z0-9_-]{1,24}$/;
export const SETTING_SPECS = {
  theme: (v) => (['system', 'light', 'dark'].includes(v) ? v : bad('theme must be system, light or dark')),
  accent: (v) => (typeof v === 'string' && accentRe.test(v) ? v : bad('accent must be a short id')),
  name: (v) => {
    if (typeof v !== 'string') return bad('name must be text');
    const s = cleanText(v);
    return s.length <= 40 ? s : bad('name is too long (max 40)');
  },
  weekStart: (v) => ([0, 1, 6].includes(v) ? v : bad('weekStart must be 0, 1 or 6')),
  timeFormat: (v) => (['auto', '12h', '24h'].includes(v) ? v : bad('timeFormat must be auto, 12h or 24h')),
  reduceMotion: (v) => (['system', 'on', 'off'].includes(v) ? v : bad('reduceMotion must be system, on or off')),
  demoMode: boolSetting('demoMode'),
  onboardingDone: boolSetting('onboardingDone'),
  installHintDismissed: boolSetting('installHintDismissed'),
  lastBackupAt: (v) => {
    if (v === '') return '';
    return toInstant(v) ?? bad('lastBackupAt must be an ISO date-time or empty');
  },
};

function bad(msg) {
  throw new DataError('invalid', msg, [{ field: 'value', message: msg }]);
}
function boolSetting(name) {
  return (v) => (typeof v === 'boolean' ? v : bad(`${name} must be true or false`));
}

/** Validate one setting; returns the cleaned value or throws DataError('invalid'). */
export function checkSetting(key, value) {
  if (typeof key !== 'string') bad('setting key must be text');
  if (Object.prototype.hasOwnProperty.call(SETTING_SPECS, key)) return SETTING_SPECS[key](value);
  if (/^ui_[A-Za-z0-9_]{1,40}$/.test(key)) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const s = cleanText(value);
      return s.length <= 200 ? s : bad(`${key} is too long (max 200)`);
    }
    bad(`${key} must be text, a number or true/false`);
  }
  return bad(`Unknown setting "${key.slice(0, 40)}"`);
}

/** Lenient: returns {ok, value|message}; used for backup settings. */
export function tryCheckSetting(key, value) {
  try {
    return { ok: true, value: checkSetting(key, value) };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
