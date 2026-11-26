#!/usr/bin/env node
// QA tool: static installability / honesty / safety checks. Read-only.
//   node qa/tools/check-static.mjs [projectRoot]
// Output lines: PASS / FAIL / WARN / REVIEW / INFO <id> message. Exit code 1 if any FAIL.
// FAIL = breaks a hard constraint or an installability requirement. REVIEW = a human must look at the hit.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const results = [];
const add = (level, id, msg) => { results.push({ level, id, msg }); };

// ---------- helpers ----------
const SKIP_DIRS = new Set(['.git', 'node_modules', 'qa', 'docs']); // qa and docs are not shipped code
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) { add('FAIL', 'tree', `symlink in tree: ${path.relative(root, full)}`); continue; }
    if (st.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}
const rel = (f) => path.relative(root, f).split(path.sep).join('/');
const read = (f) => fs.readFileSync(f, 'utf8');
const exists = (r) => fs.existsSync(path.join(root, r));

// exact-case existence (macOS is case-insensitive, GitHub Pages is not)
function existsExactCase(relPath) {
  const parts = relPath.split('/').filter(Boolean);
  let cur = root;
  for (const part of parts) {
    let names;
    try { names = fs.readdirSync(cur); } catch { return false; }
    if (!names.includes(part)) return false;
    cur = path.join(cur, part);
  }
  return true;
}

function pngInfo(file) {
  const b = fs.readFileSync(file);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (b.length < 33 || !b.subarray(0, 8).equals(sig)) return null;
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  const bitDepth = b[24];
  const colorType = b[25];
  const chunks = [];
  let off = 8, hasTRNS = false;
  while (off + 8 <= b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('latin1', off + 4, off + 8);
    chunks.push(type);
    if (type === 'tRNS') hasTRNS = true;
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const hasAlphaChannel = colorType === 4 || colorType === 6;
  return { width, height, bitDepth, colorType, hasAlphaChannel, hasTRNS, chunks, bytes: b.length };
}


// Decode a non-interlaced 8-bit RGBA/RGB/GA PNG just enough to find the minimum alpha and the opaque-corner colour.
import zlib from 'node:zlib';
function pngAlphaStats(file) {
  const b = fs.readFileSync(file);
  const info = pngInfo(file);
  if (!info || info.bitDepth !== 8 || ![2, 6].includes(info.colorType)) return null;
  if (b[28] !== 0) return null; // interlaced: skip
  let off = 8; const idat = [];
  while (off + 8 <= b.length) { const len = b.readUInt32BE(off); const type = b.toString('latin1', off + 4, off + 8); if (type === 'IDAT') idat.push(b.subarray(off + 8, off + 8 + len)); off += 12 + len; if (type === 'IEND') break; }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = info.colorType === 6 ? 4 : 3, stride = info.width * bpp;
  const px = Buffer.alloc(stride * info.height);
  for (let y = 0; y < info.height; y++) {
    const ft = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const r = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v;
      if (ft === 0) v = r; else if (ft === 1) v = r + a; else if (ft === 2) v = r + up; else if (ft === 3) v = r + ((a + up) >> 1);
      else { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); }
      px[y * stride + x] = v & 255;
    }
  }
  let minA = 255, transparent = 0;
  if (bpp === 4) for (let i = 3; i < px.length; i += 4) { if (px[i] < minA) minA = px[i]; if (px[i] < 255) transparent++; }
  const corner = [px[0], px[1], px[2]];
  return { minAlpha: minA, transparentPixels: transparent, corner };
}

// ---------- gather ----------
const files = fs.existsSync(root) ? walk(root) : [];
const textExt = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg', '.txt', '.xml']);
const textFiles = files.filter((f) => textExt.has(path.extname(f).toLowerCase()));
const texts = new Map(textFiles.map((f) => [f, read(f)]));

// ---------- 1. entry files ----------
if (!exists('index.html')) { add('FAIL', 'A-entry', 'index.html missing'); }
else add('PASS', 'A-entry', 'index.html present');
add(exists('.nojekyll') ? 'PASS' : 'FAIL', 'A15', '.nojekyll ' + (exists('.nojekyll') ? 'present' : 'MISSING (GitHub Pages would hide files starting with _ and run Jekyll)'));
add(exists('404.html') ? 'PASS' : 'WARN', 'A11', '404.html ' + (exists('404.html') ? 'present' : 'missing'));
add(exists('sw.js') ? 'PASS' : 'FAIL', 'A6', 'sw.js ' + (exists('sw.js') ? 'present at site root (needed so scope covers the whole sub-path)' : 'MISSING'));

