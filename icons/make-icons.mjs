// Dependency-free app icon generator. Run:  node icons/make-icons.mjs
// Draws the mark with signed-distance shapes, supersamples it, and writes real PNGs
// using only Node's built-in zlib. Also writes icons/favicon.svg from the same numbers.
//
// The mark: a ring with a gap, and a dot riding in the gap (a day in progress).
// Outputs (all relative to this folder):
//   icon-192.png, icon-512.png     rounded corners, transparent outside  (manifest "any")
//   icon-maskable-512.png          full bleed, glyph inside the 80% safe zone (manifest "maskable")
//   apple-touch-icon.png (180)     full bleed, no transparency (iOS rounds it itself)
//   favicon-32.png, favicon.svg

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- design numbers (unit square, y down) ----
const C1 = [0x23, 0x27, 0x31];   // ink (top-left)
const C2 = [0x0f, 0x11, 0x15];   // deeper ink (bottom-right)
const RING = [0xf4, 0xf1, 0xea]; // warm off-white ring
const VOLT = [0xc6, 0xf4, 0x32]; // the dot: default accent
const RING_R = 0.235;            // ring radius
const RING_W = 0.064;            // half stroke width
const GAP_CENTER = 45;           // degrees clockwise from 12 o'clock
const GAP_HALF = 45;             // half gap, degrees (measured on the ring centre line)
const CORNER = 0.225;            // corner radius for rounded variants

const rad = (d) => (d * Math.PI) / 180;
const cx = 0.5, cy = 0.5;
// arc covers from (GAP_CENTER+GAP_HALF) clockwise to (GAP_CENTER-GAP_HALF)+360
const ARC_START = GAP_CENTER + GAP_HALF;
const ARC_END = GAP_CENTER - GAP_HALF + 360;
const pt = (deg, r = RING_R) => [cx + Math.sin(rad(deg)) * r, cy - Math.cos(rad(deg)) * r];
const P0 = pt(ARC_START), P1 = pt(ARC_END), DOT = pt(GAP_CENTER);

function sdArc(x, y) {
  const dx = x - cx, dy = y - cy;
  let a = (Math.atan2(dx, -dy) * 180) / Math.PI; // clockwise from up
  if (a < 0) a += 360;
  if (a < ARC_START) a += 360;
  const inside = a >= ARC_START && a <= ARC_END;
  if (inside) return Math.abs(Math.hypot(dx, dy) - RING_R) - RING_W;
  return Math.min(Math.hypot(x - P0[0], y - P0[1]), Math.hypot(x - P1[0], y - P1[1])) - RING_W;
}
const sdDot = (x, y) => Math.hypot(x - DOT[0], y - DOT[1]) - RING_W * 1.02;
const sdGlyph = (x, y) => Math.min(sdArc(x, y), sdDot(x, y));

function sdRoundRect(x, y) {
  const qx = Math.abs(x - 0.5) - (0.5 - CORNER);
  const qy = Math.abs(y - 0.5) - (0.5 - CORNER);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - CORNER;
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (e0, e1, v) => { const t = clamp01((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// colour of the background gradient at (x, y)
function background(x, y) {
  const t = clamp01((x * 0.45 + y * 0.9) / 1.35);
  let c = mix(C1, C2, smooth(0.05, 0.95, t));
  // soft light from the top-left, soft shade at the bottom-right
  const glow = 0.06 * Math.exp(-Math.hypot(x - 0.18, y - 0.1) * 3.2);
  c = mix(c, [255, 255, 255], glow);
  return c;
}

// one sample -> [r, g, b, a] (non-premultiplied, 0..255 / 0..1)
function sample(x, y, rounded) {
  const bgA = rounded ? (sdRoundRect(x, y) < 0 ? 1 : 0) : 1;
  let c = background(x, y);
  // soft shadow under the glyph
  const shadow = smooth(0.03, -0.01, sdGlyph(x - 0.004, y - 0.016));
  c = mix(c, [0, 0, 0], shadow * 0.35);
  // ring in off-white, dot in volt
  if (sdArc(x, y) < 0) c = RING;
  if (sdDot(x, y) < 0) c = VOLT;
  return [c[0], c[1], c[2], bgA];
}

function render(size, rounded, ss = 5) {
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          const s = sample(x, y, rounded);
          r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3];
        }
      }
      const n = ss * ss, o = (py * size + px) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

// ---- minimal PNG encoder ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(name, size, rounded) {
  const file = join(HERE, name);
  writeFileSync(file, encodePng(size, render(size, rounded)));
  console.log('wrote', name, `${size}x${size}`);
}

write('icon-192.png', 192, true);
write('icon-512.png', 512, true);
write('icon-maskable-512.png', 512, false);
write('apple-touch-icon.png', 180, false);
write('favicon-32.png', 32, true);

// ---- SVG favicon from the same numbers ----
const f = (n) => (n * 100).toFixed(2);
const s = RING_W * 2 * 100;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="App icon">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="rgb(${C1.join(',')})"/>
      <stop offset="1" stop-color="rgb(${C2.join(',')})"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="${(CORNER * 100).toFixed(1)}" fill="url(#g)"/>
  <path d="M ${f(P0[0])} ${f(P0[1])} A ${f(RING_R)} ${f(RING_R)} 0 1 1 ${f(P1[0])} ${f(P1[1])}" fill="none" stroke="rgb(${RING.join(',')})" stroke-width="${s.toFixed(2)}" stroke-linecap="round"/>
  <circle cx="${f(DOT[0])}" cy="${f(DOT[1])}" r="${(RING_W * 102).toFixed(2)}" fill="rgb(${VOLT.join(',')})"/>
</svg>
`;
writeFileSync(join(HERE, 'favicon.svg'), svg);
console.log('wrote favicon.svg');
