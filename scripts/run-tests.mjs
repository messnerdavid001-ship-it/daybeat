#!/usr/bin/env node
// Runs the whole Node test suite under several time zones (date bugs hide in zone changes).
//   node scripts/run-tests.mjs                 refresh sw-manifest.js, then all zones
//   node scripts/run-tests.mjs --release       NO refresh (a stale manifest fails), all zones, plus the privacy scan
//   node scripts/run-tests.mjs --quick         one zone (the machine's own)
//   node scripts/run-tests.mjs --zones UTC,Asia/Kolkata
// Browser tests (real IndexedDB): start scripts/dev-server.mjs and open /tests/browser/index.html.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from './build-sw-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const release = args.includes('--release');
const quick = args.includes('--quick');
const zi = args.indexOf('--zones');
const ZONES = zi >= 0 ? args[zi + 1].split(',') : ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Australia/Lord_Howe', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Sao_Paulo'];

if (!release) {
  const m = buildManifest(ROOT);
  const file = path.join(ROOT, 'sw-manifest.js');
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== m.text) {
    fs.writeFileSync(file, m.text);
    console.log(`sw-manifest.js refreshed (version ${m.version})`);
  }
}

const zones = quick ? [undefined] : ZONES;
let failed = 0;
for (const tz of zones) {
  const env = { ...process.env };
  if (tz) env.TZ = tz;
  const r = spawnSync(process.execPath, ['--test', 'tests/*.test.mjs'], { cwd: ROOT, env, encoding: 'utf8' });
  const out = `${r.stdout}\n${r.stderr}`;
  const pass = /ℹ pass (\d+)/.exec(out)?.[1] ?? '?';
  const fail = /ℹ fail (\d+)/.exec(out)?.[1] ?? '?';
  console.log(`${r.status === 0 ? 'PASS' : 'FAIL'}  TZ=${tz ?? '(machine)'}  pass ${pass}  fail ${fail}`);
  if (r.status !== 0) {
    failed++;
    console.log(out.split('\n').filter((l) => /✖|Error|actual|expected|at .*tests/.test(l)).slice(0, 25).join('\n'));
  }
}

if (release) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'privacy-scan.mjs'), '--git'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} run(s) FAILED` : '\nAll runs passed.');
process.exit(failed ? 1 : 0);
