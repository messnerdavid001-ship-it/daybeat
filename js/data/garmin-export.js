// Importer for the "Export Your Data" zip that a Garmin account can request. Everything happens in the browser; the
// file is never uploaded. The layout is only community-documented (no official schema), so this parser is TOLERANT:
// it looks for date-stamped daily summaries and sleep records anywhere in the JSON files it recognises, accepts several
// spellings and units, and never throws on unknown fields.
//
// What it keeps: per day, steps, sleep minutes, resting heart rate, active minutes (numbers only).
// What it NEVER keeps: GPS tracks, activity files (.fit), device serials, account ids, names, e-mail, photos, locations.
// It only copies the five whitelisted fields below, so anything else in the file cannot reach the store.

import { DataError, LIMITS } from './schema.js';
import { dayKey, isValidDayKey } from './dates.js';
import { listEntries, readEntry, storedEntryBlob, toBlob } from './zip.js';

const MAX_NESTED_DEPTH = 2;
const MAX_JSON_NODES = 3_000_000;

// JSON files that can hold daily numbers. Fitness activity files and uploaded .fit archives are skipped on purpose.
const WANTED = /(aggregator|wellness|udsfile|sleepdata|dailysummar|healthstatus|summarizedsleep)/i;
const SKIPPED_ZIP = /(upload|fitness|\.fit)/i;

