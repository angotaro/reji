// Register state. Everything lives in this browser's localStorage; nothing is
// sent anywhere except read-only JSON-RPC calls to public blockchain nodes.
import { store, ymd, clamp } from './util.js';
import { validLogo, validColor, validLink, mergeLinks, setMenuSource } from './brand.js';
import { CHAINS, MAINNET_IDS, resolveChain } from './config.js';
import { setRpcOverrides } from './rpc.js';
import { isAddress, checksum } from './evm.js';

export const KEYS = {
  settings: 'reji:settings:v1',
  products: 'reji:products:v1',
  sales: 'reji:sales:v1',
  unpaid: 'reji:unpaid:v1',
  pending: 'reji:pending:v1',
  cart: 'reji:cart:v1',
  counter: 'reji:counter:v1',
};

export const DEFAULT_SETTINGS = {
  storeName: '',
  address: '', // the store's own wallet (public address only)
  network: 'mainnet', // 'mainnet' | 'testnet'
  chains: [137], // accepted chains, stored as mainnet ids
  defaultChain: 137,
  taxMode: 'incl', // 'incl' (税込) | 'excl' (税抜)
  regNo: '', // qualified invoice registration number, T + 13 digits
  storeAddr: '',
  storeTel: '',
  footer: '',
  logo: '', // store logo, a small image data URL (optional)
  brandColor: '', // accent colour '#RRGGBB' ('' = standard indigo)
  storeLink: '', // https link shown on receipts (website, Instagram, LINE…); always links[0]
  links: [], // up to 4 https links for the store page
  tagline: '', // one line under the store name
  people: '', // who runs it (a pen name is fine); public
  about: '', // introduction on the store page
  eventName: '', // the event the store is at today (optional)
  eventSpace: '', // booth / space number at that event
  tips: false, // accept tips (応援) on the store page
  showMenu: true, // put the menu (names, prices) on the store page
  tipAtt: null, // the receiving wallet's signature agreeing to that, bound to the profile key
  terminal: '', // optional receipt-number prefix when running several registers
  expiryMin: 15,
  qrKind: 'web', // kept for older backups: the register shows one QR for everyone
  receiptWidth: 58,
  sound: true,
  keypadTax: 10,
  gasless: true, // offer no-fee payments once the store's gas wallet is set up
  owner: null, // { address, verifiedAt }: the receiving wallet, confirmed by signature
  regMode: 'menu',
  pinHash: '',
  pinSalt: '',
  rpc: {}, // { [chainId]: 'https://…' }
};

export function normalizeSettings(s) {
  const o = { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
  o.chains = [...new Set((Array.isArray(o.chains) ? o.chains : []).map(Number))].filter((id) => MAINNET_IDS.includes(id));
  if (!o.chains.length) o.chains = [137];
  o.defaultChain = Number(o.defaultChain);
  if (!o.chains.includes(o.defaultChain)) o.defaultChain = o.chains[0];
  o.network = o.network === 'testnet' ? 'testnet' : 'mainnet';
  o.taxMode = o.taxMode === 'excl' ? 'excl' : 'incl';
  o.expiryMin = clamp(parseInt(o.expiryMin, 10) || 15, 2, 120);
  o.qrKind = 'web';
  o.receiptWidth = Number(o.receiptWidth) === 80 ? 80 : 58;
  o.keypadTax = [10, 8, 0].includes(Number(o.keypadTax)) ? Number(o.keypadTax) : 10;
  o.regMode = o.regMode === 'keypad' ? 'keypad' : 'menu';
  o.sound = o.sound !== false;
  o.gasless = o.gasless !== false;
  o.owner = o.owner && typeof o.owner === 'object' && isAddress(o.owner.address)
    ? {
      address: checksum(o.owner.address),
      verifiedAt: Number(o.owner.verifiedAt) || 0,
      message: typeof o.owner.message === 'string' ? o.owner.message.slice(0, 600) : '',
      signature: /^0x[0-9a-fA-F]{130}$/.test(o.owner.signature || '') ? o.owner.signature : '',
    }
    : null;
  const rpcIn = o.rpc && typeof o.rpc === 'object' ? o.rpc : {};
  o.rpc = {};
  for (const [id, v] of Object.entries(rpcIn)) {
    const urls = (Array.isArray(v) ? v : [v]).map((u) => String(u || '').trim()).filter((u) => /^https:\/\/\S+$/i.test(u) && u.length < 400);
    if (CHAINS[id] && urls.length) o.rpc[id] = [...new Set(urls)].slice(0, 3);
  }
  for (const k of ['storeName', 'address', 'regNo', 'storeAddr', 'storeTel', 'footer', 'terminal', 'pinHash', 'pinSalt']) {
    o[k] = typeof o[k] === 'string' ? o[k] : '';
  }
  o.rpc = o.rpc && typeof o.rpc === 'object' ? o.rpc : {};
  o.logo = validLogo(o.logo);
  o.brandColor = validColor(o.brandColor);
  o.storeLink = validLink(o.storeLink);
  const line = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n);
  o.tagline = line(o.tagline, 40);
  o.people = line(o.people, 40);
  o.about = String(o.about ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').slice(0, 300);
  o.eventName = line(o.eventName, 40);
  o.eventSpace = line(o.eventSpace, 20);
  const a = o.tipAtt;
  o.tipAtt = a && typeof a === 'object' && /^0x[0-9a-fA-F]{40}$/.test(a.wallet || '') && /^[0-9a-f]{32}$/.test(a.code || '') && typeof a.message === 'string' && a.message.length <= 600
    && /^0x[0-9a-fA-F]{130}$/.test(a.signature || '') ? { wallet: a.wallet, code: a.code, message: a.message, signature: a.signature, at: Number(a.at) || 0 } : null;
  o.tips = !!o.tips && !!o.tipAtt;
  o.showMenu = o.showMenu !== false;
  o.links = mergeLinks(o.storeLink, o.links);
  o.storeLink = o.links[0] || '';
  return o;
}

export function normalizeProducts(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      id: typeof p.id === 'string' && p.id ? p.id.slice(0, 24) : Math.random().toString(36).slice(2, 12),
      name: String(p.name ?? '').slice(0, 40),
      price: clamp(Math.trunc(Number(p.price) || 0), 0, 10_000_000),
      tax: [10, 8, 0].includes(Number(p.tax)) ? Number(p.tax) : 10,
      cat: String(p.cat ?? '').slice(0, 20),
    }))
    .filter((p) => p.name);
}

