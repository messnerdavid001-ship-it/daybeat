// Tests for the dev server, the service worker manifest generator, 404.html and sw.js itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, normalizeBase, resolveSafe } from '../scripts/dev-server.mjs';
import { buildManifest, checkImports, collectFiles, manifestFileCurrent } from '../scripts/build-sw-manifest.mjs';
import { computeHashes } from '../scripts/stamp-404-csp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = [];
function mkTemp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'daybeat-test-'));
  tmp.push(d);
  return d;
}
test.after(() => {
  for (const d of tmp) fs.rmSync(d, { recursive: true, force: true });
});

function raw(port, requestPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

function siteDir() {
  const outer = mkTemp();
  const root = path.join(outer, 'site');
  fs.mkdirSync(path.join(root, 'js'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(outer, 'secret.txt'), 'TOP SECRET OUTSIDE');
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>home</h1>');
  fs.writeFileSync(path.join(root, '404.html'), '<h1>custom 404</h1>');
  fs.writeFileSync(path.join(root, 'Case.txt'), 'case');
  fs.writeFileSync(path.join(root, 'js', 'app.js'), 'export {}');
  fs.writeFileSync(path.join(root, 'manifest.webmanifest'), '{}');
  fs.writeFileSync(path.join(root, 'cal.ics'), 'BEGIN:VCALENDAR');
  fs.writeFileSync(path.join(root, 'sub', 'index.html'), '<h1>sub</h1>');
  fs.writeFileSync(path.join(root, '.git', 'config'), 'SECRET GIT');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
  fs.writeFileSync(path.join(root, 'node_modules', 'x.js'), 'x');
  try {
    fs.symlinkSync(path.join(outer, 'secret.txt'), path.join(root, 'link.txt'));
  } catch {
    /* symlinks may be unavailable */
  }
  return { outer, root };
}

test('dev server: types, no-store, nosniff, index files, directory redirects, 404 page', async () => {
  const { root } = siteDir();
  const s = await startServer({ root, port: 0 });
  try {
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    let r = await raw(s.port, '/');
    assert.equal(r.status, 200);
    assert.equal(r.body, '<h1>home</h1>');
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    r = await raw(s.port, '/js/app.js');
    assert.equal(r.headers['content-type'], 'text/javascript; charset=utf-8');
    r = await raw(s.port, '/manifest.webmanifest');
    assert.match(r.headers['content-type'], /^application\/manifest\+json/);
    r = await raw(s.port, '/cal.ics');
    assert.match(r.headers['content-type'], /^text\/calendar/);
    r = await raw(s.port, '/sub');
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, '/sub/');
    r = await raw(s.port, '/sub/');
    assert.equal(r.body, '<h1>sub</h1>');
    r = await raw(s.port, '/sub/?x=1');
    assert.equal(r.status, 200);
    r = await raw(s.port, '/missing');
    assert.equal(r.status, 404);
    assert.equal(r.body, '<h1>custom 404</h1>');
    r = await raw(s.port, '/index.html', { method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.equal(r.body, '');
    assert.equal(r.headers['content-length'], '13');
  } finally {
    await s.close();
  }
});

test('dev server: case-sensitive like GitHub Pages', async () => {
  const { root } = siteDir();
  const s = await startServer({ root });
  try {
    assert.equal((await raw(s.port, '/Case.txt')).status, 200);
    assert.equal((await raw(s.port, '/case.txt')).status, 404);
    assert.equal((await raw(s.port, '/CASE.TXT')).status, 404);
    assert.equal((await raw(s.port, '/INDEX.HTML')).status, 404);
    assert.equal((await raw(s.port, '/JS/app.js')).status, 404);
  } finally {
    await s.close();
  }
});

test('dev server: path traversal, dot files, symlinks and odd encodings never leak files', async () => {
  const { root } = siteDir();
  const s = await startServer({ root });
  try {
    const attempts = ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/js/../../secret.txt', '/js/%2e%2e/%2e%2e/secret.txt', '/..\\secret.txt', '/%5c..%5csecret.txt', '/%00', '/index.html%00.js', '/%', '/%zz', '//secret.txt', '/.git/config', '/.env', '/node_modules/x.js', '/link.txt', '/.git%2fconfig', '/%2egit/config'];
    for (const a of attempts) {
      const r = await raw(s.port, a);
      assert.notEqual(r.status, 200, a);
      assert.equal(/TOP SECRET|SECRET GIT|SECRET=1/.test(r.body), false, `${a} leaked`);
    }
  } finally {
    await s.close();
  }
  assert.deepEqual(resolveSafe(root, 'a/../b'), { status: 400 });
  assert.deepEqual(resolveSafe(root, '.git/x'), { status: 404 });
  assert.equal(resolveSafe(root, 'a%2Fb.txt').file, path.join(root, 'a', 'b.txt'));
});

test('dev server: Host header check, methods, loopback only', async () => {
  const { root } = siteDir();
  const s = await startServer({ root });
  try {
    for (const host of ['evil.example', 'evil.example:' + s.port, 'localhost:1', '127.0.0.1.evil.example', '[::2]:' + s.port]) {
      assert.equal((await raw(s.port, '/', { headers: { Host: host } })).status, 403, host);
    }
    assert.equal((await raw(s.port, '/', { headers: { Host: `localhost:${s.port}` } })).status, 200);
    assert.equal((await raw(s.port, '/', { headers: { Host: `127.0.0.1:${s.port}` } })).status, 200);
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await raw(s.port, '/', { method: m })).status, 405, m);
    // a request with no Host header at all (HTTP/1.0) is refused too
    const answer = await new Promise((resolve) => {
      const sock = net.connect(s.port, '127.0.0.1', () => sock.write('GET / HTTP/1.0\r\n\r\n'));
      let buf = '';
      sock.on('data', (d) => (buf += d));
      sock.on('close', () => resolve(buf));
    });
    assert.match(answer, /^HTTP\/1\.[01] 403/);
    // an absolute-form request target is not a normal browser request: refused
    const abs = await new Promise((resolve) => {
      const sock = net.connect(s.port, '127.0.0.1', () => sock.write(`GET http://evil.example/ HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nConnection: close\r\n\r\n`));
      let buf = '';
      sock.on('data', (d) => (buf += d));
      sock.on('close', () => resolve(buf));
    });
    assert.match(abs, /^HTTP\/1\.1 400/);
  } finally {
    await s.close();
  }
  await assert.rejects(startServer({ root, host: '0.0.0.0' }), /loopback/);
  await assert.rejects(startServer({ root, host: '192.168.1.5' }), /loopback/);
});

test('dev server: --base serves under a sub-path like GitHub Pages and 404s outside it', async () => {
  const { root } = siteDir();
  const s = await startServer({ root, base: 'daybeat' });
  try {
    assert.equal(s.base, '/daybeat/');
    assert.match(s.url, /\/daybeat\/$/);
    assert.equal((await raw(s.port, '/daybeat/')).body, '<h1>home</h1>');
    assert.equal((await raw(s.port, '/daybeat/js/app.js')).status, 200);
    const r = await raw(s.port, '/daybeat');
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, '/daybeat/');
    assert.equal((await raw(s.port, '/')).status, 404);
    assert.equal((await raw(s.port, '/js/app.js')).status, 404);
    assert.equal((await raw(s.port, '/other/index.html')).status, 404);
    const miss = await raw(s.port, '/daybeat/nothing');
    assert.equal(miss.status, 404);
    assert.equal(miss.body, '<h1>custom 404</h1>');
  } finally {
    await s.close();
  }
  assert.equal(normalizeBase('x//y'), '/x/y/');
  assert.equal(normalizeBase(''), '/');
});

