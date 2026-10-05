// AVIF without a library. The browser's own AV1 video encoder (WebCodecs) makes a
// single key frame, and av1ToAvif() wraps it in the small still-image container
// AVIF uses (HEIF / ISO-BMFF boxes). Browsers that cannot encode AV1 get null, and
// the caller falls back to PNG or JPEG.

const CODEC = 'av01.0.04M.08'; // AV1 Main profile, level 3.0, Main tier, 8-bit

let mode; // 'quantizer' | 'variable' | '' (unsupported)
export async function avifEncodable() {
  if (mode !== undefined) return !!mode;
  mode = '';
  try {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return false;
    for (const bitrateMode of ['quantizer', 'variable']) {
      const r = await VideoEncoder.isConfigSupported({ codec: CODEC, width: 256, height: 256, bitrate: 400_000, bitrateMode, framerate: 1 });
      if (r.supported) { mode = bitrateMode; break; }
    }
  } catch { mode = ''; }
  return !!mode;
}

/**
 * Encodes a canvas (even width and height, no transparency) to AVIF bytes.
 * quality 0…1 (higher is better and larger). Resolves null when not possible.
 */
export async function canvasToAvif(canvas, quality = 0.6) {
  if (!(await avifEncodable())) return null;
  const { width, height } = canvas;
  const chunks = [];
  let failed = false;
  const enc = new VideoEncoder({
    output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); chunks.push(b); },
    error: () => { failed = true; },
  });
  try {
    const q = Math.round(63 * (1 - Math.min(1, Math.max(0, quality)))); // AV1 quantizer 0 (best) … 63
    enc.configure({ codec: CODEC, width, height, framerate: 1, bitrateMode: mode,
      ...(mode === 'variable' ? { bitrate: Math.round(width * height * (0.5 + 6 * quality)) } : {}) });
    const frame = new VideoFrame(canvas, { timestamp: 0, alpha: 'discard' });
    enc.encode(frame, mode === 'quantizer' ? { keyFrame: true, av1: { quantizer: q } } : { keyFrame: true });
    frame.close();
    await enc.flush();
  } catch {
    failed = true;
  } finally {
    try { enc.close(); } catch { /* already closed */ }
  }
  if (failed || !chunks.length) return null;
  try { return av1ToAvif(chunks[0], width, height); } catch { return null; }
}

// ---------- AV1 bitstream: OBUs and the sequence header ----------
function leb128(b, i) {
  let v = 0;
  for (let k = 0; k < 8; k++) {
    const x = b[i + k];
    if (x === undefined) throw new Error('truncated');
    v += (x & 0x7f) * 2 ** (7 * k);
    if (!(x & 0x80)) return [v, k + 1];
  }
  throw new Error('leb128');
}

/** Splits an AV1 temporal unit (low-overhead format) into OBUs. */
export function obus(b) {
  const out = [];
  let i = 0;
  while (i < b.length) {
    const h = b[i];
    if (h & 0x80) throw new Error('forbidden bit');
    const type = (h >> 3) & 15;
    const ext = (h >> 2) & 1;
    let p = i + 1 + ext;
    let size;
    if ((h >> 1) & 1) {
      const [v, n] = leb128(b, p);
      size = v;
      p += n;
    } else {
      size = b.length - p;
    }
    if (p + size > b.length) throw new Error('truncated');
    out.push({ type, start: i, payload: p, end: p + size });
    i = p + size;
  }
  return out;
}

