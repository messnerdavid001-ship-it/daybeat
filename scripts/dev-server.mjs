#!/usr/bin/env node
// Local static dev server. Node built-ins only. Not part of the published site.
//
//   node scripts/dev-server.mjs [--port N] [--host 127.0.0.1] [--base /repo/] [--root DIR] [--ttl SECONDS] [--verbose]
//
// - port: --port, or env PORT; none (or 0) = a random free port.
// - base: serve the site under a sub-path, like GitHub Pages project sites do (404 outside it).
// - Binds to loopback only; the Host header is checked (blocks DNS-rebinding from other websites).
// - Everything is sent with Cache-Control: no-store so edits show up immediately.
// - Paths are case-sensitive like GitHub Pages (macOS file systems are not), directories 301 to a trailing slash,
//   a missing file gets 404.html with status 404.
// - Shuts itself down after --ttl seconds (default 4 hours, 0 = never) so a forgotten server does not linger.
// First line printed on stdout: LISTENING <url>

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildManifest } from './build-sw-manifest.mjs';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};

const BLOCKED_SEGMENTS = new Set(['node_modules']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function normalizeBase(base) {
  let b = String(base || '/').trim();
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b += '/';
  b = b.replace(/\/{2,}/g, '/');
  return b;
}

function send(res, status, headers, body) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(body);
}

function plain(res, status, text, extra = {}) {
  send(res, status, { 'Content-Type': 'text/plain; charset=utf-8', ...extra }, text + '\n');
}

/** Resolve a URL path (already stripped of the base) to a file inside root, or return a status code. */
export function resolveSafe(realRoot, relPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { status: 400 };
  const segments = decoded.split('/').filter((s) => s !== '');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') return { status: 400 };
    if (seg.startsWith('.') && seg !== '.well-known') return { status: 404 };
    if (BLOCKED_SEGMENTS.has(seg)) return { status: 404 };
  }
  const candidate = path.join(realRoot, ...segments);
  const rel = path.relative(realRoot, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { status: 400 };
  return { file: candidate, trailingSlash: decoded.endsWith('/') || segments.length === 0 };
}

export function startServer(opts = {}) {
  const {
    root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    port = 0,
    host = '127.0.0.1',
    base = '/',
    ttlSeconds = 0,
    verbose = false,
  } = opts;
  if (!LOOPBACK_HOSTS.has(host)) {
    return Promise.reject(new Error(`Refusing to bind to ${host}: only loopback addresses are allowed (127.0.0.1, localhost, ::1).`));
  }
  const realRoot = fs.realpathSync(root);
  const basePath = normalizeBase(base);
  let actualPort = port;

  const server = http.createServer(async (req, res) => {
    try {
      const hostHeader = String(req.headers.host || '');
      const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(hostHeader);
      if (!m || !LOOPBACK_HOSTS.has(m[1].toLowerCase()) || (m[2] && Number(m[2]) !== actualPort)) {
        return plain(res, 403, 'Forbidden: unexpected Host header.');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return plain(res, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
      }
      // Parse by hand: new URL('//x') would treat "//x" as a host name. Only origin-form targets ("/path?query") are accepted.
      const target = String(req.url || '');
      if (!target.startsWith('/')) return plain(res, 400, 'Bad request.');
      const qAt = target.indexOf('?');
      const pathname = qAt < 0 ? target.split('#')[0] : target.slice(0, qAt);
      const url = { pathname, search: qAt < 0 ? '' : target.slice(qAt).split('#')[0] };
      if (verbose) console.error(`${req.method} ${pathname}`);

      if (pathname + '/' === basePath && basePath !== '/') {
        return send(res, 301, { Location: basePath + url.search }, '');
      }
      if (!pathname.startsWith(basePath)) {
        return await serve404(res, req, true);
      }
      const rel = pathname.slice(basePath.length);
      const r = resolveSafe(realRoot, rel);
      if (r.status === 400) return plain(res, 400, 'Bad request.');
      if (r.status === 404) return await serve404(res, req, false);

      // GitHub Pages is case-sensitive, macOS is not: refuse a path whose letter case differs from the file on disk.
      if (!(await exactCase(realRoot, rel))) return await serve404(res, req, false);

      let file = r.file;
      let st = await statSafe(file);
      if (st && st.isDirectory()) {
        if (!pathname.endsWith('/')) {
          return send(res, 301, { Location: pathname + '/' + url.search }, '');
        }
        file = path.join(file, 'index.html');
        st = await statSafe(file);
      }
      if (!st || !st.isFile()) return await serve404(res, req, false);

      // Symlink escape check.
      let real;
      try {
        real = await fs.promises.realpath(file);
      } catch {
        return await serve404(res, req, false);
      }
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return plain(res, 403, 'Forbidden.');
      await sendFile(res, req, real, st, 200);
    } catch (err) {
      if (!res.headersSent) plain(res, 500, 'Server error.');
      else res.destroy();
      if (verbose) console.error(err);
    }
  });

  async function serve404(res, req, outsideBase) {
    // Like GitHub Pages: serve the site's own 404.html (status 404) when it exists.
    const f = path.join(realRoot, '404.html');
    const st = outsideBase ? null : await statSafe(f);
    if (st && st.isFile()) return sendFile(res, req, f, st, 404);
    return plain(res, 404, 'Not found.');
  }

  function sendFile(res, req, file, st, status) {
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Content-Length': String(st.size),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    res.writeHead(status, headers);
    if (req.method === 'HEAD') {
      res.end();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const stream = fs.createReadStream(file);
      stream.on('error', () => {
        res.destroy();
        resolve();
      });
      res.on('close', resolve);
      stream.pipe(res);
    });
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      actualPort = server.address().port;
      const hostForUrl = host === '::1' ? '[::1]' : host;
      const url = `http://${hostForUrl}:${actualPort}${basePath}`;
      let timer = null;
      const close = () =>
        new Promise((res2) => {
          if (timer) clearTimeout(timer);
          server.close(() => res2());
          server.closeAllConnections?.();
        });
      if (ttlSeconds > 0) {
        timer = setTimeout(() => {
          close().then(() => process.exit(0));
        }, ttlSeconds * 1000);
        timer.unref?.();
      }
      resolve({ server, url, port: actualPort, base: basePath, root: realRoot, close });
    });
  });
}