test('dev server CLI: random port, LISTENING line first, auto-stops after --ttl, rejects bad arguments', async () => {
  const run = (args, env = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'dev-server.mjs'), ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      const t0 = Date.now();
      child.on('exit', (code) => resolve({ code, out, err, ms: Date.now() - t0 }));
      setTimeout(() => child.kill(), 8000).unref();
    });
  const ok = await run(['--ttl', '1', '--root', mkTemp()]);
  assert.equal(ok.code, 0);
  assert.match(ok.out.split('\n')[0], /^LISTENING http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.ok(ok.ms < 6000, `stopped itself after the ttl (${ok.ms} ms)`);
  const bad = await run(['--port', '99999']);
  assert.equal(bad.code, 2);
  const unknown = await run(['--nope']);
  assert.equal(unknown.code, 2);
  const envPort = await run(['--ttl', '1', '--root', mkTemp()], { PORT: '0' });
  assert.equal(envPort.code, 0);
});

// ---------------------------------------------------------------- sw manifest

test('sw-manifest.js is current (run: node scripts/build-sw-manifest.mjs) and consistent with the files on disk', () => {
  assert.equal(manifestFileCurrent(ROOT), true, 'sw-manifest.js is stale: run node scripts/build-sw-manifest.mjs');
  const m = buildManifest(ROOT);
  assert.ok(m.files.includes('index.html'));
  assert.ok(m.files.some((f) => f.startsWith('js/data/')));
  for (const f of m.files) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
    assert.ok(!f.startsWith('/') && !f.includes('..') && !/^[a-z]+:/.test(f), `${f} is relative`);
  }
  for (const never of ['sw.js', 'sw-manifest.js', '404.html', 'package.json']) assert.ok(!m.files.includes(never), never);
  assert.ok(!m.files.some((f) => /^(docs|qa|tests|scripts)\//.test(f) || f.endsWith('.md') || f.endsWith('.mjs') || f.split('/').some((p) => p.startsWith('.'))));
  assert.deepEqual(checkImports(ROOT, m.files), [], 'every static import exists and is precached');
  assert.ok(m.warnings.length === 0, m.warnings.join('; '));
  const text = fs.readFileSync(path.join(ROOT, 'sw-manifest.js'), 'utf8');
  assert.match(text, /^\/\/ GENERATED/);
  assert.match(text, /self\.__DAYBEAT_PRECACHE = \{"version":"[0-9a-f]{12}"/);
});

test('manifest generator: deterministic, version changes with any file change, import problems are reported', () => {
  const root = mkTemp();
  fs.mkdirSync(path.join(root, 'js'));
  fs.mkdirSync(path.join(root, 'css'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(root, 'js', 'app.js'), "import './b.js';\nexport * from './c.js';\nconst x = import('./d.js');\n");
  fs.writeFileSync(path.join(root, 'js', 'b.js'), "import { x } from '/abs.js';\nimport y from 'https://cdn.example.invalid/y.js';");
  fs.writeFileSync(path.join(root, 'css', 'a.css'), 'a{}');
  fs.writeFileSync(path.join(root, 'docs', 'x.js'), 'not precached');
  fs.writeFileSync(path.join(root, '.hidden.js'), 'x');
  const a = buildManifest(root);
  const b = buildManifest(root);
  assert.equal(a.text, b.text);
  assert.deepEqual(a.files, ['css/a.css', 'index.html', 'js/app.js', 'js/b.js']);
  const problems = checkImports(root, a.files);
  assert.ok(problems.some((p) => /c\.js.*does not exist/.test(p)));
  assert.ok(problems.some((p) => /d\.js.*does not exist/.test(p)));
  assert.ok(problems.some((p) => /absolute import "\/abs\.js"/.test(p)));
  assert.ok(problems.some((p) => /absolute import "https:/.test(p)));
  fs.writeFileSync(path.join(root, 'css', 'a.css'), 'a{color:red}');
  assert.notEqual(buildManifest(root).version, a.version, 'content change changes the cache name');
  fs.writeFileSync(path.join(root, 'js', 'new.js'), '');
  assert.ok(collectFiles(root).includes('js/new.js'));
});

// ---------------------------------------------------------------- 404.html

test('404.html: self-contained, relative, CSP hashes match the inline style and script', () => {
  const html = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  const { style, script } = computeHashes(html);
  assert.ok(html.includes(`style-src '${style}'`), 'style hash is current: run node scripts/stamp-404-csp.mjs');
  assert.ok(html.includes(`script-src '${script}'`), 'script hash is current: run node scripts/stamp-404-csp.mjs');
  assert.match(html, /default-src 'none'/);
  assert.equal(/(src|href)=["']https?:/.test(html), false, 'no external resources');
  assert.equal(/<link|<img|<script[^>]*src=/i.test(html), false);
  assert.match(html, /id="home" href="\.\/"/, 'works without JavaScript via a relative link');
  assert.equal(/garmin/i.test(html), false);
});

test('.nojekyll exists and is empty', () => {
  assert.equal(fs.statSync(path.join(ROOT, '.nojekyll')).size, 0);
});

// ---------------------------------------------------------------- sw.js behaviour (mocked service worker scope)

class MockCache {
  constructor() {
    this.map = new Map();
  }
  async put(req, res) {
    this.map.set(typeof req === 'string' ? req : req.url, res.clone());
  }
  matchSync(url, ignoreSearch) {
    const u = new URL(url);
    for (const [k, v] of this.map) {
      const ku = new URL(k);
      if (ignoreSearch ? ku.origin + ku.pathname === u.origin + u.pathname : k === url) return v.clone();
    }
    return undefined;
  }
}
function loadSw({ manifest, files = {}, scope = 'https://user.github.io/daybeat/', failUrl } = {}) {
  const listeners = {};
  const stores = new Map();
  const fetched = [];
  const caches = {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new MockCache());
      return stores.get(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async match(url, { cacheName, ignoreSearch } = {}) {
      const c = stores.get(cacheName);
      return c ? c.matchSync(typeof url === 'string' ? url : url.url, ignoreSearch) : undefined;
    },
  };
  const state = { skipWaiting: 0, claimed: 0 };
  const ctx = {
    URL,
    Request,
    Response,
    Promise,
    Error,
    console,
    caches,
    fetch: async (req) => {
      const url = typeof req === 'string' ? req : req.url;
      fetched.push(url);
      if (failUrl && url === failUrl) return new Response('nope', { status: 404 });
      if (url in files) return new Response(files[url], { status: 200 });
      return new Response('x', { status: 200 });
    },
    importScripts: () => {
      if (!manifest) throw new Error('no manifest');
      ctx.self.__DAYBEAT_PRECACHE = manifest;
    },
    addEventListener: (type, fn) => (listeners[type] = fn),
    registration: { scope },
    location: new URL(scope),
    clients: { claim: async () => state.claimed++ },
    skipWaiting: () => state.skipWaiting++,
  };
  ctx.self = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), ctx);
  return { listeners, caches, fetched, state, ctx };
}
const event = (extra = {}) => ({ waitUntil(p) { this.p = p; }, respondWith(p) { this.r = p; }, ...extra });
const MANIFEST = { version: 'abc123', files: ['index.html', 'js/app.js', 'css/a.css'] };
const SCOPE = 'https://user.github.io/daybeat/';

test('sw.js install: precaches every file relative to the scope with cache:reload, stores them under a versioned name', async () => {
  const sw = loadSw({ manifest: MANIFEST, files: { [SCOPE + 'index.html']: '<html>' } });
  const e = event();
  sw.listeners.install(e);
  await e.p;
  assert.deepEqual([...sw.caches.stores.keys()], ['daybeat-shell-abc123']);
  const cache = sw.caches.stores.get('daybeat-shell-abc123');
  assert.deepEqual([...cache.map.keys()].sort(), MANIFEST.files.map((f) => SCOPE + f).sort());
  assert.equal(sw.state.skipWaiting, 0, 'never skips waiting by itself: the user decides');
});

test('sw.js install: one failing file fails the whole install and leaves no half-filled cache', async () => {
  const sw = loadSw({ manifest: MANIFEST, failUrl: SCOPE + 'js/app.js' });
  const e = event();
  sw.listeners.install(e);
  await assert.rejects(e.p, /precache failed for js\/app\.js/);
  assert.equal(sw.caches.stores.size, 0);
});

test('sw.js activate: deletes only OLD caches with its own prefix, then claims clients', async () => {
  const sw = loadSw({ manifest: MANIFEST });
  for (const n of ['daybeat-shell-old1', 'daybeat-shell-abc123', 'other-app-cache', 'user-data']) await sw.caches.open(n);
  const e = event();
  sw.listeners.activate(e);
  await e.p;
  assert.deepEqual([...sw.caches.stores.keys()].sort(), ['daybeat-shell-abc123', 'other-app-cache', 'user-data']);
  assert.equal(sw.state.claimed, 1);
});

async function serve(sw, url, { method = 'GET', mode = 'cors' } = {}) {
  const req = new Request(url, { method });
  Object.defineProperty(req, 'mode', { value: mode });
  const e = event({ request: req });
  sw.listeners.fetch(e);
  return e.r ? e.r : null;
}

test('sw.js fetch: shell for navigations, cache-first for assets, ignores everything else', async () => {
  const sw = loadSw({ manifest: MANIFEST, files: { [SCOPE + 'index.html']: 'SHELL', [SCOPE + 'js/app.js']: 'APP' } });
  const i = event();
  sw.listeners.install(i);
  await i.p;
  sw.fetched.length = 0;
  for (const url of [SCOPE, SCOPE + 'index.html', SCOPE + '?utm=1', SCOPE + 'index.html?x=2#/today']) {
    const r = await (await serve(sw, url, { mode: 'navigate' }));
    assert.equal(await r.text(), 'SHELL', url);
  }
  assert.equal(await (await (await serve(sw, SCOPE + 'js/app.js?v=3'))).text(), 'APP');
  assert.equal(sw.fetched.length, 0, 'served from cache, no network');
  // not handled: other origin, non-GET, outside scope, sw files
  assert.equal(await serve(sw, 'https://evil.example/daybeat/js/app.js'), null);
  assert.equal(await serve(sw, SCOPE + 'js/app.js', { method: 'POST' }), null);
  assert.equal(await serve(sw, 'https://user.github.io/other-repo/index.html'), null);
  assert.equal(await serve(sw, SCOPE + 'sw.js'), null);
  assert.equal(await serve(sw, SCOPE + 'sw-manifest.js'), null);
  // a file that is not in the precache list goes to the network and is NOT cached
  const r = await serve(sw, SCOPE + 'extra/other.json');
  assert.equal(await (await r).text(), 'x');
  assert.equal(sw.caches.stores.get('daybeat-shell-abc123').map.has(SCOPE + 'extra/other.json'), false);
  // unknown page: network; offline -> shell
  sw.ctx.fetch = async () => { throw new TypeError('offline'); };
  const off = await serve(sw, SCOPE + 'typo/page', { mode: 'navigate' });
  assert.equal(await (await off).text(), 'SHELL');
  await assert.rejects(serve(sw, SCOPE + 'extra/other.json'), TypeError);
});

test('sw.js messages: SKIP_WAITING and GET_VERSION; junk is ignored', async () => {
  const sw = loadSw({ manifest: MANIFEST });
  sw.listeners.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(sw.state.skipWaiting, 1);
  const replies = [];
  sw.listeners.message({ data: { type: 'GET_VERSION' }, ports: [{ postMessage: (m) => replies.push(m) }] });
  assert.deepEqual(JSON.parse(JSON.stringify(replies)), [{ type: 'VERSION', version: 'abc123' }]);
  for (const junk of [null, 'SKIP_WAITING', 5, { type: 'EVAL', code: 'x' }, {}, []]) sw.listeners.message({ data: junk });
  sw.listeners.message({ data: { type: 'GET_VERSION' }, ports: [] });
  assert.equal(sw.state.skipWaiting, 1);
});

test('sw.js without a manifest installs, caches nothing and passes every request through', async () => {
  const sw = loadSw({ manifest: null });
  const i = event();
  sw.listeners.install(i);
  assert.equal(i.p, undefined);
  assert.equal(await serve(sw, SCOPE + 'index.html', { mode: 'navigate' }), null);
  assert.equal(sw.caches.stores.size, 0);
});

test('sw.js refuses absolute or foreign entries in the manifest', async () => {
  const sw = loadSw({ manifest: { version: 'v', files: ['/etc/passwd', 'https://evil.example/x.js', '../up.js', 'ok.js', 5, ''] } });
  const i = event();
  sw.listeners.install(i);
  await i.p;
  assert.deepEqual([...sw.caches.stores.get('daybeat-shell-v').map.keys()], [SCOPE + 'ok.js']);
});

test('sw.js works under a different sub-path and at a domain root', async () => {
  for (const scope of ['https://example.test/some/deep/path/', 'https://example.test/', 'http://localhost:8123/daybeat/']) {
    const sw = loadSw({ manifest: MANIFEST, scope });
    const i = event();
    sw.listeners.install(i);
    await i.p;
    const keys = [...sw.caches.stores.get('daybeat-shell-abc123').map.keys()];
    assert.ok(keys.every((k) => k.startsWith(scope)), scope);
    assert.equal(keys.length, 3);
  }
});