const indexHtml = exists('index.html') ? read(path.join(root, 'index.html')) : '';

// ---------- 2. head tags ----------
function tagAttrs(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5];
  return attrs;
}
const linkTags = [...indexHtml.matchAll(/<link\b[^>]*>/gi)].map((m) => tagAttrs(m[0]));
const metaTags = [...indexHtml.matchAll(/<meta\b[^>]*>/gi)].map((m) => tagAttrs(m[0]));
const metaNamed = (n) => metaTags.filter((m) => (m.name || '').toLowerCase() === n);

if (indexHtml) {
  const title = (indexHtml.match(/<title>([^<]*)<\/title>/i) || [])[1];
  add(title ? 'INFO' : 'FAIL', 'A4', `<title>: ${title ?? 'MISSING'}`);
  if (!/<html[^>]*\blang=/i.test(indexHtml)) add('WARN', 'C3', '<html lang> missing');

  const vp = metaNamed('viewport')[0];
  if (!vp) add('FAIL', 'A4', 'viewport meta missing');
  else {
    const c = vp.content || '';
    add(/viewport-fit=cover/.test(c) ? 'PASS' : 'FAIL', 'A4', `viewport has viewport-fit=cover (${c})`);
    add(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(c) ? 'FAIL' : 'PASS', 'A5', 'viewport does not block pinch-zoom (accessibility)');
  }
  add(metaNamed('apple-mobile-web-app-capable')[0]?.content === 'yes' ? 'PASS' : 'FAIL', 'A4', 'apple-mobile-web-app-capable=yes');
  add(metaNamed('mobile-web-app-capable').length ? 'PASS' : 'WARN', 'A4', 'mobile-web-app-capable (Chrome/Android) ' + (metaNamed('mobile-web-app-capable').length ? 'present' : 'missing'));
  add(metaNamed('apple-mobile-web-app-title').length ? 'PASS' : 'WARN', 'A4', 'apple-mobile-web-app-title ' + (metaNamed('apple-mobile-web-app-title').length ? metaNamed('apple-mobile-web-app-title')[0].content : 'missing (iOS falls back to <title>)'));
  add(metaNamed('apple-mobile-web-app-status-bar-style').length ? 'PASS' : 'WARN', 'A4', 'apple-mobile-web-app-status-bar-style ' + (metaNamed('apple-mobile-web-app-status-bar-style')[0]?.content ?? 'missing'));
  add(metaNamed('theme-color').length ? 'PASS' : 'FAIL', 'A4', `theme-color metas: ${metaNamed('theme-color').length} (light+dark variants expected: ${metaNamed('theme-color').map((m) => m.media || 'default').join(', ')})`);
  add(metaNamed('referrer').length ? 'PASS' : 'WARN', 'I11', 'referrer policy meta ' + (metaNamed('referrer')[0]?.content ?? 'missing (recommend no-referrer)'));
  const csp = metaTags.find((m) => (m['http-equiv'] || '').toLowerCase() === 'content-security-policy');
  add(csp ? 'PASS' : 'WARN', 'I12', 'CSP meta ' + (csp ? csp.content : 'missing (defence in depth: default-src \'self\')'));
  add(metaNamed('color-scheme').length || /color-scheme/.test([...texts.values()].join('\n')) ? 'PASS' : 'WARN', 'C6', 'color-scheme declared');
}

