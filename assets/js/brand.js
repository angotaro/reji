// Store branding: a logo, an accent colour and a link (plus the receipt message).
// The register keeps them on its own device. Customers' phones get them from a
// small profile the store signs and publishes on the public Nostr relays: the pay
// QR carries only a pointer (the profile's public key) and the colour, so there is
// no server, and nobody else can publish a profile under that key.
import { store, b64urlEncode } from './util.js';
import { CHAINS, resolveChain } from './config.js';
import { isAddress, sameAddress, checksum } from './evm.js';
import { recoverPersonal } from './secp256k1.js';
import { parseOwnerMessage } from './ownermsg.js';
import { canvasToAvif } from './avif.js';

export const BRAND_KIND = 30078; // NIP-78 application data; relays keep the latest one
export const BRAND_D = 'reji-brand';
export const LOGO_MAX = 32000; // characters of the image data URL (fits one relay message easily)
export const DEFAULT_COLOR = '#22305A';
const KEY = 'reji:brandkey:v1';
const SENT = 'reji:brandsent:v1';
const CACHE = 'reji:brands:v1';

/** [colour, name] — '' means the standard Reji indigo. All read well with white text. */
export const PRESETS = [
  ['', 'ai'], ['#3F7D4E', 'matcha'], ['#1F5E4B', 'forest'], ['#B23A2E', 'shu'], ['#A8325E', 'beni'],
  ['#6B4AA8', 'murasaki'], ['#1E5FA8', 'ruri'], ['#0E6E78', 'asagi'], ['#7A5418', 'cha'], ['#333333', 'sumi'],
];

const LOGO_RE = /^data:image\/(?:avif|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
export const validLogo = (v) => (typeof v === 'string' && v.length <= LOGO_MAX && LOGO_RE.test(v) ? v : '');
export const validColor = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : '');
export function validLink(v) {
  const s = String(v || '').trim();
  if (!s || s.length > 200) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && /\.[a-z]{2,}$/i.test(u.hostname) && !u.username && !u.password ? u.href : '';
  } catch {
    return '';
  }
}
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n);
/** Like clean(), but keeps line breaks (at most one blank line in a row). */
const cleanText = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').slice(0, n);
const cleanLinks = (list) => [...new Set((Array.isArray(list) ? list : []).map(validLink).filter(Boolean))].slice(0, 4);
/** The store's links: the receipt link first, then the rest; https only, no repeats, at most four. */
export const mergeLinks = (first, links) => cleanLinks([first, ...(Array.isArray(links) ? links : [])]);
/** "秋のクリエイター市　A-12": event name and space, joined with a full-width space. */
export const eventLine = (ev) => [ev?.name, ev?.space].map((x) => String(x || '').trim()).filter(Boolean).join('\u3000');

const SITES = [[/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)(x|twitter)\.com$/, 'X'], [/(^|\.)(line\.me|lin\.ee)$/, 'LINE'],
  [/(^|\.)facebook\.com$/, 'Facebook'], [/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)booth\.pm$/, 'BOOTH'], [/(^|\.)pixiv\.net$/, 'pixiv'], [/(^|\.)fanbox\.cc$/, 'pixivFANBOX'], [/(^|\.)skeb\.jp$/, 'Skeb'],
  [/(^|\.)fantia\.jp$/, 'Fantia'], [/(^|\.)note\.com$/, 'note'], [/(^|\.)bsky\.app$/, 'Bluesky'], [/(^|\.)threads\.(net|com)$/, 'Threads'],
  [/(^|\.)misskey\.io$/, 'Misskey'], [/(^|\.)twitch\.tv$/, 'Twitch'], [/(^|\.)soundcloud\.com$/, 'SoundCloud'], [/(^|\.)bandcamp\.com$/, 'Bandcamp'],
  [/(^|\.)spotify\.com$/, 'Spotify'], [/(^|\.)linktr\.ee$/, 'Linktree'], [/(^|\.)lit\.link$/, 'lit.link'], [/(^|\.)potofu\.me$/, 'POTOFU']];
/** "Instagram", "LINE"… or the bare host name. */
export function linkLabel(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return SITES.find(([re]) => re.test(h))?.[1] || h;
  } catch {
    return '';
  }
}