class Bits {
  constructor(b, start, end) { this.b = b; this.pos = start * 8; this.end = end * 8; }
  f(n) {
    let v = 0;
    for (let k = 0; k < n; k++) {
      if (this.pos >= this.end) throw new Error('eof');
      v = v * 2 + ((this.b[this.pos >> 3] >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
  uvlc() {
    let lz = 0;
    while (!this.f(1)) if (++lz >= 32) return 2 ** 32 - 1;
    return this.f(lz) + 2 ** lz - 1;
  }
}

/** The fields of an AV1 sequence header that the AVIF container repeats (AV1 spec 5.5). */
export function sequenceHeader(b, o) {
  const r = new Bits(b, o.payload, o.end);
  const s = { profile: r.f(3), level: 0, tier: 0 };
  r.f(1); // still_picture
  const reduced = r.f(1);
  if (reduced) {
    s.level = r.f(5);
  } else {
    let decoderModel = 0;
    let bufLen = 0;
    if (r.f(1)) { // timing_info_present_flag
      r.f(32); r.f(32);
      if (r.f(1)) r.uvlc();
      decoderModel = r.f(1);
      if (decoderModel) { bufLen = r.f(5) + 1; r.f(32); r.f(5); r.f(5); }
    }
    const initialDelay = r.f(1);
    const count = r.f(5) + 1;
    for (let k = 0; k < count; k++) {
      r.f(12);
      const level = r.f(5);
      const tier = level > 7 ? r.f(1) : 0;
      if (k === 0) { s.level = level; s.tier = tier; }
      if (decoderModel && r.f(1)) { r.f(bufLen); r.f(bufLen); r.f(1); }
      if (initialDelay && r.f(1)) r.f(4);
    }
  }
  const wb = r.f(4) + 1;
  const hb = r.f(4) + 1;
  r.f(wb); r.f(hb);
  if (!reduced && r.f(1)) { r.f(4); r.f(3); } // frame id numbers
  r.f(3); // 128x128 superblocks, filter intra, intra edge filter
  if (!reduced) {
    r.f(4); // interintra, masked compound, warped motion, dual filter
    const orderHint = r.f(1);
    if (orderHint) r.f(2);
    const screenContent = r.f(1) ? 2 : r.f(1);
    if (screenContent > 0 && !r.f(1)) r.f(1);
    if (orderHint) r.f(3);
  }
  r.f(3); // superres, cdef, restoration
  s.high = r.f(1);
  s.twelve = s.profile === 2 && s.high ? r.f(1) : 0;
  s.depth = s.twelve ? 12 : s.high ? 10 : 8;
  s.mono = s.profile === 1 ? 0 : r.f(1);
  s.desc = r.f(1);
  [s.cp, s.tc, s.mc] = s.desc ? [r.f(8), r.f(8), r.f(8)] : [2, 2, 2];
  s.sx = 1; s.sy = 1; s.csp = 0;
  if (s.mono) {
    s.range = r.f(1);
  } else if (s.cp === 1 && s.tc === 13 && s.mc === 0) {
    s.range = 1; s.sx = 0; s.sy = 0;
  } else {
    s.range = r.f(1);
    if (s.profile === 1) { s.sx = 0; s.sy = 0; } else if (s.profile === 2) {
      if (s.depth === 12) { s.sx = r.f(1); s.sy = s.sx ? r.f(1) : 0; } else { s.sx = 1; s.sy = 0; }
    }
    if (s.sx && s.sy) s.csp = r.f(2);
  }
  return s;
}

// ---------- the AVIF container ----------
const u8 = (...a) => Uint8Array.from(a);
const u16 = (v) => u8((v >> 8) & 255, v & 255);
const u32 = (v) => u8((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
const txt = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const cat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
const box = (type, ...parts) => { const body = cat(parts); return cat([u32(8 + body.length), txt(type), body]); };
const fullBox = (type, version, ...parts) => box(type, u8(version, 0, 0, 0), ...parts);

/** Wraps one AV1 key frame (a temporal unit) as a single-image AVIF file. */
export function av1ToAvif(tu, width, height) {
  const list = obus(tu);
  const seq = list.find((o) => o.type === 1);
  if (!seq || !list.some((o) => o.type === 6 || o.type === 3)) throw new Error('not an AV1 key frame');
  const s = sequenceHeader(tu, seq);
  const data = cat(list.filter((o) => o.type !== 2 && o.type !== 15).map((o) => tu.subarray(o.start, o.end))); // no temporal delimiters or padding
  const props = [
    fullBox('ispe', 0, u32(width), u32(height)),
    fullBox('pixi', 0, s.mono ? u8(1, s.depth) : u8(3, s.depth, s.depth, s.depth)),
    box('av1C', u8(0x81, (s.profile << 5) | s.level, (s.tier << 7) | (s.high << 6) | (s.twelve << 5) | (s.mono << 4) | (s.sx << 3) | (s.sy << 2) | s.csp, 0), tu.subarray(seq.start, seq.end)),
  ];
  if (s.desc) props.push(box('colr', txt('nclx'), u16(s.cp), u16(s.tc), u16(s.mc), u8(s.range << 7)));
  const ipma = fullBox('ipma', 0, u32(1), u16(1), u8(props.length), ...props.map((_, k) => u8((k === 2 ? 0x80 : 0) | (k + 1)))); // av1C is essential
  const ftyp = box('ftyp', txt('avif'), u32(0), txt('avif'), txt('mif1'), txt('miaf'));
  const meta = (offset) => fullBox('meta', 0,
    fullBox('hdlr', 0, u32(0), txt('pict'), u32(0), u32(0), u32(0), u8(0)),
    fullBox('pitm', 0, u16(1)),
    fullBox('iloc', 0, u8(0x44, 0x00), u16(1), u16(1), u16(0), u16(1), u32(offset), u32(data.length)),
    fullBox('iinf', 0, u16(1), fullBox('infe', 2, u16(1), u16(0), txt('av01'), u8(0))),
    box('iprp', box('ipco', ...props), ipma));
  const offset = ftyp.length + meta(0).length + 8; // where the image data starts, inside 'mdat'
  return cat([ftyp, meta(offset), box('mdat', data)]);
}
