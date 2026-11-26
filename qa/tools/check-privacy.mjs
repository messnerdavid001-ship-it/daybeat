#!/usr/bin/env node
// QA tool: independent privacy scan. Read-only (git commands used: log, ls-files, config --get, rev-list, grep-style scans of `git log -p`).
//   node qa/tools/check-privacy.mjs [projectRoot] [--extra-term word ...]
// The scan builds its list of "personal terms" at RUN TIME from the machine (OS user name, home directory,
// git user.name / user.email) so that this script itself never contains anything personal.
// Output: FAIL / WARN / REVIEW / PASS / INFO lines. Exit 1 if any FAIL.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const extraTerms = [];
let rootArg = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--extra-term') extraTerms.push(argv[++i]);
  else if (!rootArg) rootArg = argv[i];
}
const root = path.resolve(rootArg || process.cwd());
const out = [];
const add = (level, id, msg) => out.push({ level, id, msg });

function git(...a) {
  try { return execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
}

// ---------- personal terms from the machine ----------
const terms = new Set(extraTerms.map((t) => t.toLowerCase()));
const osUser = os.userInfo().username;
if (osUser && osUser.length >= 4) terms.add(osUser.toLowerCase());
const gitName = (git('config', '--get', 'user.name') || '').trim();
const gitEmail = (git('config', '--get', 'user.email') || '').trim();
// name fragments (>= 5 letters) from the OS user name, e.g. a surname glued to a first name
for (const frag of osUser.toLowerCase().match(/[a-z]{5,}/g) || []) terms.add(frag);
for (const t of [...terms]) if (/^(user|admin|root|guest|test|local|runner)$/.test(t)) terms.delete(t);
const homeDir = os.homedir();

const isNoreply = (e) => /@users\.noreply\.github\.com$/i.test(e);
if (gitEmail) add(isNoreply(gitEmail) ? 'PASS' : 'FAIL', 'I3', `git user.email is ${isNoreply(gitEmail) ? 'a GitHub noreply address' : 'NOT a noreply address'}`);
else add('WARN', 'I3', 'git user.email is not set in this repo');

// ---------- walk ----------
const SKIP = new Set(['.git', 'node_modules']);
const files = [];
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    if (SKIP.has(n)) continue;
    const f = path.join(d, n);
    const st = fs.lstatSync(f);
    if (st.isDirectory()) walk(f); else files.push(f);
  }
})(root);
const rel = (f) => path.relative(root, f).split(path.sep).join('/');

const patterns = [
  ['email', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (m) => !/(@users\.noreply\.github\.com|@example\.(com|org|net|invalid|test)|@localhost)$/i.test(m) && !/^[\w.-]+@(\d+\.)+\d+$/.test(m)],
  ['phone', /(?<![\d.])(?:\+?1[ .-]?)?\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g, (m) => !/555[ .-]\d{4}/.test(m)],
  ['intl phone', /(?<![\w.])\+\d{1,3}[ .-]?\d{2,4}[ .-]?\d{3,4}[ .-]?\d{3,4}\b/g, (m) => !/555/.test(m)],
  ['home path', /(?:\/Users\/|\/home\/|C:\\Users\\)[A-Za-z0-9._-]+/g, (m) => !/(\/home\/runner|\/Users\/example|\/Users\/you|\/Users\/me|\/Users\/name|\/Users\/user)/i.test(m)],
  ['GPS pair', /-?\b\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}\b/g, () => true],
  ['API key / token', /\b(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})\b/g, () => true],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY/g, () => true],
  ['password assignment', /\b(password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*["'][^"']{6,}["']/gi, () => true],
  ['public IPv4', /\b(?!127\.|0\.|10\.|192\.168\.|255\.|169\.254\.)(?:\d{1,3}\.){3}\d{1,3}\b/g, (m) => m.split('.').every((n) => Number(n) <= 255) && !/^0\./.test(m)],
  ['MAC address', /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, () => true],
  ['Garmin unit / device id', /\b(?:unit ?id|device ?id|serial(?: ?number)?)\b\s*[:=]\s*["']?[\w-]{6,}/gi, () => true],
  ['street address', /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Court|Ct)\b/g, () => true],
];

const binExt = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|gz|pdf)$/i;
let found = 0;
const scanText = (label, text) => {
  const lower = text.toLowerCase();
  for (const t of terms) {
    let i = lower.indexOf(t);
    while (i >= 0) {
      found++;
      add('FAIL', 'I1', `${label}: personal term "${t[0]}${'*'.repeat(t.length - 1)}" (len ${t.length}) at offset ${i}`);
      i = lower.indexOf(t, i + t.length);
      if (found > 200) return;
    }
  }
  if (homeDir && text.includes(homeDir)) { found++; add('FAIL', 'I1', `${label}: contains this machine's home directory path`); }
  if (gitName && gitName.length >= 5 && text.includes(gitName)) { found++; add('REVIEW', 'I3', `${label}: contains the git user.name (a public GitHub handle is usually fine; confirm it is not a real name)`); }
  for (const [name, re, keep] of patterns) {
    for (const m of text.matchAll(re)) {
      if (!keep(m[0])) continue;
      const line = text.slice(0, m.index).split('\n').length;
      found++;
      add(name === 'public IPv4' ? 'REVIEW' : 'FAIL', 'I1', `${label}:${line} ${name}: ${m[0].slice(0, 60)}`);
    }
  }
};

