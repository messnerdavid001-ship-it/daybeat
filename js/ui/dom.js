// Safe DOM builder. The ONLY way UI code should create elements.
//
//   h('div', { class: 'card', onclick: fn, 'aria-label': 'x' }, 'text', h('span', null, 'more'))
//
// Strings and numbers become TEXT NODES, so user-supplied text (event titles, message text,
// alarm labels, ICS fields, URL fragments) can never turn into markup. There is deliberately no
// `html` option. innerHTML is only used by icon() for compile-time constant SVG strings.

const SVG_NS = 'http://www.w3.org/2000/svg';

// URL attributes: after stripping control characters and spaces (browsers ignore tabs/newlines inside a
// scheme, so 'java\tscript:' would still run), any URL that carries a scheme must use a safe one.
// Relative URLs and '#' routes are fine; protocol-relative '//host' is not.
const HAS_SCHEME = /^[a-z][a-z0-9+.\-]*:/i;
const SAFE_SCHEME = /^(https:|mailto:|tel:|blob:|data:image\/)/i;
const BLOCKED_ATTRS = new Set(['srcdoc', 'formaction', 'xlink:href']);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class' || key === 'className') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'style') {
        if (typeof value !== 'object') continue;           // style strings are not accepted
        for (const [k, v] of Object.entries(value)) {
          if (k.startsWith('--')) el.style.setProperty(k, String(v)); else el.style[k] = v;
        }
      }
      else if (key.startsWith('on')) {
        if (typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
        // string-valued on* props would become inline handlers: ignored on purpose
      }
      else if (key === 'text') el.textContent = String(value);
      else if (key === 'html') throw new Error('h(): "html" is not supported on purpose; build elements instead.');
      else if (BLOCKED_ATTRS.has(key.toLowerCase())) continue;
      else if (key === 'href' || key === 'src' || key === 'action') {
        const clean = String(value).replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
        if (clean.startsWith('//') || (HAS_SCHEME.test(clean) && !SAFE_SCHEME.test(clean))) continue;
        el.setAttribute(key, String(value));
      }
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

// Static SVG markup (constants only!) -> element. Never pass user text here.
export function svgFromConstant(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild;
}

export { SVG_NS };

// SVG element builder for charts and rings. Attribute values are numbers/short strings we compute, never user text.
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  append(el, children);
  return el;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  return append(f, children);
}

// small helpers used across pages
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
