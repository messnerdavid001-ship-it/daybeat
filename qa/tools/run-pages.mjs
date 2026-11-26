#!/usr/bin/env node
// QA scenario: visit every page in several viewports/themes in a throw-away Chrome, run qa/tools/dom-audit.js,
// collect console errors and network failures, save screenshots.
//   node qa/tools/run-pages.mjs --url http://127.0.0.1:PORT/qa-sub/ --shots <dir> [--routes today,calendar] [--sizes 375x812,320x568,1280x800] [--themes dark,light] [--empty]
// --empty wipes the data first (via the data layer) so the empty states are audited instead of the demo data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sleep } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const base = opt('url');
if (!base) { console.error('usage: --url <base> --shots <dir>'); process.exit(2); }
const shots = opt('shots', null);
if (shots) fs.mkdirSync(shots, { recursive: true });
const routes = opt('routes', 'today,calendar,alarms,messages,quests,insights,settings').split(',');
const sizes = opt('sizes', '375x812,320x568,1280x800').split(',').map((s) => s.split('x').map(Number));
const themes = opt('themes', 'dark,light').split(',');
const empty = args.includes('--empty');
const audit = fs.readFileSync(path.join(here, 'dom-audit.js'), 'utf8');

const chrome = await launchChrome();
let totalFail = 0;
try {
  for (const [w, h] of sizes) for (const theme of themes) {
    const page = await chrome.page({ width: w, height: h, mobile: w < 700, colorScheme: theme });
    await page.goto(base + '#/today');
    await page.waitFor(`!!document.querySelector('h1')`, { timeout: 10000 }).catch(() => {});
    if (empty) {
      await page.eval(`(async () => { const m = await import(new URL('js/data/index.js', document.baseURI).href); await m.store.wipeAll({confirmed:true}); })()`).catch((e) => console.log('wipe failed', e.message));
    }
    // dismiss the one-off notices so they do not hide content in screenshots (they are audited separately)
    await page.eval(audit);
    for (const r of routes) {
      await page.eval(`location.hash = '#/${r}'`);
      await sleep(1400); // page-in animation
      const rep = JSON.parse(await page.eval('window.__qaDomAudit()'));
      const fails = rep.issues.filter((i) => i.level === 'FAIL');
      const warns = rep.issues.filter((i) => i.level === 'WARN' && i.id !== 'C1');
      totalFail += fails.length;
      const tag = `${w}x${h}/${theme}/${r}${empty ? '/empty' : ''}`;
      console.log(`${fails.length ? 'FAIL' : 'ok  '} ${tag}  h1=${JSON.stringify(rep.facts.h1)} title=${JSON.stringify(rep.facts.title)} fails=${fails.length} warns=${warns.length}`);
      for (const f of fails) console.log(`       FAIL ${f.id} ${f.msg} @ ${f.el || ''}`);
      const seen = new Set();
      for (const f of warns) { const k = f.id + f.msg.replace(/\d+x\d+/, 'WxH'); if (seen.has(k)) continue; seen.add(k); console.log(`       warn ${f.id} ${f.msg} @ ${f.el || ''}`); }
      if (shots) await page.screenshot(path.join(shots, `${w}x${h}-${theme}-${r}${empty ? '-empty' : ''}.png`), { fullPage: true });
    }
    const errs = page.console.filter((c) => ['error', 'warning', 'warn'].includes(c.type));
    const bad = [...page.requests.values()].filter((r) => r.status >= 400);
    const ext = [...page.requests.values()].filter((r) => !r.url.startsWith(new URL(base).origin) && !/^(data|blob):/.test(r.url));
    console.log(`  console problems: ${errs.length} ${JSON.stringify(errs).slice(0, 300)}  exceptions: ${JSON.stringify(page.exceptions).slice(0, 300)}  http>=400: ${JSON.stringify(bad).slice(0, 300)}  external: ${JSON.stringify(ext.map((e) => e.url))}`);
    await page.send('Target.closeTarget', { targetId: page.id }).catch(() => {});
  }
} finally {
  await chrome.close();
}
console.log(`\ntotal audit FAILs: ${totalFail}`);
process.exit(totalFail ? 1 : 0);
