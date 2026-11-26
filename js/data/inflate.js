// Small pure-JavaScript DEFLATE decoder (RFC 1951), used as the fallback when DecompressionStream is missing or
// misbehaves (it is buggy on some older iOS versions). No dependencies. The output size is capped, so a zip bomb
// cannot exhaust memory: inflateRaw(src, maxOut) throws DataError('too_large') as soon as the cap is exceeded.

import { DataError } from './schema.js';

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const bad = (msg = 'The compressed data is damaged.') => new DataError('parse_error', msg);

function buildHuffman(lengths, n) {
  const count = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  let left = 1;
  for (let len = 1; len < 16; len++) {
    left = (left << 1) - count[len];
    if (left < 0) throw bad(); // over-subscribed
  }
  const offs = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  const symbol = new Uint16Array(n);
  for (let i = 0; i < n; i++) if (lengths[i] !== 0) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}

let FIXED = null;
function fixedTables() {
  if (FIXED) return FIXED;
  const l = new Uint8Array(288);
  l.fill(8, 0, 144);
  l.fill(9, 144, 256);
  l.fill(7, 256, 280);
  l.fill(8, 280, 288);
  const d = new Uint8Array(30).fill(5);
  FIXED = { lit: buildHuffman(l, 288), dist: buildHuffman(d, 30) };
  return FIXED;
}

/** Decode a raw DEFLATE stream (no zlib/gzip header). */
export function inflateRaw(src, maxOut = Infinity) {
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.min(Math.max(src.length * 3, 4096), Number.isFinite(maxOut) ? maxOut + 1 : 1 << 30));
  let outPos = 0;

  const bits = (n) => {
    while (bitCnt < n) {
      if (pos >= src.length) throw bad('The compressed data ends too early.');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = (h) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.count[len];
      if (code - count < first) return h.symbol[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw bad();
  };
  const reserve = (n) => {
    if (outPos + n <= out.length) return;
    if (outPos + n > maxOut) throw new DataError('too_large', 'The file expands to more data than this app will read.');
    const next = new Uint8Array(Math.min(Math.max(out.length * 2, outPos + n), Number.isFinite(maxOut) ? maxOut + 1 : 1 << 30));
    next.set(out.subarray(0, outPos));
    out = next;
  };

  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      bitCnt = 0;
      if (pos + 4 > src.length) throw bad('The compressed data ends too early.');
      const len = src[pos] | (src[pos + 1] << 8);
      const nlen = src[pos + 2] | (src[pos + 3] << 8);
      pos += 4;
      if (len !== (~nlen & 0xffff)) throw bad();
      if (pos + len > src.length) throw bad('The compressed data ends too early.');
      reserve(len);
      out.set(src.subarray(pos, pos + len), outPos);
      outPos += len;
      pos += len;
    } else if (type === 1 || type === 2) {
      let lit;
      let dist;
      if (type === 1) ({ lit, dist } = fixedTables());
      else {
        const nlen = bits(5) + 257;
        const ndist = bits(5) + 1;
        const ncode = bits(4) + 4;
        if (nlen > 286 || ndist > 30) throw bad();
        const cl = new Uint8Array(19);
        for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]] = bits(3);
        const clh = buildHuffman(cl, 19);
        const lengths = new Uint8Array(nlen + ndist);
        let i = 0;
        while (i < nlen + ndist) {
          const sym = decode(clh);
          if (sym < 16) lengths[i++] = sym;
          else {
            let prev = 0;
            let rep;
            if (sym === 16) {
              if (i === 0) throw bad();
              prev = lengths[i - 1];
              rep = 3 + bits(2);
            } else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            if (i + rep > nlen + ndist) throw bad();
            while (rep--) lengths[i++] = prev;
          }
        }
        if (lengths[256] === 0) throw bad();
        lit = buildHuffman(lengths.subarray(0, nlen), nlen);
        dist = buildHuffman(lengths.subarray(nlen), ndist);
      }
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) {
          reserve(1);
          out[outPos++] = sym;
        } else if (sym === 256) break;
        else {
          const s = sym - 257;
          if (s >= 29) throw bad();
          const len = LEN_BASE[s] + bits(LEN_EXTRA[s]);
          const ds = decode(dist);
          if (ds >= 30) throw bad();
          const d = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
          if (d > outPos) throw bad();
          reserve(len);
          for (let k = 0; k < len; k++) {
            out[outPos] = out[outPos - d];
            outPos++;
          }
        }
      }
    } else throw bad();
  }
  if (outPos > maxOut) throw new DataError('too_large', 'The file expands to more data than this app will read.');
  return out.slice(0, outPos);
}

let crcTable = null;
/** CRC-32 (the checksum zip files use). */
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
