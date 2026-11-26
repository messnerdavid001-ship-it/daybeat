// QA tool: paste/evaluate in the page (Browser pane javascript_tool). Returns a JSON-serialisable report.
// Usage: inject as <script src="qa/tools/dom-audit.js"> (CSP allows 'self'), then call window.__qaDomAudit() -> JSON string.
window.__qaDomAudit = () => {
  const issues = [];
  const add = (level, id, msg, el) => issues.push({ level, id, msg, el: el ? describe(el) : undefined });
  const describe = (el) => {
    const t = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return t + id + cls + (el.textContent ? ` "${el.textContent.trim().slice(0, 30)}"` : '');
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0;
  };

  // accessible name
  const nameOf = (el) => {
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map((i) => document.getElementById(i)?.textContent || '').join(' ').trim(); if (t) return t; }
    if (el.labels && el.labels.length) return [...el.labels].map((l) => l.textContent).join(' ').trim();
    const t = el.textContent.trim();
    if (t) return t;
    const img = el.querySelector('img[alt]'); if (img && img.alt.trim()) return img.alt.trim();
    const title = el.getAttribute('title'); if (title) return title;
    return '';
  };
  document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=link], input:not([type=hidden]), select, textarea, summary').forEach((el) => {
    if (!visible(el)) return;
    if (!nameOf(el)) add('FAIL', 'C2', 'interactive element has no accessible name', el);
  });
  document.querySelectorAll('img').forEach((el) => { if (!el.hasAttribute('alt')) add('FAIL', 'C2', 'img without alt attribute', el); });
  document.querySelectorAll('svg').forEach((el) => {
    if (!visible(el)) return;
    const hidden = el.closest('[aria-hidden=true]') || el.getAttribute('aria-hidden') === 'true';
    const labelled = el.getAttribute('aria-label') || el.querySelector('title');
    const inNamed = el.closest('button,a,[role=button]') && nameOf(el.closest('button,a,[role=button]'));
    if (!hidden && !labelled && !inNamed) add('WARN', 'C8', 'svg neither aria-hidden nor labelled', el);
  });

  // structure
  const h1 = [...document.querySelectorAll('h1')].filter(visible);
  if (h1.length !== 1) add('FAIL', 'C3', `visible h1 count = ${h1.length} (expect 1)`);
  if (!document.querySelector('main, [role=main]')) add('FAIL', 'C3', 'no <main> landmark');
  if (!document.querySelector('nav, [role=navigation]')) add('FAIL', 'C3', 'no <nav> landmark');
  if (!document.title.trim()) add('FAIL', 'C3', 'empty document.title');
  if (!document.documentElement.lang) add('WARN', 'C3', '<html lang> missing');
  const ids = {}; document.querySelectorAll('[id]').forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; });
  Object.entries(ids).filter(([, n]) => n > 1).forEach(([id, n]) => add('WARN', 'C', `duplicate id "${id}" x${n}`));
  document.querySelectorAll('[aria-hidden=true] a, [aria-hidden=true] button, [aria-hidden=true] input').forEach((el) => add('FAIL', 'C8', 'focusable element inside aria-hidden', el));

  // horizontal overflow
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) add('FAIL', 'B1', `page scrolls horizontally: scrollWidth ${de.scrollWidth} > clientWidth ${de.clientWidth}`);
  const over = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (!visible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.left < -1) {
      // ignore elements that are inside a horizontally scrollable container on purpose
      let p = el.parentElement, scroller = false;
      while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll' || o === 'hidden') && p.scrollWidth > p.clientWidth) { scroller = true; break; } p = p.parentElement; }
      if (!scroller) over.push(el);
    }
  });
  over.slice(0, 8).forEach((el) => add('FAIL', 'B1', `element extends beyond viewport (${Math.round(el.getBoundingClientRect().left)}..${Math.round(el.getBoundingClientRect().right)} of ${innerWidth})`, el));

  // tap targets (44px guideline on touch UIs)
  let small = 0;
  document.querySelectorAll('button, a[href], [role=button], [role=tab], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, summary').forEach((el) => {
    if (!visible(el)) return;
    const r = el.getBoundingClientRect();
    if ((r.width < 44 || r.height < 44) && getComputedStyle(el).display !== 'inline') { small++; if (small <= 8) add('WARN', 'B1', `tap target ${Math.round(r.width)}x${Math.round(r.height)} < 44x44`, el); }
  });
  if (small > 8) add('WARN', 'B1', `... and ${small - 8} more small tap targets`);

  // small text, input zoom
  let tiny = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || !visible(el)) continue;
    seen.add(el);
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) { tiny++; if (tiny <= 5) add('WARN', 'C4', `text ${fs}px < 12px`, el); }
  }
  document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea').forEach((el) => {
    if (!visible(el)) return;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) add('FAIL', 'A5', `form control font-size ${fs}px < 16px (iOS zooms on focus)`, el);
  });

  // contrast
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // gradient/image: cannot judge
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    // default canvas follows color-scheme
    if (matchMedia('(prefers-color-scheme: dark)').matches && !stack.length) base = { r: 0, g: 0, b: 0, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
    return base;
  };
  let low = 0; const checked = new Set();
  const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w2.nextNode()) {
    const n = w2.currentNode; if (!n.nodeValue.trim()) continue;
    const el = n.parentElement; if (!el || checked.has(el) || !visible(el)) continue;
    checked.add(el);
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color); const bg = bgOf(el);
    if (!fg || !bg) continue;
    const f = fg.a < 1 ? blend(fg, bg) : fg;
    const L1 = lum(f), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need) { low++; if (low <= 10) add('FAIL', 'C4', `contrast ${ratio.toFixed(2)}:1 < ${need}:1 (${cs.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}))`, el); }
  }
  if (low > 10) add('FAIL', 'C4', `... and ${low - 10} more low-contrast text elements`);

  // focus visibility: check that focus ring is not suppressed on tabbable elements (computed outline when :focus-visible cannot be forced; so test by focusing)
  const tabbables = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((e) => visible(e) && e.tabIndex >= 0 && !e.disabled).slice(0, 25);
  let noRing = 0;
  tabbables.forEach((el) => {
    const before = getComputedStyle(el);
    const b = { o: before.outlineStyle + before.outlineWidth + before.outlineColor, s: before.boxShadow, bd: before.borderColor, bg: before.backgroundColor };
    el.focus({ focusVisible: true });
    const a = getComputedStyle(el);
    const af = { o: a.outlineStyle + a.outlineWidth + a.outlineColor, s: a.boxShadow, bd: a.borderColor, bg: a.backgroundColor };
    const same = b.o === af.o && b.s === af.s && b.bd === af.bd && b.bg === af.bg;
    const hasOutline = a.outlineStyle !== 'none' && parseFloat(a.outlineWidth) > 0;
    if (same && !hasOutline) { noRing++; if (noRing <= 6) add('WARN', 'C1', 'no visible style change on keyboard focus (manual check: :focus-visible may need real key events)', el); }
    el.blur();
  });

  // user text sinks: any element containing raw '<' text means it was escaped (good); any script/handler injected is bad
  document.querySelectorAll('body script').forEach((s) => { if (!s.src && !/^(application\/(ld\+)?json|importmap)$/.test(s.type)) add('REVIEW', 'E1', 'inline script in body', s); });
  document.querySelectorAll('[onclick],[onerror],[onload],[onmouseover],[onfocus]').forEach((el) => add('FAIL', 'E1', 'inline event handler attribute present at runtime (possible injection)', el));
  document.querySelectorAll('a[href^="javascript:" i]').forEach((el) => add('FAIL', 'E1', 'javascript: link at runtime', el));
  document.querySelectorAll('img[src^="http"], link[href^="http"], script[src^="http"], iframe[src^="http"]').forEach((el) => add('FAIL', 'I4', 'third-party resource element', el));

  // misc facts
  const facts = {
    url: location.href, title: document.title, viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    standalone: matchMedia('(display-mode: standalone)').matches, dark: matchMedia('(prefers-color-scheme: dark)').matches,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    sw: 'serviceWorker' in navigator, h1: h1.map((e) => e.textContent.trim().slice(0, 40)),
  };
  const counts = issues.reduce((a, i) => (a[i.level] = (a[i.level] || 0) + 1, a), {});
  return JSON.stringify({ facts, counts, issues }, null, 1);
};
