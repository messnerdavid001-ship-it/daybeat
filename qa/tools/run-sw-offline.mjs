#!/usr/bin/env node
// QA scenario: install -> service worker -> offline, under a GitHub-Pages-like sub-path, in a throw-away Chrome profile.
//   node qa/tools/run-sw-offline.mjs [--prefix /qa-sub/] [--shots <dir>]
// Starts qa/tools/pages-sim.mjs itself (realistic max-age=600 headers) and kills it afterwards.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchChrome, sleep } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const prefix = opt('prefix', '/qa-sub/');
const shots = opt('shots', null);
if (shots) fs.mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

let sim = null;
async function startSim(port = 0) {
  sim = spawn('node', [path.join(here, 'pages-sim.mjs'), '--root', root, '--prefix', prefix, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  const line = await new Promise((res) => sim.stdout.once('data', (d) => res(String(d))));
  return JSON.parse(line);
}
const stopSim = async () => { if (sim) { sim.kill('SIGTERM'); await sleep(300); sim = null; } };

const info = await startSim();
const base = info.url;
const chrome = await launchChrome();
try {
  const page = await chrome.page({ width: 375, height: 812, mobile: true });
  const nav = await page.goto(base);
  check('first load works', !nav.error, nav.error || '');
  await page.waitFor(`document.querySelector('h1') && document.title.length > 0`, { timeout: 10000 }).catch(() => {});
  console.log('title:', await page.eval('document.title'), ' hash:', await page.eval('location.hash'));
  // service worker installs
  let sw = null;
  for (let i = 0; i < 60; i++) { sw = await page.fetchSWState(); if (sw.active === 'activated' && Object.keys(sw.cache).length) break; await sleep(250); }
  check('service worker registered with sub-path scope', !!sw.scope && sw.scope === base, sw.scope);
  check('service worker script is at the sub-path root', sw.script === base + 'sw.js', sw.script);
  check('service worker activated', sw.active === 'activated');
  const cacheName = Object.keys(sw.cache)[0];
  const cached = cacheName ? sw.cache[cacheName] : [];
  check('precache filled', cached.length > 20, `${cached.length} files in ${cacheName}`);
  check('only one app cache exists', Object.keys(sw.cache).length === 1, Object.keys(sw.cache).join(','));
  check('no cache entries outside the sub-path', cached.every((p) => p.startsWith(prefix)), cached.filter((p) => !p.startsWith(prefix)).join(','));

  // which files does the app really load vs what is precached?
  const loaded = [...new Set([...page.requests.values()].map((r) => new URL(r.url).pathname).filter((p) => p.startsWith(prefix)))];
  const missing = loaded.filter((p) => !cached.includes(p) && p !== prefix && !p.endsWith('/sw.js') && !p.includes('/__qa/'));
  check('every file the first page load requested is in the precache', missing.length === 0, missing.join(', '));
  check('no 4xx/5xx during first load', [...page.requests.values()].every((r) => !r.status || r.status < 400), JSON.stringify([...page.requests.values()].filter((r) => r.status >= 400)));
  check('no console errors/warnings on first load', page.console.filter((c) => ['error', 'warning', 'warn'].includes(c.type)).length === 0 && page.exceptions.length === 0, JSON.stringify(page.console.filter((c) => ['error', 'warning', 'warn'].includes(c.type)).concat(page.exceptions)).slice(0, 400));
  const external = [...page.requests.values()].filter((r) => !r.url.startsWith(info.url.replace(/qa-sub\/$/, '')) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
  check('no third-party requests on first load', external.length === 0, external.map((e) => e.url).join(', '));

  // reload so the page is controlled, then go offline for real (stop the server)
  await page.reload();
  await sleep(500);
  sw = await page.fetchSWState();
  check('page controlled by the worker after reload', sw.controlled === true);
  const routes = ['today', 'tasks', 'calendar', 'alarms', 'garmin', 'messages', 'quests', 'insights', 'settings'];
  // visit every route online once so lazily imported modules are exercised
  for (const r of routes) { await page.eval(`location.hash = '#/${r}'`); await sleep(500); }

  await stopSim();
  const off = await page.goto(base + '#/today');
  check('offline: navigation to the app root works', !off.error, off.error || '');
  await sleep(800);
  for (const r of routes) {
    await page.goto(base + `#/${r}`);
    await page.reload();
    await sleep(700);
    const t = await page.eval(`JSON.stringify({ h1: document.querySelector('h1')?.textContent || null, title: document.title, err: !!document.querySelector('.empty h1') && /did not load/i.test(document.querySelector('.empty h1').textContent), tabs: document.querySelectorAll('.tab').length })`);
    const o = JSON.parse(t);
    check(`offline: #/${r} renders (h1 "${o.h1}")`, !!o.h1 && !o.err && o.tabs >= 5, t);
    if (shots) await page.screenshot(path.join(shots, `offline-${r}.png`));
  }
  const dl = await page.eval(`(async () => { try { const r = await fetch('${base}'); return r.status; } catch (e) { return 'fetch failed: ' + e.message; } })()`);
  check('offline: fetch of the root is answered by the worker', dl === 200, String(dl));
  const unknown = await page.goto(base + 'does-not-exist');
  await sleep(500);
  const unk = await page.eval(`document.title + ' | ' + (document.querySelector('h1')?.textContent || '')`);
  console.log('offline unknown path ->', unk, unknown.error || '');
  const idx = await page.goto(base + 'index.html#/alarms');
  await sleep(700);
  check('offline: /index.html deep link works', !idx.error && (await page.eval(`document.title`)).includes('Alarms'), await page.eval('document.title'));
  const data = await page.eval(`(async () => { const m = await import(new URL('js/data/index.js', document.baseURI).href); return { backend: m.store.info?.backend ?? null, n: m.store.counts() }; })()`).catch((e) => ({ error: e.message }));
  console.log('offline data layer:', JSON.stringify(data));
  const errs = page.console.filter((c) => ['error'].includes(c.type));
  console.log('console errors while offline:', JSON.stringify(errs).slice(0, 600));
} finally {
  await chrome.close();
  await stopSim();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