export const state = {
  settings: normalizeSettings(store.get(KEYS.settings, null)),
  products: normalizeProducts(store.get(KEYS.products, [])),
  cart: store.get(KEYS.cart, []),
  sales: store.get(KEYS.sales, []),
  unpaid: store.get(KEYS.unpaid, []),
  pending: store.get(KEYS.pending, null),
};
if (!Array.isArray(state.cart)) state.cart = [];
if (!Array.isArray(state.sales)) state.sales = [];
if (!Array.isArray(state.unpaid)) state.unpaid = [];
setRpcOverrides(state.settings.rpc);

export function saveSettings(next) {
  state.settings = normalizeSettings(next);
  setRpcOverrides(state.settings.rpc);
  return store.set(KEYS.settings, state.settings);
}
export const saveProducts = () => store.set(KEYS.products, state.products);
export const saveCart = () => store.set(KEYS.cart, state.cart);
export const saveSales = () => store.set(KEYS.sales, state.sales);
export const saveUnpaid = () => store.set(KEYS.unpaid, state.unpaid);
export function savePending() {
  if (state.pending) store.set(KEYS.pending, state.pending);
  else store.del(KEYS.pending);
}

export const isTestnet = () => state.settings.network === 'testnet';

/** Chains the register listens on right now (real chain ids), default first. */
export function activeChains(s = state.settings) {
  const order = [s.defaultChain, ...s.chains.filter((id) => id !== s.defaultChain)];
  return order.map((id) => resolveChain(id, s.network)).filter((id) => CHAINS[id]);
}

/** Receipt numbers: [terminal-]YYYYMMDD-NNNN, restarting every day. */
export function nextReceiptNo() {
  const today = ymd();
  const c = store.get(KEYS.counter, { day: '', n: 0 });
  const n = c && c.day === today ? (Number(c.n) || 0) + 1 : 1;
  store.set(KEYS.counter, { day: today, n });
  const term = state.settings.terminal.trim();
  return `${term ? term + '-' : ''}${today}-${String(n).padStart(4, '0')}`;
}

export const transferKey = (txHash, logIndex) => `${String(txHash).toLowerCase()}:${Number(logIndex)}`;

/** Transfers already booked as sales can never pay for a second sale. */
export function consumedKeys() {
  return new Set(state.sales.filter((s) => s.txHash).map((s) => transferKey(s.txHash, s.logIndex)));
}

export const UNPAID_KEEP_MS = 7 * 24 * 3600 * 1000;
export function pruneUnpaid() {
  const cutoff = Date.now() - UNPAID_KEEP_MS;
  const before = state.unpaid.length;
  state.unpaid = state.unpaid.filter((u) => (u.endedAt || u.createdAt) > cutoff);
  if (state.unpaid.length !== before) saveUnpaid();
}

/** Tiny event bus so open views can refresh when a sale changes in the background. */
const bus = new EventTarget();
export const on = (type, fn) => {
  const h = (e) => fn(e.detail);
  bus.addEventListener(type, h);
  return () => bus.removeEventListener(type, h);
};
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

// Another tab changed the data: pick it up (the register is meant to run in one tab).
window.addEventListener('storage', (e) => {
  if (e.key === KEYS.sales) state.sales = store.get(KEYS.sales, []);
  else if (e.key === KEYS.unpaid) state.unpaid = store.get(KEYS.unpaid, []);
  else if (e.key === KEYS.products) state.products = normalizeProducts(store.get(KEYS.products, []));
  else if (e.key === KEYS.settings) saveSettings(store.get(KEYS.settings, null));
  else return;
  emit('external-change', e.key);
});

export function sampleProducts(lang) {
  const ja = lang === 'ja';
  const drinks = ja ? 'ドリンク' : 'Drinks';
  const food = ja ? 'フード' : 'Food';
  const goods = ja ? '物販' : 'Goods';
  const rows = [
    [ja ? 'ブレンドコーヒー' : 'Drip coffee', 450, 10, drinks],
    [ja ? 'カフェラテ' : 'Café latte', 550, 10, drinks],
    [ja ? '抹茶ラテ' : 'Matcha latte', 600, 10, drinks],
    [ja ? 'ほうじ茶' : 'Hojicha', 400, 10, drinks],
    [ja ? 'チーズケーキ' : 'Cheesecake', 500, 10, food],
    [ja ? 'どら焼き' : 'Dorayaki', 280, 10, food],
    [ja ? 'コーヒー豆 200g' : 'Coffee beans 200g', 1600, 8, goods],
    [ja ? 'ドリップバッグ 5袋' : 'Drip bags ×5', 900, 8, goods],
    [ja ? 'トートバッグ' : 'Tote bag', 1800, 10, goods],
  ];
  return rows.map(([name, price, tax, cat], i) => ({ id: `s${i + 1}${Date.now().toString(36).slice(-4)}`, name, price, tax, cat }));
}

// The store profile (brand.js) reads the menu from here; brand.js can't import this file.
setMenuSource(() => state.products);
