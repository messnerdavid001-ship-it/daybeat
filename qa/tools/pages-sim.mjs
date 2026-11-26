#!/usr/bin/env node
// QA tool: serve a folder the way GitHub Pages serves a project site, under a sub-path.
//
//   node qa/tools/pages-sim.mjs [--root <dir>] [--prefix /qa-sub/] [--port 0] [--manifest-mime octet] [--no-store]
//   (--no-store sends Cache-Control: no-store for quick functional runs; leave it off for cache/offline/SW tests)
//
// Behaviour copied from GitHub Pages (project site):
//   - everything lives under /<repo>/ ; anything outside the prefix is a 404 (so an absolute URL such as
//     "/css/app.css" or "/sw.js" fails here exactly as it would online)
//   - "/<repo>" without trailing slash -> 301 to "/<repo>/" ; directory without slash -> 301 to slash
//   - directory -> index.html
//   - unknown path inside the site -> the repo's own 404.html with status 404 (generic body if there is none)
//   - paths are CASE-SENSITIVE even on macOS (checked against the real directory listing)
//   - without a .nojekyll file, paths with a segment starting with "_" or "." are not served (Jekyll rule)
//   - Cache-Control: max-age=600, ETag, Last-Modified (so stale service-worker / asset behaviour shows up)
//   - .git is never served
// Extra (QA only, outside the prefix so it never collides with the app):
//   GET  /__qa/log     -> JSON array of every request {t, method, path, status}
//   POST /__qa/clear   -> empty the log
//   GET  /__qa/health  -> "ok"
// Prints one JSON line on start: {"port":N,"url":"http://127.0.0.1:N/qa-sub/"}.
// Binds to 127.0.0.1 only. Read-only: never writes to the served folder.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes('--' + name);

const root = path.resolve(opt('root', process.cwd()));
let prefix = opt('prefix', '/qa-sub/');
if (!prefix.startsWith('/')) prefix = '/' + prefix;
if (!prefix.endsWith('/')) prefix += '/';
const wantedPort = Number(opt('port', '0'));
const manifestMime = opt('manifest-mime', 'json'); // 'octet' mimics hosts that do not know .webmanifest
const noCacheHeaders = flag('no-cache-headers');
const noStore = flag('no-store'); // functional testing while developers edit files: always revalidate
const hasNojekyll = fs.existsSync(path.join(root, '.nojekyll'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': manifestMime === 'octet' ? 'application/octet-stream' : 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ics': 'text/calendar; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const log = [];
function record(req, status, p) {
  log.push({ t: new Date().toISOString(), method: req.method, path: p, status });
  if (log.length > 20000) log.shift();
}

// Case-sensitive existence check: macOS is case-insensitive, GitHub Pages (Linux) is not.
function resolveCaseSensitive(rel) {
  const parts = rel.split('/').filter(Boolean);
  let cur = root;
  for (const part of parts) {
    let names;
    try { names = fs.readdirSync(cur); } catch { return null; }
    if (!names.includes(part)) return null;
    cur = path.join(cur, part);
  }
  return cur;
}

function send(res, req, status, headers, body, p) {
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
  record(req, status, p);
}

function notFound(req, res, p, insideSite) {
  const custom = insideSite ? path.join(root, '404.html') : null;
  if (custom && fs.existsSync(custom)) {
    return send(res, req, 404, { 'Content-Type': MIME['.html'], 'X-QA-Note': 'custom 404.html' }, fs.readFileSync(custom), p);
  }
  const body = '<!doctype html><title>404</title><h1>404 File not found (GitHub Pages simulation)</h1>';
  send(res, req, 404, { 'Content-Type': MIME['.html'], 'X-QA-Note': insideSite ? 'no 404.html in repo' : 'outside site prefix' }, body, p);
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end('bad url'); }
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('bad encoding'); }

  if (p === '/__qa/health') return send(res, req, 200, { 'Content-Type': 'text/plain' }, 'ok', p);
  if (p === '/__qa/log') return send(res, req, 200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, JSON.stringify(log.filter((e) => !e.path.startsWith('/__qa/'))), p);
  if (p === '/__qa/clear' && req.method === 'POST') { log.length = 0; return send(res, req, 200, { 'Content-Type': 'text/plain' }, 'cleared', p); }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, req, 405, { Allow: 'GET, HEAD' }, 'method not allowed', p);

  // "/repo" -> "/repo/"
  if (p + '/' === prefix) {
    return send(res, req, 301, { Location: prefix + url.search }, '', p);
  }
  if (!p.startsWith(prefix)) return notFound(req, res, p, false);

  let rel = p.slice(prefix.length); // path inside the site, no leading slash
  if (rel.split('/').some((s) => s === '..' || s.includes('\0'))) return notFound(req, res, p, true);
  if (rel.split('/').some((s) => s === '.git')) return notFound(req, res, p, true);
  if (!hasNojekyll && rel.split('/').some((s) => s.startsWith('_') || (s.startsWith('.') && s !== ''))) {
    return notFound(req, res, p, true);
  }

  let target = resolveCaseSensitive(rel);
  if (target && !target.startsWith(root)) return notFound(req, res, p, true);
  if (target && fs.statSync(target).isDirectory()) {
    if (!p.endsWith('/')) return send(res, req, 301, { Location: p + '/' + url.search }, '', p);
    const idx = path.join(target, 'index.html');
    target = fs.existsSync(idx) ? idx : null;
  }
  if (!target || !fs.existsSync(target)) return notFound(req, res, p, true);

  const stat = fs.statSync(target);
  const etag = '"' + crypto.createHash('sha1').update(String(stat.mtimeMs) + ':' + stat.size).digest('hex').slice(0, 16) + '"';
  const headers = {
    'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  };
  if (noStore) headers['Cache-Control'] = 'no-store';
  else if (!noCacheHeaders) headers['Cache-Control'] = 'max-age=600';
  if (req.headers['if-none-match'] === etag) return send(res, req, 304, headers, '', p);
  send(res, req, 200, headers, fs.readFileSync(target), p);
});

server.listen(wantedPort, '127.0.0.1', () => {
  const port = server.address().port;
  console.log(JSON.stringify({ port, url: `http://127.0.0.1:${port}${prefix}`, root, prefix, nojekyll: hasNojekyll }));
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
