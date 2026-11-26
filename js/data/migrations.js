// Data migrations. Each entry upgrades the whole data bundle from version `from` to `to`.
// bundle = { kinds: { kind: record[] }, settings: { key: value } }; run() must return a bundle (it may mutate a copy).
// Before the store runs any migration it takes a safety snapshot (see store.js), and the result is written in ONE
// atomic transaction together with the new schemaVersion, so a crash cannot leave half-migrated data.
//
// Version 1 is the first release, so there is nothing to migrate yet. To add version 2:
//   { from: 1, to: 2, run(bundle) { ...; return bundle; } }
// and bump SCHEMA_VERSION in schema.js. Backups of older versions go through the same chain (backup.js).

import { DataError } from './schema.js';

export const MIGRATIONS = [
  // v1 -> v2: adds the 'task' kind (to-dos). Nothing to convert; existing records are untouched.
  { from: 1, to: 2, run(bundle) { bundle.kinds.task = bundle.kinds.task ?? []; return bundle; } },
];

export function migrateBundle(bundle, from, to, migrations = MIGRATIONS) {
  let v = from;
  let b = bundle;
  while (v < to) {
    const step = migrations.find((m) => m.from === v);
    if (!step) throw new DataError('unsupported_version', `No upgrade path from data version ${v} to ${to}.`);
    b = step.run(b);
    v = step.to;
  }
  return b;
}