const lowerKeys = (o) => {
  const m = new Map();
  for (const k of Object.keys(o)) m.set(k.toLowerCase(), o[k]);
  return m;
};
const firstNum = (m, names) => {
  for (const n of names) {
    const v = m.get(n);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
};

/** day key from the many spellings of a date: 'YYYY-MM-DD[...]', {year,month,day}, epoch seconds or ms, ISO instant. */
export function toDay(v) {
  if (typeof v === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(v.trim());
    if (m) {
      if (v.length > 10 && /[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
        const t = Date.parse(v);
        return Number.isFinite(t) ? safeDay(dayKey(new Date(t))) : null;
      }
      return isValidDayKey(m[1]) ? m[1] : null;
    }
    return null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v > 1e11 ? v : v > 1e9 ? v * 1000 : NaN;
    return Number.isFinite(ms) ? safeDay(dayKey(new Date(ms))) : null;
  }
  if (v && typeof v === 'object' && Number.isInteger(v.year) && Number.isInteger(v.month) && Number.isInteger(v.day)) {
    const k = `${String(v.year).padStart(4, '0')}-${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}`;
    return isValidDayKey(k) ? k : null;
  }
  return null;
}
const safeDay = (k) => (isValidDayKey(k) ? k : null);

function metricsOf(m) {
  const out = {};
  const steps = firstNum(m, ['totalsteps', 'steps', 'stepcount', 'totalstepcount']);
  if (steps !== null && steps >= 0 && steps <= 1_000_000) out.steps = Math.round(steps);
  const hr = firstNum(m, ['restingheartrate', 'restinghr', 'currentdayrestingheartrate', 'restingheartratevalue']);
  if (hr !== null && hr >= 20 && hr <= 250) out.restingHr = Math.round(hr);

  const deep = firstNum(m, ['deepsleepseconds']);
  const light = firstNum(m, ['lightsleepseconds']);
  const rem = firstNum(m, ['remsleepseconds']);
  let sleepSec = null;
  if (deep !== null || light !== null || rem !== null) sleepSec = (deep ?? 0) + (light ?? 0) + (rem ?? 0);
  else sleepSec = firstNum(m, ['sleeptimeseconds', 'sleepdurationinseconds', 'totalsleepseconds', 'sleepseconds', 'sleepdurationseconds']);
  if (sleepSec === null) {
    const mins = firstNum(m, ['sleepminutes', 'totalsleepminutes']);
    if (mins !== null) sleepSec = mins * 60;
  }
  if (sleepSec !== null && sleepSec > 0 && sleepSec <= 48 * 3600) out.sleepMinutes = Math.round(sleepSec / 60);

  const mod = firstNum(m, ['moderateintensityminutes']);
  const vig = firstNum(m, ['vigorousintensityminutes']);
  let active = null;
  if (mod !== null || vig !== null) active = (mod ?? 0) + (vig ?? 0);
  else {
    active = firstNum(m, ['activeminutes', 'intensityminutes']);
    if (active === null) {
      const sec = firstNum(m, ['activetimeseconds', 'highlyactiveseconds']);
      if (sec !== null) active = sec / 60;
    }
  }
  if (active !== null && active >= 0 && active <= 1440) out.activeMinutes = Math.round(active);
  return out;
}

const DATE_KEYS = ['calendardate', 'summarydate', 'date', 'startdate', 'wellnessstartdate'];
const TIME_KEYS = ['sleependtimestampgmt', 'sleependtimestamplocal', 'wellnessendtimegmt', 'wellnessstarttimegmt', 'starttimestampgmt', 'starttimestamplocal'];

/**
 * Walk any parsed JSON and collect per-day numbers. Pure; returns Map<dayKey, {steps?, sleepMinutes?, restingHr?, activeMinutes?}>.
 * Several records for one day are merged: the largest steps / sleep / active value wins, the first resting HR wins.
 */
export function extractDaily(json, into = new Map()) {
  let nodes = 0;
  const add = (day, metrics) => {
    if (!day || !Object.keys(metrics).length) return;
    const cur = into.get(day) ?? {};
    for (const [k, v] of Object.entries(metrics)) {
      if (k === 'restingHr') cur[k] ??= v;
      else cur[k] = cur[k] === undefined ? v : Math.max(cur[k], v);
    }
    into.set(day, cur);
  };
  const walk = (node, depth) => {
    if (++nodes > MAX_JSON_NODES || depth > 7 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    const m = lowerKeys(node);
    let day = null;
    for (const k of DATE_KEYS) {
      if (m.has(k)) {
        day = toDay(m.get(k));
        if (day) break;
      }
    }
    if (!day) {
      for (const k of TIME_KEYS) {
        if (m.has(k)) {
          day = toDay(m.get(k));
          if (day) break;
        }
      }
    }
    if (day) add(day, metricsOf(m));
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  walk(json, 0);
  return into;
}

const shortName = (s) => String(s).slice(-80);

/**
 * Parse a Garmin data-export zip (Blob/File/ArrayBuffer). Returns
 * { days:[daily drafts], errors:[{file,message}], errorsTotal, truncated, stats }.
 */
export async function parseZip(input, { onProgress, depth = 0, shared } = {}) {
  const st = shared ?? { entries: 0, filesRead: 0, filesSkipped: 0, nestedZips: 0, fallbackInflate: 0, bytesRead: 0, daily: new Map(), errors: [], errorsTotal: 0, truncated: false };
  const addError = (file, message) => {
    st.errorsTotal++;
    if (st.errors.length < LIMITS.errorsReported) st.errors.push({ file: shortName(file), message });
  };
  let entries;
  try {
    entries = await listEntries(input);
  } catch (e) {
    if (depth === 0) throw e;
    addError('nested zip', e.message);
    return finish(st, depth);
  }
  st.entries += entries.length;
  let done = 0;
  for (const entry of entries) {
    done++;
    if (onProgress) onProgress({ done, total: entries.length, name: shortName(entry.name) });
    if (entry.isDir) continue;
    const lower = entry.name.toLowerCase();
    try {
      if (lower.endsWith('.zip')) {
        if (SKIPPED_ZIP.test(lower) || depth >= MAX_NESTED_DEPTH) {
          st.filesSkipped++;
          continue;
        }
        st.nestedZips++;
        if (st.bytesRead + entry.usize > LIMITS.zipTotalBytes) {
          st.truncated = true;
          addError(entry.name, 'Skipped: the export is bigger than this app will read.');
          continue;
        }
        const nested = entry.method === 0 ? await storedEntryBlob(input, entry) : new Blob([await readEntry(input, entry, { stats: st })]);
        st.bytesRead += entry.usize;
        await parseZip(nested, { onProgress, depth: depth + 1, shared: st });
        continue;
      }
      if (!lower.endsWith('.json') || !WANTED.test(lower)) {
        st.filesSkipped++;
        continue;
      }
      if (st.bytesRead + entry.usize > LIMITS.zipTotalBytes) {
        st.truncated = true;
        addError(entry.name, 'Skipped: the export is bigger than this app will read.');
        continue;
      }
      const bytes = await readEntry(input, entry, { stats: st });
      st.bytesRead += bytes.length;
      let json;
      try {
        json = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      } catch {
        addError(entry.name, 'Not valid JSON; skipped.');
        continue;
      }
      st.filesRead++;
      extractDaily(json, st.daily);
    } catch (e) {
      addError(entry.name, e instanceof DataError ? e.message : 'Could not be read; skipped.');
    }
  }
  return finish(st, depth);
}

function finish(st, depth) {
  if (depth > 0) return null;
  const days = [...st.daily.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, m]) => ({
      date,
      steps: m.steps ?? null,
      sleepMinutes: m.sleepMinutes ?? null,
      restingHr: m.restingHr ?? null,
      activeMinutes: m.activeMinutes ?? null,
      source: 'import',
    }));
  return {
    days,
    errors: st.errors,
    errorsTotal: st.errorsTotal,
    truncated: st.truncated,
    stats: {
      entries: st.entries,
      filesRead: st.filesRead,
      filesSkipped: st.filesSkipped,
      nestedZips: st.nestedZips,
      fallbackInflate: st.fallbackInflate,
      daysFound: days.length,
      from: days.length ? days[0].date : null,
      to: days.length ? days[days.length - 1].date : null,
    },
    notStored: 'GPS routes, activity files, device serials, account ids, names and e-mail addresses are never read into the app.',
  };
}

export function createGarminExport(store) {
  return {
    parse: parseZip,
    /** File/Blob -> parseZip() result (a clear error if it is not a zip). */
    async parseFile(file, opts) {
      if (!file || typeof file.size !== 'number') throw new DataError('bad_format', 'Pick the .zip file you downloaded from your account export.');
      const res = await parseZip(toBlob(file), opts);
      if (!res.days.length && res.stats.filesRead === 0) {
        res.errors.unshift({ file: '', message: 'No daily summaries or sleep files were found. Was this the full data export (not a single activity)?' });
        res.errorsTotal++;
      }
      return res;
    },
    preview(res) {
      const have = store._internal.cache('daily');
      let fresh = 0;
      let existing = 0;
      for (const d of res.days) (have.has(d.date) ? existing++ : fresh++);
      return { new: fresh, existing };
    },
    /** Merge into the store's daily rows: imported numbers fill or update their own fields, notes and other fields stay. */
    async commit(res) {
      const I = store._internal;
      const drafts = res.days.map((d) => {
        const ex = I.cache('daily').get(d.date);
        return {
          id: d.date,
          date: d.date,
          steps: d.steps ?? ex?.steps ?? null,
          sleepMinutes: d.sleepMinutes ?? ex?.sleepMinutes ?? null,
          restingHr: d.restingHr ?? ex?.restingHr ?? null,
          activeMinutes: d.activeMinutes ?? ex?.activeMinutes ?? null,
          note: ex?.note ?? '',
          source: ex?.source === 'user' ? 'user' : 'import',
        };
      });
      const p = this.preview(res);
      if (drafts.length) await store.putMany('daily', drafts);
      return { added: p.new, updated: p.existing, total: drafts.length };
    },
  };
}
