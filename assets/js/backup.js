// Backups: one JSON file with a store's settings, menu, sales and profile key (never the gas
// wallet key). Used by Settings and by the first screen on a new device (お店の引き継ぎ).
import { store, ymd, download, nextTerminal } from './util.js';
import { state, KEYS, normalizeSettings, normalizeProducts } from './state.js';
import { APP, CHAINS } from './config.js';
import { brandKeyForBackup, restoreBrandKey } from './brand.js';

export const BACKUP_AT = 'reji:backupat:v1';

export function saveBackup() {
  const data = {
    app: 'reji',
    format: 1,
    version: APP.version,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    products: state.products,
    sales: state.sales,
    unpaid: state.unpaid,
    counter: store.get(KEYS.counter, null),
    brandKey: brandKeyForBackup(), // the store's public profile ID (logo etc.); not a money key
  };
  download(`reji-backup-${ymd()}.json`, JSON.stringify(data, null, 1), 'application/json');
  store.set(BACKUP_AT, Date.now());
}

const validSale = (s) => s && typeof s === 'object' && typeof s.id === 'string' && Number.isInteger(s.amountYen)
  && CHAINS[s.chainId] && Array.isArray(s.items) && /^\d*$/.test(String(s.valueWei ?? ''));

/** A backup file's contents, checked; null when the text isn't a Reji backup. */
export function readBackup(text) {
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  if (!d || d.app !== 'reji' || !d.settings || typeof d.settings !== 'object') return null;
  return {
    settings: normalizeSettings(d.settings),
    products: normalizeProducts(d.products),
    sales: Array.isArray(d.sales) ? d.sales.filter(validSale) : [],
    unpaid: Array.isArray(d.unpaid) ? d.unpaid.filter((u) => u && Array.isArray(u.chains) && Number.isInteger(u.amountYen)) : [],
    counter: d.counter && typeof d.counter === 'object' ? d.counter : null,
    brandKey: d.brandKey && typeof d.brandKey === 'object' ? d.brandKey : null,
    exportedAt: Date.parse(d.exportedAt) || 0,
  };
}

/** Puts a backup on this device. 'replace': this device takes over, sales included.
 *  'second': a second register beside the first (settings and menu only, its own register letter). */
export async function applyBackup(b, { mode = 'replace' } = {}) {
  const second = mode === 'second';
  store.set(KEYS.settings, normalizeSettings(second ? { ...b.settings, terminal: nextTerminal(b.settings.terminal) } : b.settings));
  store.set(KEYS.products, b.products);
  store.set(KEYS.sales, second ? [] : b.sales);
  store.set(KEYS.unpaid, second ? [] : b.unpaid);
  if (second) store.del(KEYS.counter);
  else if (b.counter) store.set(KEYS.counter, b.counter);
  if (b.brandKey) await restoreBrandKey(b.brandKey);
  store.del(KEYS.pending);
  store.del(KEYS.cart);
}