async function exactCase(root, rel) {
  let dir = root;
  for (const seg of decodeURIComponent(rel).split('/').filter(Boolean)) {
    let names;
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      return false;
    }
    if (!names.includes(seg)) return false;
    dir = path.join(dir, seg);
  }
  return true;
}

async function statSafe(p) {
  try {
    return await fs.promises.stat(p);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = { verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === '--port') out.port = Number(val());
    else if (a === '--host') out.host = val();
    else if (a === '--base') out.base = val();
    else if (a === '--root') out.root = path.resolve(val());
    else if (a === '--ttl') out.ttlSeconds = Number(val());
    else if (a === '--no-manifest') out.noManifest = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

const HELP = `Usage: node scripts/dev-server.mjs [--port N] [--host 127.0.0.1] [--base /repo/] [--root DIR] [--ttl SECONDS] [--no-manifest] [--verbose]
  No port (or PORT=0) picks a random free port. Prints "LISTENING <url>" as the first line.
  --base serves the site under a sub-path like GitHub Pages. --ttl 0 = run until stopped (default 14400).
  On start it refreshes sw-manifest.js from the files on disk (skip with --no-manifest).`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message + '\n' + HELP);
    process.exit(2);
  }
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  const envPort = process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : undefined;
  const port = args.port ?? envPort ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('Invalid port.');
    process.exit(2);
  }
  const ttlSeconds = args.ttlSeconds ?? 14400;
  // Keep the service worker's precache list in step with the files on disk (a stale list means a stale offline shell).
  const siteRoot = args.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (!args.noManifest && fs.existsSync(path.join(siteRoot, 'sw.js'))) {
    try {
      const m = buildManifest(siteRoot);
      const file = path.join(siteRoot, 'sw-manifest.js');
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== m.text) {
        fs.writeFileSync(file, m.text);
        console.error(`sw-manifest.js regenerated (version ${m.version}, ${m.files.length} files)`);
      }
    } catch (e) {
      console.error(`could not refresh sw-manifest.js: ${e.message}`);
    }
  }
  startServer({ ...args, port, ttlSeconds })
    .then((s) => {
      console.log(`LISTENING ${s.url}`);
      console.log(`Serving ${s.root} (Ctrl+C to stop; auto-stops after ${ttlSeconds || 'never'}${ttlSeconds ? ' s' : ''})`);
      const stop = () => s.close().then(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