for (const f of files) {
  if (binExt.test(f)) continue;
  let t;
  try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (t.length > 20 * 1024 * 1024) { add('WARN', 'I1', `${rel(f)} is huge (${t.length} bytes); skipped text scan`); continue; }
  if (rel(f).startsWith('qa/tools/check-privacy.mjs')) continue; // contains the patterns themselves
  scanText(rel(f), t);
}
if (!found) add('PASS', 'I1', `no personal terms, emails, phones, paths, coordinates, keys or addresses in ${files.length} working-tree files`);

// ---------- binary images: metadata ----------
for (const f of files) {
  if (!/\.(png|jpe?g|webp)$/i.test(f)) continue;
  const b = fs.readFileSync(f);
  if (/\.png$/i.test(f)) {
    let off = 8; const chunks = [];
    while (off + 8 <= b.length) { const len = b.readUInt32BE(off); const type = b.toString('latin1', off + 4, off + 8); chunks.push([type, off + 8, len]); off += 12 + len; if (type === 'IEND') break; }
    for (const [type, start, len] of chunks) {
      if (['eXIf', 'tEXt', 'iTXt', 'zTXt'].includes(type)) {
        const preview = b.toString('latin1', start, Math.min(start + len, start + 80)).replace(/[^\x20-\x7e]/g, '.');
        add('WARN', 'I10', `${rel(f)} has ${type} chunk: "${preview}"`);
        scanText(rel(f) + `#${type}`, b.toString('latin1', start, start + len));
      }
    }
  } else {
    if (b.includes(Buffer.from('Exif'))) add('WARN', 'I10', `${rel(f)} contains EXIF data (may include GPS/camera/author). Strip it.`);
  }
}
add('INFO', 'I10', 'image metadata scanned for png/jpg/webp');

// ---------- tracked files and .gitignore guard ----------
const tracked = git('ls-files');
if (tracked === null) add('INFO', 'I3', 'not a git repo or git unavailable; history checks skipped');
else {
  const list = tracked.split('\n').filter(Boolean);
  add('INFO', 'I9', `git tracks ${list.length} files`);
  for (const f of list) {
    if (/\.(ics|fit|gpx|tcx|zip|env|pem|key|sqlite|db)$/i.test(f) && !f.startsWith('tests/fixtures/')) add('FAIL', 'I9', `tracked data-like file: ${f}`);
    if (/(^|\/)(\.env|\.DS_Store|id_rsa|credentials)/.test(f)) add('FAIL', 'I9', `tracked sensitive/junk file: ${f}`);
  }
  const gi = fs.existsSync(path.join(root, '.gitignore')) ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8') : '';
  for (const need of ['*.ics', '.env', '*.fit', 'node_modules']) add(gi.includes(need) ? 'PASS' : 'WARN', 'I9', `.gitignore guards ${need}`);

  // history: authors, committers, messages, added lines
  const authors = git('log', '--all', '--format=%an <%ae>|%cn <%ce>');
  if (authors !== null && authors.trim()) {
    const uniq = new Set(authors.split('\n').filter(Boolean).flatMap((l) => l.split('|')));
    for (const a of uniq) {
      const email = (a.match(/<([^>]*)>/) || [])[1] || '';
      add(isNoreply(email) || /noreply@(anthropic|github)\.com$/i.test(email) ? 'PASS' : 'FAIL', 'I3', `history identity: ${a.replace(/<[^>]*>/, '<' + (isNoreply(email) ? 'noreply' : '***') + '>')}`);
    }
    const hist = git('log', '--all', '-p', '--no-color', '--format=COMMIT %H%n%B') || '';
    const added = hist.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
    let hf = 0;
    const lower = added.toLowerCase();
    for (const t of terms) if (lower.includes(t)) { hf++; add('FAIL', 'I3', `git history contains personal term "${t[0]}${'*'.repeat(t.length - 1)}" in added lines or messages (rewriting history is the lead's call)`); }
    for (const [name, re, keep] of patterns) {
      if (name === 'public IPv4') continue;
      for (const m of added.matchAll(re)) if (keep(m[0])) { hf++; add('FAIL', 'I3', `git history (added lines): ${name}: ${m[0].slice(0, 50)}`); }
    }
    const names = git('log', '--all', '--name-only', '--format=') || '';
    for (const n of new Set(names.split('\n').filter(Boolean))) if (/\.(ics|fit|zip|env|pem)$/i.test(n) && !n.startsWith('tests/fixtures/')) { hf++; add('FAIL', 'I3', `history once contained ${n}`); }
    if (!hf) add('PASS', 'I3', 'git history: no personal terms or secrets in any commit');
  } else add('INFO', 'I3', 'no commits yet (history check will run once there are some)');
}

const order = { FAIL: 0, WARN: 1, REVIEW: 2, INFO: 3, PASS: 4 };
out.sort((a, b) => order[a.level] - order[b.level]);
const seen = new Set();
for (const r of out) { const k = r.level + r.id + r.msg; if (seen.has(k)) continue; seen.add(k); console.log(`${r.level.padEnd(6)} ${r.id.padEnd(6)} ${r.msg}`); }
const c = (l) => out.filter((r) => r.level === l).length;
console.log(`\nSUMMARY  FAIL ${c('FAIL')}  WARN ${c('WARN')}  REVIEW ${c('REVIEW')}  PASS ${c('PASS')}  (root: ${path.basename(root)})`);
process.exit(c('FAIL') ? 1 : 0);
