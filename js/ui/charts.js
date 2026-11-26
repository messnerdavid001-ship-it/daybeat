// Small bar charts for daily numbers (steps, sleep, heart rate). Drawn as SVG from numbers we compute; never from user text.
import { h, s } from './dom.js';
import { icon } from './icons.js';
import { fmtDate, dateOfKey } from './format.js';

/** rows = [{ date, letter, <key>: number|null }]. Missing days draw as a thin grey stub so gaps are honest. */
export function bars({ rows, key, label, zero = true, goal = null }) {
  const vals = rows.map((r) => (Number.isFinite(r[key]) ? r[key] : null));
  const known = vals.filter((v) => v !== null);
  const max = Math.max(1, ...known, goal || 0);
  const lo = zero ? 0 : Math.min(...known) * 0.8;
  const W = 300, H = 110, pad = 4, bw = (W - pad * 2) / rows.length;
  const gap = rows.length > 40 ? 0.1 : 0.14;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H + 18}`, class: 'chart', role: 'img', 'aria-label': label, focusable: 'false' });
  if (goal) {
    const gy = H - ((goal - lo) / (max - lo || 1)) * (H - 6);
    svg.appendChild(s('line', { x1: 0, x2: W, y1: gy, y2: gy, stroke: 'var(--line-strong)', 'stroke-dasharray': '4 4', 'stroke-width': 1 }));
  }
  const every = rows.length > 45 ? 14 : rows.length > 20 ? 7 : 2;
  rows.forEach((r, i) => {
    const v = vals[i];
    const x = pad + i * bw + bw * gap, w = bw * (1 - gap * 2);
    if (v === null) svg.appendChild(s('rect', { x, y: H - 3, width: Math.max(1, w), height: 3, rx: 1.5, fill: 'var(--surface-3)' }));
    else {
      const bh = Math.max(3, ((v - lo) / (max - lo || 1)) * (H - 6));
      const hit = goal && v >= goal;
      svg.appendChild(s('rect', { x, y: H - bh, width: Math.max(1, w), height: bh, rx: Math.min(4, w / 2), fill: i === rows.length - 1 || hit ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 45%, var(--surface-3))' }));
    }
    if ((rows.length - 1 - i) % every === 0) svg.appendChild(s('text', { x: x + w / 2, y: H + 14, 'text-anchor': 'middle', fill: 'var(--text-3)', 'font-size': 10, 'font-weight': 700 }, r.letter));
  });
  return svg;
}

export function trendCard({ title, iconName, rows, key, fmt, unit, zero = true, goal = null, daysLabel }) {
  const have = rows.filter((r) => Number.isFinite(r[key]));
  if (!have.length) return null;
  const avg = Math.round(have.reduce((n, r) => n + r[key], 0) / have.length);
  const last = have[have.length - 1][key];
  const bestRow = have.reduce((a, b) => (b[key] > a[key] ? b : a));
  const label = `${title}, ${daysLabel}. Latest ${fmt(last)}${unit ? ' ' + unit : ''}. Average ${fmt(avg)}${unit ? ' ' + unit : ''}. Highest ${fmt(bestRow[key])}${unit ? ' ' + unit : ''} on ${fmtDate(dateOfKey(bestRow.date))}.`;
  return h('section', { class: 'card trend', 'aria-label': title },
    h('div', { class: 'section-head' }, h('h2', { class: 'card__title' }, h('span', { class: 'trend__icon' }, icon(iconName)), title), h('span', { class: 'chip chip--accent' }, 'Avg ' + fmt(avg))),
    h('p', { class: 'trend__big num' }, fmt(last), unit ? h('small', null, ' ' + unit) : null),
    bars({ rows, key, label, zero, goal }),
  );
}
