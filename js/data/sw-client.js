// Page-side helper for the service worker: registration, "update ready" signal, safe reload, version lookup.
// Everything is relative to THIS file, so it works under a GitHub Pages sub-path.
//
//   const reg = await sw.register({ onUpdateReady(apply) {...}, onOfflineReady() {...}, onError(err) {...} });
//   reg.applyUpdate();   // user tapped "Reload for the new version"
//   await sw.version();  // build id of the active worker, or '' if there is none

const SW_URL = new URL('../../sw.js', import.meta.url).href;
const SCOPE_URL = new URL('../../', import.meta.url).href;
const MIN_CHECK_GAP_MS = 10 * 60 * 1000; // GitHub Pages caches sw.js for ~10 minutes anyway

let registration = null;

function supported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && (globalThis.isSecureContext !== false);
}

async function register({ onUpdateReady, onOfflineReady, onError } = {}) {
  if (!supported()) return { status: 'unsupported', applyUpdate() {}, checkNow: async () => {} };
  let applying = false;
  let notified = false;
  const safe = (fn, ...args) => {
    try {
      fn?.(...args);
    } catch (e) {
      console.error('[sw] callback failed', e);
    }
  };

  try {
    registration = await navigator.serviceWorker.register(SW_URL, { scope: SCOPE_URL });
  } catch (err) {
    safe(onError, err);
    return { status: 'error', error: err, applyUpdate() {}, checkNow: async () => {} };
  }
  const reg = registration;

  const applyUpdate = () => {
    const waiting = reg.waiting;
    if (!waiting) return;
    applying = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload when the user asked for the update. The very first install also claims the page; no reload then.
    if (applying) {
      applying = false;
      location.reload();
    }
  });

  const announceWaiting = () => {
    if (notified || !reg.waiting || !navigator.serviceWorker.controller) return;
    notified = true;
    safe(onUpdateReady, applyUpdate);
  };

  const watch = (worker) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') {
        if (navigator.serviceWorker.controller) announceWaiting();
        else safe(onOfflineReady);
      }
    });
  };

  if (reg.waiting) announceWaiting();
  else if (reg.installing) watch(reg.installing);
  else if (reg.active && !navigator.serviceWorker.controller) {
    // Active worker exists but does not control this page yet (first visit after install): it will claim shortly.
    navigator.serviceWorker.ready.then(() => safe(onOfflineReady)).catch(() => {});
  }
  reg.addEventListener('updatefound', () => {
    notified = false;
    watch(reg.installing);
  });

  let lastCheck = Date.now();
  const checkNow = async () => {
    lastCheck = Date.now();
    try {
      await reg.update();
    } catch {
      /* offline: nothing to do */
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck > MIN_CHECK_GAP_MS) checkNow();
    });
  }

  return { status: 'registered', applyUpdate, checkNow };
}

/** Build id of the worker controlling this page ('' when there is none or it does not answer). */
function version(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const worker = typeof navigator !== 'undefined' && navigator.serviceWorker?.controller;
    if (!worker) return resolve('');
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(''), timeoutMs);
    ch.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data && typeof e.data.version === 'string' ? e.data.version : '');
    };
    try {
      worker.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
    } catch {
      clearTimeout(timer);
      resolve('');
    }
  });
}

export const sw = { register, version };