// ---------- 3. manifest ----------
const manifestLink = linkTags.find((l) => (l.rel || '').toLowerCase() === 'manifest');
let manifest = null;
if (!manifestLink) add('FAIL', 'A1', 'no <link rel="manifest"> in index.html');
else {
  const href = manifestLink.href || '';
  add(/^\/(?!\/)|^[a-z]+:/i.test(href) ? 'FAIL' : 'PASS', 'A1', `manifest href is relative: ${href}`);
  const mf = path.join(root, href.split('?')[0]);
  if (!fs.existsSync(mf)) add('FAIL', 'A1', `manifest file not found: ${href}`);
  else {
    try { manifest = JSON.parse(read(mf)); add('PASS', 'A1', 'manifest parses as JSON'); }
    catch (e) { add('FAIL', 'A1', 'manifest is not valid JSON: ' + e.message); }
  }
}
if (manifest) {
  const need = (k) => (manifest[k] ? add('PASS', 'A1', `manifest.${k} = ${JSON.stringify(manifest[k])}`) : add('FAIL', 'A1', `manifest.${k} missing`));
  ['name', 'short_name', 'start_url', 'display', 'background_color', 'theme_color'].forEach(need);
  if (manifest.short_name && manifest.short_name.length > 12) add('WARN', 'A1', `short_name is ${manifest.short_name.length} chars; iOS/Android truncate under the icon (aim <= 12)`);
  if (manifest.display && !['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) add('FAIL', 'A1', `display=${manifest.display} will not be an app window`);
  for (const k of ['start_url', 'scope', 'id']) {
    if (manifest[k] !== undefined && /^\/(?!\/)|^https?:/i.test(manifest[k])) add('FAIL', 'A10', `manifest.${k} is absolute: ${manifest[k]} (breaks under /repo-name/)`);
  }
  if (manifest.scope === undefined) add('INFO', 'A1', 'manifest.scope not set (defaults to the manifest folder; fine if manifest sits at site root)');
  const icons = manifest.icons || [];
  if (!icons.length) add('FAIL', 'A2', 'manifest.icons empty');
  let have192 = false, have512 = false, haveMaskable = false;
  for (const ic of icons) {
    const src = ic.src || '';
    if (/^\/(?!\/)|^https?:/i.test(src)) add('FAIL', 'A10', `icon src absolute: ${src}`);
    const file = path.join(root, src.split('?')[0]);
    if (!fs.existsSync(file)) { add('FAIL', 'A2', `icon file missing: ${src}`); continue; }
    if (!existsExactCase(src.replace(/^\.\//, ''))) add('FAIL', 'A15', `icon path case mismatch (works on macOS, 404 on GitHub Pages): ${src}`);
    if ((ic.type || '').includes('png') || file.endsWith('.png')) {
      const info = pngInfo(file);
      if (!info) { add('FAIL', 'A2', `${src} is not a valid PNG`); continue; }
      const declared = (ic.sizes || '').split(/\s+/).filter(Boolean);
      const actual = `${info.width}x${info.height}`;
      if (!declared.includes(actual)) add('FAIL', 'A2', `${src}: declared sizes "${ic.sizes}" but real size is ${actual}`);
      else add('PASS', 'A2', `${src}: ${actual} matches declared sizes${ic.purpose ? ' purpose=' + ic.purpose : ''}`);
      if (info.width !== info.height) add('FAIL', 'A2', `${src} is not square`);
      if (info.width === 192) have192 = true;
      if (info.width === 512) have512 = true;
      if ((ic.purpose || '').includes('maskable')) haveMaskable = true;
      if ((ic.purpose || '').includes('maskable') && (ic.purpose || '').includes('any')) add('WARN', 'A2', `${src}: purpose "any maskable" on one file is discouraged; use separate icons`);
    } else if (file.endsWith('.svg')) add('INFO', 'A2', `${src} is SVG (fine as an extra; PNGs still required for iOS)`);
  }
  add(have192 ? 'PASS' : 'FAIL', 'A2', '192x192 PNG icon in manifest');
  add(have512 ? 'PASS' : 'FAIL', 'A2', '512x512 PNG icon in manifest');
  add(haveMaskable ? 'PASS' : 'WARN', 'A2', 'a separate maskable icon ' + (haveMaskable ? 'present (check safe-zone visually)' : 'missing'));
  if (manifest.shortcuts) add('INFO', 'A1', `manifest.shortcuts: ${manifest.shortcuts.length}`);
  if (manifest.screenshots) add('INFO', 'A1', `manifest.screenshots: ${manifest.screenshots.length}`);
  const nameStr = JSON.stringify([manifest.name, manifest.short_name, manifest.description]);
  const nameOnly = JSON.stringify([manifest.name, manifest.short_name]);
  add(/garmin/i.test(nameOnly) ? 'FAIL' : 'PASS', 'H1', 'manifest name/short_name free of "Garmin"');
  if (/garmin/i.test(nameStr) && !/garmin/i.test(nameOnly)) add(/not affiliated|unofficial/i.test(manifest.description || '') ? 'REVIEW' : 'FAIL', 'H1', `manifest.description mentions Garmin: "${(manifest.description || '').slice(0, 160)}" (acceptable only as a disclaimer)`);
}

// ---------- 4. apple-touch-icon ----------
const ati = linkTags.filter((l) => (l.rel || '').toLowerCase().includes('apple-touch-icon'));
if (!ati.length) add('FAIL', 'A3', 'no <link rel="apple-touch-icon"> (iOS would screenshot the page as the icon)');
else {
  for (const l of ati) {
    const href = l.href || '';
    if (/^\/(?!\/)|^https?:/i.test(href)) add('FAIL', 'A10', `apple-touch-icon href absolute: ${href}`);
    const f = path.join(root, href.split('?')[0]);
    if (!fs.existsSync(f)) { add('FAIL', 'A3', `apple-touch-icon file missing: ${href}`); continue; }
    const info = pngInfo(f);
    if (!info) { add('FAIL', 'A3', `${href} is not a PNG`); continue; }
    add(info.width === 180 && info.height === 180 ? 'PASS' : (l.sizes ? 'WARN' : 'FAIL'), 'A3', `apple-touch-icon ${href} is ${info.width}x${info.height} (180x180 wanted)`);
    if (info.hasAlphaChannel || info.hasTRNS) {
      const st = pngAlphaStats(f);
      if (st && st.transparentPixels === 0) add('PASS', 'A3', `${href} has an alpha channel but every pixel is fully opaque (min alpha ${st.minAlpha}); corner rgb(${st.corner.join(',')})`);
      else if (st) add('FAIL', 'A3', `${href} has ${st.transparentPixels} non-opaque pixels (min alpha ${st.minAlpha}); iOS paints transparency black`);
      else add('WARN', 'A3', `${href} has alpha/transparency and could not be decoded; verify it is fully opaque.`);
    } else add('PASS', 'A3', `${href} has no alpha channel`);
  }
}
const favicon = linkTags.find((l) => /\bicon\b/.test((l.rel || '').toLowerCase()) && !/apple/.test(l.rel.toLowerCase()));
add(favicon || exists('favicon.ico') ? 'PASS' : 'WARN', 'L', 'favicon link ' + (favicon ? favicon.href : exists('favicon.ico') ? 'favicon.ico at root' : 'missing (browsers request /favicon.ico absolute and log a 404)'));

// ---------- 5. absolute URL / external host scan ----------
const absPatterns = [
  [/\b(?:href|src|action|poster|data-src)\s*=\s*["']\/(?!\/)/gi, 'attribute with root-absolute URL'],
  [/\burl\(\s*["']?\/(?!\/)/gi, 'css url() root-absolute'],
  [/\bfetch\(\s*["'`]\/(?!\/)/g, 'fetch() root-absolute'],
  [/\bimport\(?\s*["']\/(?!\/)/g, 'import root-absolute'],
  [/\bfrom\s+["']\/(?!\/)/g, 'import-from root-absolute'],
  [/\bregister\(\s*["'`]\/(?!\/)/g, 'serviceWorker.register root-absolute'],
  [/\bnew URL\(\s*["'`]\/(?!\/)/g, 'new URL root-absolute'],
  [/\b(?:location\.(?:href|pathname)\s*=|location\.(?:assign|replace)\()\s*["'`]\/(?!\/)/g, 'location set to root-absolute'],
  [/\b(?:start_url|scope|src|id)"\s*:\s*"\/(?!\/)/g, 'manifest/json root-absolute'],
  [/\b(?:caches?\.)?(?:add|match|addAll|put)\(\s*["'`]\/(?!\/)/g, 'cache API root-absolute'],
  [/["'`]\/(?:index\.html|sw\.js|manifest\.webmanifest|css\/|js\/|icons?\/|assets?\/)/g, 'string literal begins with a site-root path'],
];
let absHits = 0;
for (const [f, t] of texts) {
  const r = rel(f);
  for (const [re, label] of absPatterns) {
    for (const m of t.matchAll(re)) {
      const line = t.slice(0, m.index).split('\n').length;
      add('FAIL', 'A10', `${r}:${line} ${label}: ${m[0].trim()}`);
      absHits++;
    }
  }
}
if (!absHits) add('PASS', 'A10', 'no root-absolute URLs found in html/css/js/json');

const hostHits = new Map();
for (const [f, t] of texts) {
  for (const m of t.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})(?:[/:?#"'\s)]|$)/gi)) {
    const host = m[1].toLowerCase();
    if (host === 'www.w3.org' || host === 'w3.org') continue; // xmlns
    if (/\.(invalid|test|localhost|example)$/.test(host) || /^(example\.(com|org|net))$/.test(host)) continue; // reserved placeholders, cannot resolve
    const line = t.slice(0, m.index).split('\n').length;
    const key = host;
    if (!hostHits.has(key)) hostHits.set(key, []);
    hostHits.get(key).push(`${rel(f)}:${line}`);
  }
}
if (!hostHits.size) add('PASS', 'I4', 'no external hosts referenced in shipped files');
for (const [host, where] of hostHits) {
  const isGithub = /(^|\.)github\.(com|io)$/.test(host);
  add(isGithub ? 'REVIEW' : 'FAIL', 'I4', `external host "${host}" referenced at ${where.slice(0, 4).join(', ')}${where.length > 4 ? ` (+${where.length - 4})` : ''}${isGithub ? ' (link only? make sure it is an <a> with rel=noopener noreferrer, not a request carrying data)' : ' (third-party request = privacy fail unless it is a plain outbound link)'}`);
}
for (const [f, t] of texts) {
  for (const m of t.matchAll(/\bnavigator\.sendBeacon|\bXMLHttpRequest|\bWebSocket\(|\bEventSource\(/g)) add('REVIEW', 'I4', `${rel(f)}:${t.slice(0, m.index).split('\n').length} uses ${m[0]}`);
}
for (const [f, t] of texts) {
  for (const m of t.matchAll(/\bfetch\(\s*([^)]{0,80})\)/g)) add('REVIEW', 'I4', `${rel(f)}:${t.slice(0, m.index).split('\n').length} fetch(${m[1].trim()}) must be same-origin only`);
}
const analytics = /\b(gtag|google-analytics|googletagmanager|ga\(|fbq\(|plausible|umami|matomo|mixpanel|segment\.|hotjar|sentry|datadog|amplitude|posthog|clarity\.ms)\b/i;
let anaHit = false;
for (const [f, t] of texts) { const m = t.match(analytics); if (m) { anaHit = true; add('FAIL', 'I5', `${rel(f)} mentions analytics/tracker "${m[0]}"`); } }
if (!anaHit) add('PASS', 'I5', 'no analytics / tracker keywords');

// ---------- 6. trademark / honesty scan ----------
let garminHits = 0;
for (const f of [...files]) {
  const r = rel(f);
  if (/garmin/i.test(r)) { add('REVIEW', 'H1', `file name contains "garmin" (internal module name; visible only in dev tools/network): ${r}`); garminHits++; }
}
for (const [f, t] of texts) {
  const r = rel(f);
  const lines = t.split('\n');
  lines.forEach((ln, i) => {
    if (/garmin/i.test(ln)) {
      garminHits++;
      const inTitle = /<title>|apple-mobile-web-app-title|og:title|"name"|"short_name"/.test(ln);
      add(inTitle ? 'FAIL' : 'REVIEW', 'H1', `${r}:${i + 1} ${inTitle ? 'IN NAME/TITLE ' : ''}"${ln.trim().slice(0, 140)}"`);
    }
  });
}
if (!garminHits) add('INFO', 'H1', 'no "Garmin" mention in shipped files (the About page must still say "unofficial, not affiliated with Garmin" so at least one mention is expected once built)');
const aboutText = [...texts.values()].join('\n');
add(/unofficial/i.test(aboutText) && /not affiliated/i.test(aboutText) ? 'PASS' : 'FAIL', 'H2', 'about text contains "unofficial" and "not affiliated"');
for (const [f, t] of texts) {
  for (const m of t.matchAll(/\b(last synced?|synced (just )?now|syncing\.\.\.|syncing…|connected to (your )?(watch|garmin)|live sync|auto-?sync|real-?time sync|sync(ed)? with (your )?(watch|garmin))\b/gi)) {
    add('REVIEW', 'H3', `${rel(f)}:${t.slice(0, m.index).split('\n').length} sync wording "${m[0]}" (must not imply live sync; check context)`);
  }
  for (const m of t.matchAll(/\b(will ring|rings your watch|wake you|vibrate your watch|push notification)\b/gi)) {
    add('REVIEW', 'H5', `${rel(f)}:${t.slice(0, m.index).split('\n').length} alarm/notification promise "${m[0]}"`);
  }
}
for (const f of files) {
  if (/\.(svg|png|jpg|jpeg|webp|ico)$/i.test(f) && /garmin|delta|logo/i.test(path.basename(f))) add('REVIEW', 'H1', `image name suggests a logo: ${rel(f)}`);
}

// ---------- 7. DOM-injection hazards ----------
for (const [f, t] of texts) {
  if (!/\.(m?js|html)$/.test(f)) continue;
  const r = rel(f);
  const lines = t.split('\n');
  lines.forEach((ln, i) => {
    if (/\.(innerHTML|outerHTML)\s*(\+?=)|insertAdjacentHTML\(|document\.write\(|\beval\(|new Function\(|dangerouslySetInnerHTML/.test(ln)) add('REVIEW', 'E1', `${r}:${i + 1} DOM-string sink: ${ln.trim().slice(0, 140)}  (is any user data in this string, unescaped?)`);
    if (/\son(click|load|error|change|submit|input|keydown)\s*=/.test(ln) && /\.html$/.test(f)) add('REVIEW', 'E1', `${r}:${i + 1} inline event handler (blocks a strict CSP): ${ln.trim().slice(0, 120)}`);
    if (/href\s*=\s*["']javascript:/i.test(ln)) add('FAIL', 'E1', `${r}:${i + 1} javascript: URL`);
  });
}

// ---------- 8. css checks ----------
const css = [...texts].filter(([f]) => f.endsWith('.css')).map(([, t]) => t).join('\n') + (indexHtml.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n');
if (css) {
  add(/prefers-reduced-motion/.test(css) ? 'PASS' : 'FAIL', 'C5', 'CSS honours prefers-reduced-motion');
  add(/prefers-color-scheme/.test(css) || /data-theme/.test(css) ? 'PASS' : 'FAIL', 'C6', 'CSS has dark/light theming');
  add(/:focus-visible/.test(css) ? 'PASS' : 'FAIL', 'C1', 'CSS defines :focus-visible styles');
  add(/outline\s*:\s*(none|0)\b/.test(css) && !/:focus-visible/.test(css) ? 'FAIL' : 'PASS', 'C1', 'focus outline not removed without replacement');
  add(/env\(safe-area-inset/.test(css) ? 'PASS' : 'FAIL', 'B5', 'CSS uses env(safe-area-inset-*)');
  if (/\b100vh\b/.test(css)) add('WARN', 'B', '100vh used; iOS Safari toolbars/keyboard make it taller than the visible area. Prefer 100dvh or min-height with fallback.');
  if (/-webkit-overflow-scrolling|user-select\s*:\s*none/.test(css)) add('REVIEW', 'C', 'user-select:none found; make sure text the user may want to copy is still selectable');
  if (/@import\s+url\(\s*["']?https?:/.test(css)) add('FAIL', 'I4', 'CSS @import from a remote host');
  add(/overscroll-behavior/.test(css) ? 'PASS' : 'WARN', 'B7', 'overscroll-behavior set ' + (/overscroll-behavior/.test(css) ? '' : '(rubber-banding / pull-to-refresh not controlled)'));
  const inputSize = [...css.matchAll(/(input|select|textarea)[^{]*\{[^}]*font-size\s*:\s*([\d.]+)(px|rem|em)/g)];
  for (const m of inputSize) {
    const px = m[3] === 'px' ? Number(m[2]) : Number(m[2]) * 16;
    if (px < 16) add('WARN', 'A5', `form control font-size ${m[2]}${m[3]} < 16px: iOS Safari zooms the page on focus`);
  }
} else add('WARN', 'C', 'no CSS found');

// ---------- 9. service worker vs. files ----------
if (exists('sw.js')) {
  const sw = read(path.join(root, 'sw.js'));
  if (/\bskipWaiting\b/.test(sw)) add('INFO', 'A8', 'sw.js calls skipWaiting (check HTML/JS version mix on update)');
  if (!/\bclients\.claim\b/.test(sw)) add('INFO', 'A8', 'sw.js does not call clients.claim');
  if (!/caches\.delete/.test(sw)) add('WARN', 'A8', 'sw.js never deletes old caches (storage grows each release)');
  if (!/\bfetch\b/.test(sw)) add('FAIL', 'A7', 'sw.js has no fetch handler: nothing works offline');
  const strings = [...sw.matchAll(/["'`]([^"'`\n]{1,120})["'`]/g)].map((m) => m[1]);
  const pathLike = strings.filter((s) => /^(\.\/|\.\.\/)?[\w@./-]+\.(html|css|js|mjs|json|webmanifest|png|svg|ico|woff2?|txt)$/i.test(s) || s === './' || s === '.');
  let precacheMissing = 0;
  for (const s of pathLike) {
    const rp = s.replace(/^\.\//, '');
    if (rp === '' || rp === '.') continue;
    if (!existsExactCase(rp)) { add('FAIL', 'A9', `sw.js lists "${s}" but no such file (cache.addAll would reject and the SW would never install)`); precacheMissing++; }
  }
  if (!precacheMissing) add('PASS', 'A9', `sw.js path strings all exist on disk (${pathLike.length} checked)`);
  // module graph + html refs must be covered
  const needed = new Set();
  const addNeeded = (from, spec) => {
    if (/^(https?:|data:|#|mailto:)/.test(spec)) return;
    const p0 = spec.split(/[?#]/)[0];
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), p0));
    if (resolved.startsWith('..')) return;
    needed.add(resolved);
  };
  for (const m of indexHtml.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)) addNeeded('index.html', m[1]);
  for (const [f, t] of texts) {
    const r = rel(f);
    if (r.endsWith('.js') || r.endsWith('.mjs')) {
      for (const m of t.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)) addNeeded(r, m[1]);
    }
    if (r.endsWith('.css')) for (const m of t.matchAll(/url\(\s*["']?(?!data:)([^"')]+)["']?\s*\)/g)) addNeeded(r, m[1]);
  }
  const notCached = [...needed].filter((n) => existsExactCase(n) && !sw.includes(n) && !sw.includes('./' + n) && !/\.html$/.test(n));
  if (!notCached.length) add('PASS', 'A9', 'every file referenced by index.html / import graph / css appears in sw.js text (or sw builds the list dynamically; verify in browser)');
  else for (const n of notCached.slice(0, 40)) add('WARN', 'A9', `referenced by the app but not named in sw.js (offline gap unless the list is generated): ${n}`);
  for (const n of needed) if (!existsExactCase(n) && n !== '' ) add('FAIL', 'A15', `referenced file does not exist (exact case): ${n}`);
}

// ---------- 10. repo content ----------
const ignoredExt = /\.(ics|fit|gpx|tcx|zip|env|pem|key|sqlite|db|csv)$/i;
for (const f of files) if (ignoredExt.test(f) && !rel(f).startsWith('tests/fixtures/')) add('FAIL', 'I9', `data-like file outside tests/fixtures: ${rel(f)}`);
let total = 0; const big = [];
for (const f of files) { const s = fs.statSync(f).size; total += s; if (s > 500 * 1024) big.push(`${rel(f)} ${(s / 1024).toFixed(0)}KB`); }
add('INFO', 'size', `shipped files: ${files.length}, ${(total / 1024).toFixed(0)} KB total` + (big.length ? `; > 500KB: ${big.join(', ')}` : ''));
for (const f of files) {
  if (f.endsWith('.png')) {
    const info = pngInfo(f);
    if (info) {
      const bad = info.chunks.filter((c) => ['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'].includes(c));
      if (bad.length) add('WARN', 'I10', `${rel(f)} has metadata chunks ${bad.join(',')} (strip before publishing)`);
    }
  }
}

// ---------- print ----------
const order = { FAIL: 0, WARN: 1, REVIEW: 2, INFO: 3, PASS: 4 };
results.sort((a, b) => order[a.level] - order[b.level]);
for (const r of results) console.log(`${r.level.padEnd(6)} ${r.id.padEnd(7)} ${r.msg}`);
const count = (l) => results.filter((r) => r.level === l).length;
console.log(`\nSUMMARY  FAIL ${count('FAIL')}  WARN ${count('WARN')}  REVIEW ${count('REVIEW')}  PASS ${count('PASS')}  (root: ${root})`);
process.exit(count('FAIL') ? 1 : 0);
