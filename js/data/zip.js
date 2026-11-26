// Minimal, defensive ZIP reader for Blobs/Files. Reads the central directory (including ZIP64), then reads and inflates
// ONLY the entries the caller asks for, by slicing the file (a multi-GB export is never loaded into memory).
// Limits: entry count, per-entry and total uncompressed size, nested depth. Inflate uses DecompressionStream when it
// works and falls back to the pure-JS decoder in inflate.js when it is missing, fails, or produces data with a bad CRC.

import { DataError, LIMITS } from './schema.js';
import { inflateRaw, crc32 } from './inflate.js';

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOC64 = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

const bad = (msg) => new DataError('parse_error', msg);

export function toBlob(input) {
  if (typeof Blob !== 'undefined' && input instanceof Blob) return input;
  if (input instanceof ArrayBuffer) return new Blob([input]);
  if (ArrayBuffer.isView(input)) return new Blob([input]);
  throw new DataError('bad_format', 'Pick the .zip file you downloaded from your account export.');
}

async function readRange(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

const num = (big) => {
  const n = Number(big);
  if (!Number.isSafeInteger(n)) throw bad('This zip file is too large to read.');
  return n;
};

const cleanName = (s) => s.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '').slice(0, 300);

/** Parse the central directory. Returns [{name, method, flags, crc, csize, usize, offset}] (names are cleaned). */
export async function listEntries(input, { maxEntries = LIMITS.zipEntries } = {}) {
  const blob = toBlob(input);
  if (blob.size < 22) throw bad('This file is too small to be a zip file.');
  const tailLen = Math.min(blob.size, 22 + 65535 + 20);
  const tailStart = blob.size - tailLen;
  const tail = await readRange(blob, tailStart, blob.size);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === SIG_EOCD && i + 22 + tv.getUint16(i + 20, true) <= tail.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad('This does not look like a zip file (no directory found). If it was downloaded in parts, pick each part separately.');
  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // ZIP64
    const locAt = eocd - 20;
    if (locAt < 0 || tv.getUint32(locAt, true) !== SIG_LOC64) throw bad('This zip file uses an unsupported layout.');
    const off64 = num(tv.getBigUint64(locAt + 8, true));
    const rec = await readRange(blob, off64, off64 + 56);
    const rv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
    if (rv.getUint32(0, true) !== SIG_EOCD64) throw bad('This zip file uses an unsupported layout.');
    count = num(rv.getBigUint64(32, true));
    cdSize = num(rv.getBigUint64(40, true));
    cdOffset = num(rv.getBigUint64(48, true));
  }
  if (count > maxEntries) throw new DataError('too_large', `This zip file holds more than ${maxEntries} files, which is more than a data export should have.`);
  if (cdSize > 64 * 1024 * 1024 || cdOffset + cdSize > blob.size) throw bad('The zip directory is damaged.');
  const cd = await readRange(blob, cdOffset, cdOffset + cdSize);
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const dec = new TextDecoder('utf-8', { fatal: false });
  const entries = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || dv.getUint32(p, true) !== SIG_CEN) throw bad('The zip directory is damaged.');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    let csize = dv.getUint32(p + 20, true);
    let usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let offset = dv.getUint32(p + 42, true);
    if (p + 46 + nameLen + extraLen + commentLen > cd.length) throw bad('The zip directory is damaged.');
    const name = cleanName(dec.decode(cd.subarray(p + 46, p + 46 + nameLen)));
    // ZIP64 extra field
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = dv.getUint16(e, true);
      const sz = dv.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (usize === 0xffffffff && q + 8 <= eEnd) {
          usize = num(dv.getBigUint64(q, true));
          q += 8;
        }
        if (csize === 0xffffffff && q + 8 <= eEnd) {
          csize = num(dv.getBigUint64(q, true));
          q += 8;
        }
        if (offset === 0xffffffff && q + 8 <= eEnd) offset = num(dv.getBigUint64(q, true));
      }
      e += 4 + sz;
    }
    entries.push({ name, method, flags, crc, csize, usize, offset, isDir: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateNative(u8, maxOut) {
  if (typeof DecompressionStream === 'undefined' || typeof ReadableStream === 'undefined') throw new Error('no native inflate');
  const src = new ReadableStream({
    start(c) {
      c.enqueue(u8);
      c.close();
    },
  });
  const reader = src.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxOut) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new DataError('too_large', 'The file expands to more data than this app will read.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * Read one entry's bytes. Throws DataError (parse_error / too_large / unsupported) for anything unusual.
 * stats (optional object) gets { fallbackInflate } incremented when the JS decoder was needed.
 */
export async function readEntry(input, entry, { maxBytes = LIMITS.zipEntryBytes, stats, forceFallback = false } = {}) {
  const blob = toBlob(input);
  if (entry.flags & 1) throw new DataError('parse_error', 'This file is password protected.');
  if (entry.usize > maxBytes || entry.csize > maxBytes) throw new DataError('too_large', 'This file inside the zip is too big to read.');
  if (entry.offset + 30 > blob.size) throw bad('The zip file is damaged.');
  const head = await readRange(blob, entry.offset, entry.offset + 30);
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (hv.getUint32(0, true) !== SIG_LOC) throw bad('The zip file is damaged.');
  const start = entry.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  if (start + entry.csize > blob.size) throw bad('The zip file is damaged (it may be cut off).');
  const raw = await readRange(blob, start, start + entry.csize);
  let out;
  if (entry.method === 0) out = raw;
  else if (entry.method === 8) {
    const cap = Math.min(maxBytes, entry.usize);
    let ok = false;
    if (!forceFallback) {
      try {
        out = await inflateNative(raw, cap);
        ok = out.length === entry.usize && crc32(out) === entry.crc;
      } catch (e) {
        if (e instanceof DataError && e.code === 'too_large') throw e;
      }
    }
    if (!ok) {
      out = inflateRaw(raw, cap);
      if (stats) stats.fallbackInflate = (stats.fallbackInflate || 0) + 1;
    }
  } else throw new DataError('parse_error', 'This file inside the zip uses a compression method this app does not read.');
  if (out.length !== entry.usize) throw bad('A file inside the zip has the wrong size (it may be damaged).');
  if (crc32(out) !== entry.crc) throw bad('A file inside the zip failed its checksum (it may be damaged).');
  return out;
}

/** The compressed/stored bytes of an entry as a Blob slice (no inflate); only valid for stored (method 0) entries. */
export async function storedEntryBlob(input, entry) {
  const blob = toBlob(input);
  const head = await readRange(blob, entry.offset, entry.offset + 30);
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (hv.getUint32(0, true) !== SIG_LOC) throw bad('The zip file is damaged.');
  const start = entry.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  if (start + entry.csize > blob.size) throw bad('The zip file is damaged (it may be cut off).');
  return blob.slice(start, start + entry.csize);
}
