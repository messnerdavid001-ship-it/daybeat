// Progress ring (SVG) with a slot in the middle. value is 0..1.
import { h, s } from './dom.js';

export function ring({ value = 0, size = 96, stroke = 10, label = '', center = null, className = '', animate = true }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const arc = s('circle', {
    cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'url(#ring-grad)', 'stroke-width': stroke, 'stroke-linecap': 'round',
    'stroke-dasharray': c, 'stroke-dashoffset': animate ? c : c * (1 - Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))), transform: `rotate(-90 ${size / 2} ${size / 2})`, class: 'ring__arc',
  });
  const id = 'rg' + Math.random().toString(36).slice(2, 8);
  arc.setAttribute('stroke', `url(#${id})`);
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, 'aria-hidden': 'true', focusable: 'false' },
    s('defs', null,
      s('linearGradient', { id, x1: 0, y1: 0, x2: 1, y2: 1 },
        s('stop', { offset: '0', 'stop-color': 'var(--accent)' }),
        s('stop', { offset: '1', 'stop-color': 'var(--accent-2)' }),
      ),
    ),
    s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--surface-3)', 'stroke-width': stroke }),
    arc,
  );
  const el = h('div', { class: 'ring ' + className, role: label ? 'img' : null, 'aria-label': label || null, style: { width: size + 'px', height: size + 'px' } },
    svg,
    center ? h('div', { class: 'ring__center' }, center) : null,
  );
  // animate in on the next frame (skipped when re-rendering an already visible page)
  if (animate) requestAnimationFrame(() => requestAnimationFrame(() => { arc.setAttribute('stroke-dashoffset', String(c * (1 - v))); }));
  return el;
}
