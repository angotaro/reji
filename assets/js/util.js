// Shared helpers. html`` escapes every interpolation unless wrapped in raw().

export class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s ?? ''));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const part = (v) => {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
};

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}

/** Boolean attribute helper: attr('disabled', cond) */
export const attr = (name, on) => raw(on ? ` ${name}` : '');
export const pressed = (on) => raw(` aria-pressed="${on ? 'true' : 'false'}"`);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      console.warn('storage failed', e);
      return false;
    }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

export function uid(len = 12) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
}

export function randInt(min, max) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return min + (a[0] % (max - min + 1));
}

export const fmtInt = (n) => Math.trunc(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const yen = (n) => (Number(n) < 0 ? '-¥' : '¥') + fmtInt(Math.abs(Number(n) || 0));
export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const shortHash = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : '');
export const pad2 = (n) => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'sr-only';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

let toastTimer;
export function toast(msg, kind = 'info', ms = 2800) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function download(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function csv(rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    // Spreadsheet apps run cells that start with = + - @ as formulas; keep plain numbers as numbers.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// ---- compact URL-safe payloads (receipts travel inside the URL fragment) ----
export function b64urlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
export async function packJson(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    try { return 'z' + b64urlEncode(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch { /* fall through */ }
  }
  return 'j' + b64urlEncode(bytes);
}
export async function unpackJson(token) {
  const kind = token[0];
  let bytes = b64urlDecode(token.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'j') throw new Error('bad payload');
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Keep the screen awake while a QR is on display (no-op where unsupported). */
export function wakeLock() {
  let lock = null;
  let active = false;
  const acquire = async () => {
    try { if (active && 'wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
  };
  const onVis = () => acquire();
  return {
    on() { active = true; acquire(); document.addEventListener('visibilitychange', onVis); },
    off() { active = false; document.removeEventListener('visibilitychange', onVis); try { lock?.release(); } catch { /* ignore */ } lock = null; },
  };
}

/** For URLs shown as QR codes. LINE's QR reader then opens them in the phone's normal
 *  browser, where wallet apps can be reached and saved receipts live. Ignored elsewhere. */
export function forQr(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return url;
    u.searchParams.set('openExternalBrowser', '1');
    return u.toString();
  } catch { return url; }
}
/** Built-in browsers of LINE, Instagram, Facebook, Yahoo! JAPAN, the Google app, TikTok, KakaoTalk. */
export const inAppBrowser = (ua = globalThis.navigator?.userAgent || '') => /\bLine\/|Instagram|FBAN|FBAV|FB_IAB|YJApp|GSA\/|KAKAOTALK|BytedanceWebview|musical_ly/i.test(ua);

/** Words that make wallet phishing filters (MetaMask and others) treat a site address as
 *  impersonating a crypto brand. Returns the word found in the host name, or ''. */
const RISKY_HOST_WORDS = ['jpyc', 'metamask', 'hashport', 'rabby', 'trustwallet', 'coinbase', 'binance', 'okx', 'bitget', 'bybit', 'phantom',
  'ledger', 'opensea', 'uniswap', 'polygon', 'avalanche', 'kaia', 'usdc', 'usdt', 'tether', 'circle', 'coincheck', 'bitflyer',
  'walletconnect', 'reown', 'wallet', 'airdrop', 'claim', 'giveaway'];
export function riskyHost(host = globalThis.location?.hostname || '') {
  const own = String(host).toLowerCase().replace(/\.(pages|workers)\.dev$/, '').replace(/\.localhost$/, '');
  return RISKY_HOST_WORDS.find((w) => own.includes(w)) || '';
}

/** The register letter for a second device: none → B, A → B, B → C … */
export function nextTerminal(t) {
  const c = String(t || '').trim().toUpperCase();
  return /^[A-Y]$/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 1) : c === 'Z' ? 'Z' : 'B';
}
