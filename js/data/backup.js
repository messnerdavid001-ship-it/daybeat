// Backup export / restore. One JSON file, produced and parsed locally. Nothing is ever uploaded.
// Import validates EVERYTHING first (whitelisted fields only), then applies in ONE atomic transaction
// after storing a safety snapshot that backup.undoLastImport() can restore.

import { KINDS, SCHEMA_VERSION, BACKUP_FORMAT, LIMITS, DataError, prepareLoose, tryCheckSetting, prepare } from './schema.js';
import { migrateBundle } from './migrations.js';
import { dayKey } from './dates.js';

const utf8Bytes = (s) => new TextEncoder().encode(s).length;

function tooLarge() {
  return new DataError(
    'too_large',
    `This file is larger than ${Math.round(LIMITS.backupBytes / 1048576)} MB, which is more than a backup of this app should ever be. Pick the file that was exported by this app.`,
  );
}

export function createBackup(store) {
  const I = store._internal;

  function exportAll({ includeDemo = true } = {}) {
    const data = {};
    const counts = {};
    for (const kind of KINDS) {
      const rows = [...I.cache(kind).values()].filter((r) => includeDemo || r.source !== 'demo');
      rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      data[kind] = rows;
      counts[kind] = rows.length;
    }
    const out = {
      format: BACKUP_FORMAT,
      version: SCHEMA_VERSION,
      exportedAt: I.nowIso(),
      counts,
      settings: { ...store.settings.all() },
      data,
    };
    return structuredClone(out);
  }

  function exportJSON(opts) {
    return JSON.stringify(exportAll(opts), null, 1);
  }

  /** Record "last backup" = now. Call it after the share sheet / download / copy actually happened. */
  async function markBackedUp() {
    try {
      await store.settings.set('lastBackupAt', I.nowIso());
      return true;
    } catch {
      return false; // read-only store
    }
  }

  /**
   * Build the backup file ({filename, blob, text, bytes}). By default it also stamps settings.lastBackupAt BEFORE building
   * the text; pass { markBackedUp: false } to stamp nothing (then call backup.markBackedUp() once the file really left).
   */
  async function exportFile(opts = {}) {
    if (opts.markBackedUp !== false) await markBackedUp();
    const text = exportJSON(opts);
    const filename = `daybeat-backup-${dayKey(I.now())}.json`;
    const blob = new Blob([text], { type: 'application/json' });
    return { filename, blob, text, bytes: utf8Bytes(text) };
  }

  /** Parse + validate a backup. Pure with respect to the store except for reading existing ids. */
  async function parse(input, { strict = false } = {}) {
    let obj = input;
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      if (input.size > LIMITS.backupBytes) throw tooLarge();
      obj = await input.text();
    }
    if (typeof obj === 'string') {
      if (obj.length > LIMITS.backupBytes) throw tooLarge();
      if (obj.length * 3 > LIMITS.backupBytes && utf8Bytes(obj) > LIMITS.backupBytes) throw tooLarge();
      try {
        obj = JSON.parse(obj.charCodeAt(0) === 0xfeff ? obj.slice(1) : obj);
      } catch {
        throw new DataError('bad_format', 'This file is not a backup from this app (it is not valid JSON).');
      }
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj) || obj.format !== BACKUP_FORMAT) {
      throw new DataError('bad_format', 'This file is not a backup from this app.');
    }
    const version = obj.version;
    if (!Number.isInteger(version) || version < 1) throw new DataError('bad_format', 'This backup has no valid version number.');
    if (version > SCHEMA_VERSION) {
      throw new DataError('unsupported_version', 'This backup was made by a newer version of the app. Update the app, then try again.');
    }
    const rawData = obj.data;
    if (rawData === null || typeof rawData !== 'object' || Array.isArray(rawData)) {
      throw new DataError('bad_format', 'This backup has no data section.');
    }
    const rawSettings = obj.settings && typeof obj.settings === 'object' && !Array.isArray(obj.settings) ? obj.settings : {};

    let bundle = { kinds: {}, settings: Object.create(null) }; // null prototype: a '__proto__' key stays plain data
    for (const k of KINDS) {
      const arr = Object.prototype.hasOwnProperty.call(rawData, k) ? rawData[k] : [];
      if (!Array.isArray(arr)) throw new DataError('bad_format', `The "${k}" section of this backup is not a list.`);
      if (arr.length > LIMITS.recordsPerKind) throw tooLarge();
      bundle.kinds[k] = arr;
    }
    for (const key of Object.keys(rawSettings)) bundle.settings[key] = rawSettings[key];
    if (version < SCHEMA_VERSION) bundle = migrateBundle(bundle, version, SCHEMA_VERSION);

    const errors = [];
    let errorsTotal = 0;
    const addErr = (e) => {
      errorsTotal++;
      if (errors.length < LIMITS.errorsReported) errors.push(e);
    };
    const nowIso = I.nowIso();
    const records = {};
    for (const k of KINDS) {
      const byId = new Map();
      bundle.kinds[k].forEach((raw, index) => {
        const { rec, errs } = prepareLoose(k, raw, { nowIso, keepTimestamps: true, defaultSource: 'user' });
        if (!rec) {
          addErr({ kind: k, index, id: typeof raw?.id === 'string' ? raw.id.slice(0, 40) : '', message: errs[0]?.message ?? 'invalid record' });
          return;
        }
        const dupe = byId.get(rec.id);
        if (!dupe || rec.updatedAt > dupe.updatedAt) byId.set(rec.id, rec);
      });
      records[k] = [...byId.values()];
    }
    const settings = {};
    for (const [key, value] of Object.entries(bundle.settings)) {
      const r = tryCheckSetting(key, value);
      if (r.ok) settings[key] = r.value;
      else addErr({ kind: 'setting', index: -1, id: key.slice(0, 40), message: r.message });
    }
    if (strict && errorsTotal > 0) {
      throw new DataError('invalid', `${errorsTotal} item(s) in this backup are invalid, so nothing was imported.`, errors);
    }
    return { version, exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt.slice(0, 40) : '', records, settings, errors, errorsTotal };
  }

  function plan(parsed, mode) {
    const counts = {};
    const puts = [];
    for (const k of KINDS) {
      const c = { added: 0, updated: 0, skipped: 0 };
      const cur = I.cache(k);
      for (const rec of parsed.records[k]) {
        const ex = mode === 'replace' ? undefined : cur.get(rec.id);
        if (!ex) {
          c.added++;
          puts.push({ kind: k, record: rec });
        } else if (rec.updatedAt > ex.updatedAt) {
          c.updated++;
          puts.push({ kind: k, record: rec });
        } else c.skipped++;
      }
      counts[k] = c;
    }
    const settingSet = {};
    for (const [key, value] of Object.entries(parsed.settings)) {
      if (mode === 'replace' || store.settings.get(key) === undefined) settingSet[key] = value;
    }
    return { counts, puts, settingSet };
  }

  function report(parsed, mode, dryRun, pl, undoAvailable) {
    const sum = (f) => Object.values(pl.counts).reduce((n, c) => n + c[f], 0);
    return {
      ok: true,
      mode,
      dryRun,
      backupVersion: parsed.version,
      exportedAt: parsed.exportedAt,
      added: sum('added'),
      updated: sum('updated'),
      skipped: sum('skipped') + parsed.errorsTotal,
      counts: pl.counts,
      errors: parsed.errors,
      errorsTruncated: parsed.errorsTotal > parsed.errors.length,
      settingsApplied: Object.keys(pl.settingSet).length > 0,
      undoAvailable,
    };
  }

  async function importAll(input, { mode = 'merge', dryRun = false, strict = false } = {}) {
    if (mode !== 'merge' && mode !== 'replace') throw new DataError('invalid', 'mode must be "merge" or "replace"');
    const parsed = await parse(input, { strict });
    if (dryRun) return report(parsed, mode, true, plan(parsed, mode), !!canUndo());
    return I.enqueue(async () => {
      I.assertWritable();
      const pl = plan(parsed, mode);
      const snap = await I.takeSnapshotOp(mode === 'replace' ? 'before restore (replace)' : 'before restore (merge)');
      await I.commitNow({
        clearKinds: mode === 'replace' ? [...KINDS] : [],
        clearSettings: mode === 'replace',
        puts: pl.puts,
        settingSet: pl.settingSet,
        metaPuts: [snap],
        reason: 'import',
        kinds: ['*'],
      });
      return report(parsed, mode, false, pl, true);
    });
  }

  function canUndo() {
    const s = I.metaInfo('snapshot');
    return s && s.takenAt ? { takenAt: s.takenAt, label: s.label } : null;
  }

  async function undoLastImport() {
    return I.enqueue(async () => {
      I.assertWritable();
      const snap = await I.readMeta('snapshot');
      if (!snap || !snap.data) throw new DataError('not_found', 'There is nothing to undo.');
      const nowIso = I.nowIso();
      const puts = [];
      for (const k of KINDS) {
        for (const raw of snap.data.kinds?.[k] ?? []) puts.push({ kind: k, record: prepare(k, raw, { nowIso, keepTimestamps: true }) });
      }
      const settingSet = {};
      for (const [key, value] of Object.entries(snap.data.settings ?? {})) {
        const r = tryCheckSetting(key, value);
        if (r.ok) settingSet[key] = r.value;
      }
      await I.commitNow({ clearKinds: [...KINDS], clearSettings: true, puts, settingSet, metaDels: ['snapshot'], reason: 'import', kinds: ['*'] });
      return { restored: puts.length, takenAt: snap.takenAt };
    });
  }

  return { exportAll, exportJSON, exportFile, markBackedUp, importAll, canUndo, undoLastImport };
}
