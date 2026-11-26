/* Daybeat service worker: offline app shell with a versioned cache and a user-approved update.
 *
 * - The precache list and VERSION come from the GENERATED sw-manifest.js (node scripts/build-sw-manifest.mjs).
 *   VERSION is a content hash, so any deployed change to a shell file changes the cache name.
 * - Every URL is relative to this worker's scope, so it works under a GitHub Pages sub-path.
 * - A new worker waits until the page sends {type:'SKIP_WAITING'} (the user tapped "update"), so old HTML never mixes
 *   with new JavaScript. Each worker version only ever answers from its own complete cache.
 * - It only handles same-origin GET requests inside its scope and only ever caches its own precache list.
 *   Nothing user-specific (data lives in IndexedDB) can end up in CacheStorage.
 */
'use strict';

const PREFIX = 'daybeat-shell-'; // CacheStorage is shared by every page of the same origin: stay inside our prefix

let MANIFEST = null;
try {
  importScripts('./sw-manifest.js');
  MANIFEST = self.__DAYBEAT_PRECACHE || null;
} catch (err) {
  MANIFEST = null; // no manifest: install without precaching and pass every request through
}

const VERSION = MANIFEST && typeof MANIFEST.version === 'string' ? MANIFEST.version : 'none';
const CACHE = PREFIX + VERSION;
const FILES =
  MANIFEST && Array.isArray(MANIFEST.files)
    ? MANIFEST.files.filter((f) => typeof f === 'string' && f && !f.startsWith('/') && !f.includes('..') && !/^[a-z][a-z0-9+.-]*:/i.test(f))
    : [];
const SCOPE = self.registration.scope; // e.g. https://user.github.io/daybeat/
const abs = (rel) => new URL(rel, SCOPE).href;
const SHELL = abs('index.html');

/** Responses that were redirected cannot be used for navigations (Safari rejects them): copy to a clean one. */
async function clean(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (event) => {
  if (!FILES.length) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await Promise.all(
          FILES.map(async (f) => {
            // cache:'reload' skips the HTTP cache (GitHub Pages sends max-age=600) so we never store stale files
            const res = await fetch(new Request(abs(f), { cache: 'reload' }));
            if (!res.ok) throw new Error(`precache failed for ${f}: HTTP ${res.status}`);
            await cache.put(abs(f), await clean(res));
          }),
        );
      } catch (err) {
        await caches.delete(CACHE); // never leave a half-filled cache behind; the old worker keeps running
        throw err;
      }
      // No skipWaiting() here on purpose: the page decides when to switch (see the message handler).
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !FILES.length) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  const rel = url.href.slice(SCOPE.length).split(/[?#]/)[0];
  if (rel === 'sw.js' || rel === 'sw-manifest.js') return; // always straight from the network
  event.respondWith(handle(req, url, rel));
});

async function fromCache(href) {
  return caches.match(href, { cacheName: CACHE, ignoreSearch: true });
}

async function handle(req, url, rel) {
  if (req.mode === 'navigate') {
    if (rel === '' || rel === 'index.html') {
      const shell = await fromCache(SHELL);
      if (shell) return shell;
      return fetch(req);
    }
    // Any other page (for example a typo): ask the network (GitHub Pages answers with 404.html); offline -> app shell.
    try {
      return await fetch(req);
    } catch (err) {
      const shell = await fromCache(SHELL);
      if (shell) return shell;
      throw err;
    }
  }
  const hit = await fromCache(url.href);
  if (hit) return hit;
  return fetch(req); // not part of the shell: network only, never cached
}

self.addEventListener('message', (event) => {
  const d = event.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (d.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ type: 'VERSION', version: VERSION });
  }
});
