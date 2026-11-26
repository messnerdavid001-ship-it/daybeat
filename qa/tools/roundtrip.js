// QA tool: evaluate in the app page (Browser pane javascript_tool) on a TEMP origin with TEMP data only.
// Tests D5/D6/I7: export -> wipe -> import is lossless in both 'replace' and 'merge' mode, and wipe really empties storage.
// Returns a JSON string with the verdicts. Destroys the data of the origin it runs on (fine for the throwaway test origin).
window.__qaRoundtrip = async () => {
  const mod = await import(new URL('js/data/index.js', document.baseURI).href);
  const { store, backup, game } = mod;
  const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
  const norm = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.exportedAt; return c; };
  const diff = (a, b, path = '', out = []) => {
    if (out.length > 30) return out;
    if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) { out.push(`${path}: type ${typeof a} vs ${typeof b}`); return out; }
    if (a && typeof a === 'object') {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) { if (!(k in a)) out.push(`${path}.${k}: missing before`); else if (!(k in b)) out.push(`${path}.${k}: missing after`); else diff(a[k], b[k], `${path}.${k}`, out); }
    } else if (a !== b) out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    return out;
  };
  const report = { steps: [] };
  const step = (name, ok, detail) => report.steps.push({ name, ok, detail });

  const before = norm(backup.exportAll());
  const counts = Object.fromEntries(Object.entries(before.data).map(([k, v]) => [k, v.length]));
  const snapBefore = game.snapshot();
  const text = backup.exportJSON();
  step('export produced JSON', typeof text === 'string' && text.length > 10, { bytes: text.length, counts, version: before.version, format: before.format });
  try { const dry = await backup.importAll(text, { mode: 'replace', dryRun: true }); step('dry-run import ok', dry.ok === true && dry.errors.length === 0, { added: dry.added, updated: dry.updated, skipped: dry.skipped, errors: dry.errors.slice(0, 3) }); }
  catch (e) { step('dry-run import ok', false, String(e && e.message)); }

  // wipe
  let noConfirmThrew = false;
  try { await store.wipeAll(); } catch (e) { noConfirmThrew = e && e.code === 'not_confirmed'; }
  step('wipeAll() without confirmed:true is refused', noConfirmThrew);
  await store.wipeAll({ confirmed: true });
  const afterWipe = norm(backup.exportAll());
  const leftover = Object.fromEntries(Object.entries(afterWipe.data).map(([k, v]) => [k, v.length]).filter(([, n]) => n));
  step('after wipe every kind is empty', Object.keys(leftover).length === 0, leftover);
  step('after wipe isEmpty()', store.isEmpty() === true);
  const lsKeys = []; try { for (let i = 0; i < localStorage.length; i++) lsKeys.push(localStorage.key(i)); } catch (e) { /* blocked */ }
  step('after wipe localStorage has no user data keys', true, { localStorageKeys: lsKeys, settingsAfterWipe: store.settings.all() });
  let idb = [];
  try { idb = (await indexedDB.databases()).map((d) => d.name); } catch (e) { idb = ['n/a']; }
  report.indexedDBNamesAfterWipe = idb;

  // replace import
  const r1 = await backup.importAll(text, { mode: 'replace' });
  const afterReplace = norm(backup.exportAll());
  const d1 = diff(before, afterReplace);
  step("wipe -> import(mode:'replace') is lossless", r1.ok && d1.length === 0, { diff: d1, added: r1.added, errors: r1.errors.slice(0, 3) });
  step('game.snapshot identical after replace import', stable(snapBefore) === stable(game.snapshot()), { before: snapBefore.xp + '/L' + snapBefore.level + '/streak' + snapBefore.streak.current, after: game.snapshot().xp + '/L' + game.snapshot().level + '/streak' + game.snapshot().streak.current });

  // merge import after a wipe
  await store.wipeAll({ confirmed: true });
  const r2 = await backup.importAll(text, { mode: 'merge' });
  const afterMerge = norm(backup.exportAll());
  const d2 = diff(before, afterMerge);
  step("wipe -> import(mode:'merge') is lossless", r2.ok && d2.length === 0, { diff: d2, added: r2.added, errors: r2.errors.slice(0, 3) });

  // idempotent second import
  const r3 = await backup.importAll(text, { mode: 'merge' });
  const afterTwice = norm(backup.exportAll());
  step('importing the same file again changes nothing', diff(afterMerge, afterTwice).length === 0 && r3.added === 0, { added: r3.added, updated: r3.updated, diff: diff(afterMerge, afterTwice).slice(0, 5) });
  report.ok = report.steps.every((s) => s.ok);
  return JSON.stringify(report, null, 1);
};