// Text on the colour is always white, so the colour must be dark enough (WCAG 4.5:1).
const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastWithWhite = (hex) => 1.05 / (luminance(hex) + 0.05);
/** The colour, darkened just enough for white text to read well ('' when unset or invalid). */
export function safeColor(v) {
  let c = validColor(v);
  for (let i = 0; c && i < 30 && contrastWithWhite(c) < 4.5; i++) {
    c = '#' + [1, 3, 5].map((k) => Math.round(parseInt(c.slice(k, k + 2), 16) * 0.92).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return c;
}
export function applyBrandColor(el, color) {
  const c = safeColor(color);
  if (c) el.style.setProperty('--brand', c);
  else el.style.removeProperty('--brand');
}

export const hasBrand = (s) => !!(s && (validLogo(s.logo) || validColor(s.brandColor) || validLink(s.storeLink) || cleanLinks(s.links).length
  || [s.footer, s.tagline, s.people, s.about, s.eventName].some((v) => String(v || '').trim()) || (s.tips && s.tipAtt) || !!menuOf(s)));
export function brandProfile(s) {
  const links = cleanLinks([s.storeLink, ...(s.links || [])]);
  return {
    v: 1, name: clean(s.storeName, 60), color: safeColor(s.brandColor), logo: validLogo(s.logo), msg: clean(s.footer, 120),
    link: links[0] || '', links, tagline: clean(s.tagline, 40), people: clean(s.people, 40), about: cleanText(s.about, 300),
    event: { name: clean(s.eventName, 40), space: clean(s.eventSpace, 20) },
    ...(tipOffer(s) ? { tip: tipOffer(s) } : {}),
    ...(menuOf(s) ? { menu: menuOf(s) } : {}),
  };
}
let menuSource = () => [];
/** state.js tells the profile where the products are (brand.js can't import state.js). */
export const setMenuSource = (fn) => { menuSource = fn; };
/** The menu for the store page: names, prices and categories (at most 80 items), or null. */
export function menuOf(s, products = menuSource()) {
  if (!s || s.showMenu === false) return null;
  const items = (Array.isArray(products) ? products : []).filter((p) => p && String(p.name || '').trim()).slice(0, 80)
    .map((p) => ({ n: clean(p.name, 40), p: Math.max(0, Math.min(10_000_000, Math.trunc(Number(p.price) || 0))), c: clean(p.cat, 20) }));
  return items.length ? { tax: s.taxMode === 'excl' ? 'excl' : 'incl', items } : null;
}
function parseMenu(m) {
  if (!m || typeof m !== 'object' || !Array.isArray(m.items)) return null;
  const items = m.items.slice(0, 80).map((x) => ({ n: clean(x?.n, 40), p: Number.isInteger(x?.p) && x.p >= 0 && x.p <= 10_000_000 ? x.p : -1, c: clean(x?.c, 20) }))
    .filter((x) => x.n.trim() && x.p >= 0);
  return items.length ? { tax: m.tax === 'excl' ? 'excl' : 'incl', items } : null;
}

/** Tips are bound to a profile: the owner's signed text carries the first half of its key. */
export const tipCode = (pub) => String(pub || '').slice(0, 32);
/** What the profile offers for tips, or null. Only when the receiving wallet itself signed for this profile. */
export function tipOffer(s, pub = brandPub()) {
  const a = s?.tipAtt;
  if (!s?.tips || !a || !pub || a.code !== tipCode(pub) || !sameAddress(a.wallet, s.address)) return null;
  const chains = [...new Set((s.chains || []).map((id) => resolveChain(id, s.network)).filter((id) => CHAINS[id]))];
  return { to: checksum(s.address), msg: a.message, sig: a.signature, chains: chains.length ? chains : [137] };
}
/** Checked on the supporter's phone: the wallet that receives the tip signed "accept tips" for this very profile. */
export function verifyTip(tip, pub) {
  if (!tip || typeof tip !== 'object' || !/^[0-9a-f]{64}$/.test(pub || '')) return null;
  const to = String(tip.to || '');
  const msg = String(tip.msg || '');
  const sig = String(tip.sig || '');
  if (!isAddress(to) || msg.length > 600 || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return null;
  const m = parseOwnerMessage(msg);
  if (!m || m.action !== 'accept-tips' || m.code !== tipCode(pub) || !sameAddress(m.wallet, to)) return null;
  let signer = '';
  try { signer = recoverPersonal(msg, sig); } catch { return null; }
  if (!sameAddress(signer, to)) return null;
  const chains = (Array.isArray(tip.chains) ? tip.chains : []).map(Number).filter((c) => CHAINS[c]).slice(0, 6);
  return { to: checksum(to), msg, sig, chains: chains.length ? chains : [137], at: m.time };
}

/** The customer-facing page for a store profile key ('' when there is none). */
export function storePageUrl(pub, base = location.href) {
  if (!/^[0-9a-f]{64}$/.test(pub || '')) return '';
  const u = new URL('store.html', base);
  u.search = '';
  u.hash = 'p=' + b64urlEncode(Uint8Array.from(pub.match(/../g), (h) => parseInt(h, 16)));
  return u.toString();
}
/** Every profile from a relay is untrusted input. */
export function parseBrand(json, pub = '') {
  try {
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const links = cleanLinks([o.link, ...(Array.isArray(o.links) ? o.links : [])]);
    const ev = o.event && typeof o.event === 'object' ? o.event : {};
    return {
      name: clean(o.name, 60), color: safeColor(o.color), logo: validLogo(o.logo), msg: clean(o.msg, 120), link: links[0] || '', links,
      tagline: clean(o.tagline, 40), people: clean(o.people, 40), about: cleanText(o.about, 300), event: { name: clean(ev.name, 40), space: clean(ev.space, 20) },
      tip: pub ? verifyTip(o.tip, pub) : null,
      menu: parseMenu(o.menu),
    };
  } catch {
    return null;
  }
}

// ---- the register's side: its profile key and publishing ----
function keyRec() {
  const k = store.get(KEY, null);
  return k && /^0x[0-9a-f]{64}$/.test(k.sk) && /^[0-9a-f]{64}$/.test(k.pub) ? k : null;
}
/** The public key customers' phones look up ('' until the store has branding). */
export const brandPub = () => keyRec()?.pub || '';
export async function ensureBrandKey() {
  const k = keyRec();
  if (k) return k;
  const { randomPrivateKey, privateKeyToHex, schnorrPublicKey } = await import('./secp256k1.js');
  const d = randomPrivateKey();
  const rec = { sk: privateKeyToHex(d), pub: schnorrPublicKey(d) };
  store.set(KEY, rec);
  return rec;
}
/** The profile key, for the backup file (it only signs public display info, never money). */
export const brandKeyForBackup = () => keyRec();
/** Restores a backed-up profile key, so a store keeps the same public profile on a new device. */
export async function restoreBrandKey(k) {
  if (!k || !/^0x[0-9a-f]{64}$/.test(k.sk) || !/^[0-9a-f]{64}$/.test(k.pub)) return false;
  const { privateKeyFromHex, schnorrPublicKey } = await import('./secp256k1.js');
  if (schnorrPublicKey(privateKeyFromHex(k.sk)) !== k.pub) return false;
  store.set(KEY, { sk: k.sk, pub: k.pub });
  store.del(SENT); // publish again from this device
  return true;
}
export const brandSent = () => store.get(SENT, null); // { at, hash } of the last accepted publish
const sha256Hex = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');

/** Publishes the store's profile; a quiet no-op when it is unchanged and was sent in the last 3 days. */
export async function publishBrand(s, { force = false } = {}) {
  if (!hasBrand(s)) return 'none';
  const content = JSON.stringify(brandProfile(s));
  const hash = await sha256Hex(content);
  const last = brandSent();
  if (!force && last?.hash === hash && Date.now() - last.at < 3 * 86_400_000) return 'fresh';
  const key = await ensureBrandKey();
  const [{ makeEvent, Pool }, { privateKeyFromHex }] = await Promise.all([import('./nostr.js'), import('./secp256k1.js')]);
  const ev = await makeEvent(privateKeyFromHex(key.sk), BRAND_KIND, [['d', BRAND_D], ['alt', 'Reji store profile']], content);
  const pool = new Pool().connect();
  try {
    const ok = await pool.publish(ev, 10_000);
    if (ok) store.set(SENT, { at: Date.now(), hash });
    return ok ? 'ok' : 'failed';
  } finally {
    setTimeout(() => pool.close(), 4000); // give the slower relays a moment to take it too
  }
}

// ---- the customer's side: look a profile up, keep a small cache ----
export function cachedBrand(pub) {
  const all = store.get(CACHE, {});
  return all && typeof all === 'object' && all[pub] ? parseBrand(all[pub].b, pub) : null;
}
function remember(pub, b) {
  const all = store.get(CACHE, {}) || {};
  all[pub] = { at: Date.now(), b };
  const keep = Object.keys(all).sort((x, y) => (all[y].at || 0) - (all[x].at || 0)).slice(0, 30);
  store.set(CACHE, Object.fromEntries(keep.map((k) => [k, all[k]])));
}
/** Resolves the store's verified profile, or null when no relay answers in time. */
export async function fetchBrand(pub, timeoutMs = 6000) {
  if (!/^[0-9a-f]{64}$/.test(pub || '')) return null;
  const { Pool, verifyEvent } = await import('./nostr.js');
  const pool = new Pool().connect();
  return new Promise((resolve) => {
    let best = null;
    let ended = false;
    let unsub = () => {};
    const end = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      unsub();
      pool.close();
      const b = best ? parseBrand(best.content, pub) : null;
      if (b) remember(pub, b);
      resolve(b);
    };
    const timer = setTimeout(end, timeoutMs);
    unsub = pool.subscribe({ kinds: [BRAND_KIND], authors: [pub], '#d': [BRAND_D], limit: 1 }, async (ev) => {
      if (ev?.pubkey !== pub || ev.kind !== BRAND_KIND || !Array.isArray(ev.tags) || !ev.tags.some((x) => x[0] === 'd' && x[1] === BRAND_D)) return;
      if (typeof ev.content !== 'string' || ev.content.length > 60000 || !(await verifyEvent(ev))) return;
      const first = !best;
      if (!best || ev.created_at > best.created_at) best = ev;
      if (first) setTimeout(end, 700); // a moment for a newer copy from another relay
    });
  });
}

// ---- picking a logo: shrink any image to a small, light data URL ----
const readAsDataURL = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(new Error('decode'));
  r.readAsDataURL(file);
});
const loadImage = (src) => new Promise((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => rej(new Error('decode'));
  i.src = src;
});
const toBase64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const decodes = (src) => loadImage(src).then((i) => i.naturalWidth > 0, () => false);
function canvasOf(img, w, h, background) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext('2d');
  if (background) { cx.fillStyle = background; cx.fillRect(0, 0, w, h); }
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(img, 0, 0, w, h);
  return cv;
}

