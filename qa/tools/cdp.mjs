// QA tool: tiny Chrome DevTools Protocol driver (no dependencies; Node 22+ global WebSocket).
// Launches a SEPARATE headless Chrome with a throw-away profile (never the user's profile), so service workers,
// offline, cache contents, console and network can be tested for real.
//
//   import { launchChrome } from './cdp.mjs';
//   const chrome = await launchChrome();           // { page(), close() }
//   const p = await chrome.page({ width: 375, height: 812, mobile: true });
//   await p.goto('http://127.0.0.1:1234/qa-sub/'); console.log(await p.eval('document.title'));
//   await chrome.close();                          // kills Chrome and deletes the temp profile

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchChrome({ args = [], colorScheme } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-sync', '--disable-component-update', '--metrics-recording-only', '--mute-audio', ...args, 'about:blank',
  ], { stdio: 'ignore' });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { /* not yet */ }
  }
  if (!port) { proc.kill(); throw new Error('Chrome did not start'); }
  const pages = [];
  const api = {
    port, profile,
    async page(opts = {}) {
      const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
      const info = await res.json();
      const p = new Page(info.webSocketDebuggerUrl, info.id, port);
      await p.ready();
      pages.push(p);
      if (opts.width) await p.viewport(opts.width, opts.height || 800, !!opts.mobile, opts.dpr || 2);
      if (opts.colorScheme || colorScheme) await p.colorScheme(opts.colorScheme || colorScheme);
      if (opts.reducedMotion) await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      if (opts.timezone) await p.send('Emulation.setTimezoneOverride', { timezoneId: opts.timezone });
      return p;
    },
    async close() {
      for (const p of pages) { try { p.ws.close(); } catch { /* ignore */ } }
      proc.kill('SIGTERM');
      await sleep(300);
      try { proc.kill('SIGKILL'); } catch { /* gone */ }
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
  return api;
}

class Page {
  constructor(wsUrl, id, port) {
    this.id = id; this.port = port; this.nextId = 1; this.pending = new Map(); this.handlers = new Map();
    this.console = []; this.requests = new Map(); this.failures = []; this.exceptions = [];
    this.ws = new WebSocket(wsUrl);
    this.opened = new Promise((res, rej) => { this.ws.addEventListener('open', res); this.ws.addEventListener('error', rej); });
    this.ws.addEventListener('message', (m) => this.#onMessage(JSON.parse(m.data)));
  }
  #onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { res, rej } = this.pending.get(msg.id); this.pending.delete(msg.id);
      if (msg.error) rej(new Error(`${msg.error.message} ${msg.error.data || ''}`)); else res(msg.result);
      return;
    }
    const { method, params } = msg;
    if (method === 'Runtime.consoleAPICalled') this.console.push({ type: params.type, text: params.args.map((a) => a.value ?? a.description ?? a.type).join(' ') });
    if (method === 'Runtime.exceptionThrown') this.exceptions.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
    if (method === 'Log.entryAdded') this.console.push({ type: params.entry.level, text: params.entry.text + (params.entry.url ? ' ' + params.entry.url : '') });
    if (method === 'Network.requestWillBeSent') this.requests.set(params.requestId, { url: params.request.url, method: params.request.method });
    if (method === 'Network.responseReceived') { const r = this.requests.get(params.requestId); if (r) { r.status = params.response.status; r.fromSW = params.response.fromServiceWorker; r.fromCache = params.response.fromDiskCache || params.response.fromPrefetchCache; } }
    if (method === 'Network.loadingFailed') { const r = this.requests.get(params.requestId); this.failures.push({ url: r?.url, error: params.errorText, canceled: params.canceled }); }
    for (const h of this.handlers.get(method) || []) h(params);
  }
  async ready() {
    await this.opened;
    for (const d of ['Page', 'Runtime', 'Network', 'Log']) await this.send(`${d}.enable`);
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(method, cb) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(cb); }
  once(method, timeout = 15000) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout waiting for ' + method)), timeout); this.on(method, (p) => { clearTimeout(t); res(p); }); }); }
  async goto(url, { wait = 'load', timeout = 20000 } = {}) {
    const loaded = this.once(wait === 'load' ? 'Page.loadEventFired' : 'Page.frameStoppedLoading', timeout);
    const r = await this.send('Page.navigate', { url });
    if (r.errorText) { return { error: r.errorText }; }
    await loaded.catch(() => {});
    return { ok: true };
  }
  async reload({ ignoreCache = false } = {}) { const loaded = this.once('Page.loadEventFired', 20000); await this.send('Page.reload', { ignoreCache }); await loaded.catch(() => {}); }
  async eval(expression, { awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async waitFor(expression, { timeout = 10000, every = 150 } = {}) {
    const t0 = Date.now();
    for (;;) {
      try { const v = await this.eval(expression); if (v) return v; } catch { /* page navigating */ }
      if (Date.now() - t0 > timeout) throw new Error('waitFor timed out: ' + expression);
      await sleep(every);
    }
  }
  async viewport(width, height, mobile = false, dpr = 2) { await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile }); if (mobile) await this.send('Emulation.setTouchEmulationEnabled', { enabled: true }); }
  async colorScheme(scheme) { await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }); }
  async offline(on) { await this.send('Network.emulateNetworkConditions', { offline: !!on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); }
  async screenshot(file, { fullPage = false } = {}) { const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return file; }
  async key(key, { code, modifiers = 0, text } = {}) {
    const keyCodes = { Tab: 9, Enter: 13, Escape: 27, ' ': 32 };
    const base = { key, code: code || key, windowsVirtualKeyCode: keyCodes[key] || key.toUpperCase().charCodeAt(0), modifiers };
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: text ?? (key.length === 1 ? key : key === 'Enter' ? '\r' : undefined) });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  async click(x, y) { for (const type of ['mousePressed', 'mouseReleased']) await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); }
  async setFiles(selector, files) {
    const { root } = await this.send('DOM.getDocument');
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    await this.send('DOM.setFileInputFiles', { nodeId, files });
  }
  async fetchSWState() {
    return this.eval(`(async () => { const reg = await navigator.serviceWorker.getRegistration(); const keys = await caches.keys(); const cache = {}; for (const k of keys) cache[k] = (await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname); return { scope: reg && reg.scope, script: reg && (reg.active || reg.waiting || reg.installing) && (reg.active || reg.waiting || reg.installing).scriptURL, active: reg && reg.active && reg.active.state, waiting: !!(reg && reg.waiting), controlled: !!navigator.serviceWorker.controller, cache }; })()`);
  }
}
export { sleep };
