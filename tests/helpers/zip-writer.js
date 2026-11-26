// Tiny zip WRITER for tests (stored/deflate, optional ZIP64 records, optional lies about sizes). Node only.
import zlib from 'node:zlib';
import { crc32 } from '../../js/data/inflate.js';

const enc = new TextEncoder();
const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u64 = (n) => [...u32(n % 2 ** 32), ...u32(Math.floor(n / 2 ** 32))];

/** files: [{name, data: string|Uint8Array, method?: 'store'|'deflate', lieUsize?: number, flags?: number, level?: number}] */
export function makeZip(files, { zip64 = false, comment = '' } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  const push = (arr) => {
    const u = arr instanceof Uint8Array ? arr : Uint8Array.from(arr);
    parts.push(u);
    offset += u.length;
  };
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const method = f.method === 'store' ? 0 : 8;
    const body = method === 0 ? data : zlib.deflateRawSync(data, { level: f.level ?? 6 });
    const crc = crc32(data);
    const usize = f.lieUsize ?? data.length;
    const flags = f.flags ?? 0x0800;
    const localOffset = offset;
    push([...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(body.length), ...u32(usize), ...u16(name.length), ...u16(0)]);
    push(name);
    push(body);
    const extra = zip64 ? Uint8Array.from([...u16(1), ...u16(24), ...u64(usize), ...u64(body.length), ...u64(localOffset)]) : new Uint8Array(0);
    central.push({ name, method, flags, crc, csize: body.length, usize, localOffset, extra });
  }
  const cdStart = offset;
  for (const c of central) {
    push([
      ...u32(0x02014b50), ...u16(45), ...u16(20), ...u16(c.flags), ...u16(c.method), ...u16(0), ...u16(0x21), ...u32(c.crc),
      ...u32(zip64 ? 0xffffffff : c.csize), ...u32(zip64 ? 0xffffffff : c.usize), ...u16(c.name.length), ...u16(c.extra.length), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(zip64 ? 0xffffffff : c.localOffset),
    ]);
    push(c.name);
    push(c.extra);
  }
  const cdSize = offset - cdStart;
  const cm = enc.encode(comment);
  if (zip64) {
    const eocd64At = offset;
    push([...u32(0x06064b50), ...u64(44), ...u16(45), ...u16(45), ...u32(0), ...u32(0), ...u64(central.length), ...u64(central.length), ...u64(cdSize), ...u64(cdStart)]);
    push([...u32(0x07064b50), ...u32(0), ...u64(eocd64At), ...u32(1)]);
    push([...u32(0x06054b50), ...u16(0xffff), ...u16(0xffff), ...u16(0xffff), ...u16(0xffff), ...u32(0xffffffff), ...u32(0xffffffff), ...u16(cm.length)]);
  } else {
    push([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cdSize), ...u32(cdStart), ...u16(cm.length)]);
  }
  push(cm);
  const out = new Uint8Array(offset);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