/**
 * Shrinks a picked image into a small logo (at most 256 px): AVIF, made by the
 * browser's own AV1 encoder; PNG or JPEG on browsers that can't make AVIF. A small
 * AVIF file is kept as it is. Resolves { data, format }; throws
 * Error('type' | 'size' | 'decode' | 'big').
 */
export async function logoFromFile(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('type');
  if (file.size > 10 * 1024 * 1024) throw new Error('size');
  const src = await readAsDataURL(file);
  const img = await loadImage(src);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  if (!W || !H) throw new Error('decode');
  if (file.type === 'image/avif' && Math.max(W, H) <= 512 && src.length <= 24000 && validLogo(src)) return { data: src, format: 'avif' };
  let avif = true;
  for (const side of [256, 224, 192, 160, 128, 96]) {
    const k = Math.min(1, side / Math.max(W, H));
    const w = Math.max(2, Math.round((W * k) / 2) * 2); // even sizes suit the AV1 encoder
    const h = Math.max(2, Math.round((H * k) / 2) * 2);
    const flat = canvasOf(img, w, h, '#fff'); // logos sit on white tiles everywhere
    if (avif) {
      for (const q of [0.7, 0.55, 0.4]) {
        const bytes = await canvasToAvif(flat, q);
        if (!bytes) { avif = false; break; }
        const data = 'data:image/avif;base64,' + toBase64(bytes);
        if (data.length > 24000) continue;
        if (validLogo(data) && (await decodes(data))) return { data, format: 'avif' };
        avif = false; // made, but this browser can't show it: use PNG/JPEG instead
        break;
      }
      if (avif) continue; // too large at this size: try a smaller one
    }
    let data = canvasOf(img, w, h, '').toDataURL('image/png'); // PNG keeps transparency
    let format = 'png';
    if (data.length > 24000) { data = flat.toDataURL('image/jpeg', 0.85); format = 'jpeg'; }
    if (data.length <= 24000 && validLogo(data)) return { data, format };
  }
  throw new Error('big');
}
