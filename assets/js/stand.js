// 置きQR (unattended sales): a printed QR opens the store page, the customer types the amount and pays.
// While the register is open and online it looks for those payments. One paid from the page carries a mark and
// is booked as a sale on its own; a whole-yen amount typed by hand waits in a short list for one tap.
import { store, uid } from './util.js';
import { t } from './i18n.js';
import { CHAINS, LIMITS } from './config.js';
import { UNIT, yenToWei } from './evm.js';
import { blockNumber, scanTransfers } from './rpc.js';
import { state, saveSales, consumedKeys, transferKey, activeChains, nextReceiptNo, emit } from './state.js';
import { standOffer } from './brand.js';
import { bookUnpaid } from './charge.js';
import { isOpenLater } from './latercore.js';
import { standKind } from './standcore.js';
import { toast } from './util.js';

const CURSOR_KEY = 'reji:standcursor:v1';
const INBOX_KEY = 'reji:standinbox:v1';
const IGNORE_KEY = 'reji:standignored:v1';
const keyOf = (tr) => transferKey(tr.txHash, tr.logIndex);

export const standOn = () => !!standOffer(state.settings);
const ignored = () => new Set(store.get(IGNORE_KEY, []));
/** Hand-typed payments waiting for the store's "this is a sale" (never ones already booked or dismissed). */
export function standInbox() {
  const used = consumedKeys();
  const no = ignored();
  const to = String(state.settings.address || '').toLowerCase();
  return (store.get(INBOX_KEY, []) || []).filter((x) => x && !used.has(x.key) && !no.has(x.key) && String(x.to).toLowerCase() === to && !!CHAINS[x.chainId]?.testnet === (state.settings.network === 'testnet'));
}

/** Books one transfer as an unattended sale: one line at the store's chosen tax rate, the price as paid. */
async function book(tr, chainId, match) {
  const s = state.settings;
  const amountYen = Number(BigInt(tr.value) / UNIT);
  const name = t('stand.item');
  const u = { id: uid(), no: nextReceiptNo(), createdAt: Date.now(), amountYen, items: [{ name, price: amountYen, tax: s.standTax, qty: 1 }], taxMode: 'incl',
    to: s.address, storeName: s.storeName, desc: name, event: '' };
  const sale = await bookUnpaid(u, { ...tr, value: BigInt(tr.value) }, chainId, match);
  sale.late = false;
  sale.stand = true;
  sale.createdAt = sale.paidAt;
  saveSales();
  emit('sale', sale);
  return sale;
}
export async function confirmInbox(key) {
  const x = standInbox().find((e) => e.key === key);
  if (!x) return null;
  return book({ txHash: x.txHash, logIndex: x.logIndex, blockNumber: x.blockNumber, from: x.from, value: x.valueWei }, x.chainId, 'amount');
}
export function ignoreInbox(key) {
  store.set(IGNORE_KEY, [...ignored(), key].slice(-500));
  emit('unpaid');
}

let busy = false;
export async function collectStand({ maxChunks = 25 } = {}) {
  const s = state.settings;
  if (!standOn() || busy || !navigator.onLine) return 0;
  busy = true;
  let booked = 0;
  let listed = 0;
  try {
    const cursors = store.get(CURSOR_KEY, {});
    const inbox = store.get(INBOX_KEY, []) || [];
    const have = new Set(inbox.map((x) => x.key));
    for (const id of activeChains()) {
      const ch = CHAINS[id];
      if (!ch) continue;
      const k = `${id}|${String(s.address).toLowerCase()}`;
      const latest = await blockNumber(id);
      const since = Math.max(0, latest - Math.ceil((Date.now() - (s.standSince || Date.now())) / 1000 / ch.blockTime) - 5);
      const from = Math.max(since, cursors[k] ?? since);
      if (from > latest) continue;
      const to = Math.min(latest, from + maxChunks * 2000 - 1);
      const found = await scanTransfers(id, s.address, from, to, { chunk: 2000, maxChunks });
      const p = state.pending; // a payment for the charge on screen belongs to that charge
      for (const tr of found) {
        const key = keyOf(tr);
        if (consumedKeys().has(key) || have.has(key)) continue;
        if (p && p.chains?.includes(id) && Number(tr.blockNumber) >= Number(p.startBlocks?.[id] ?? 0) && (tr.value === yenToWei(p.amountYen) || tr.value === yenToWei(p.amountYen) + BigInt(p.suffix))) continue;
        const kind = standKind(tr.value, LIMITS.maxYen);
        if (kind === 'mark') {
          try { await book(tr, id, 'exact'); booked++; } catch { /* booked meanwhile */ }
        } else if (kind === 'plain') {
          const amountYen = Number(tr.value / UNIT);
          if (state.unpaid.some((u) => isOpenLater(u) && u.amountYen === amountYen && u.chains?.includes(id))) continue; // a pay-later sale of that amount is waiting: that check decides
          inbox.unshift({ key, chainId: id, txHash: tr.txHash, logIndex: tr.logIndex, blockNumber: Number(tr.blockNumber), from: tr.from, to: s.address, valueWei: tr.value.toString(), amountYen, seenAt: Date.now() });
          have.add(key);
          listed++;
        }
      }
      cursors[k] = to + 1;
      store.set(CURSOR_KEY, cursors);
    }
    if (listed) store.set(INBOX_KEY, inbox.slice(0, 200));
  } catch { /* offline or nodes busy: the next round tries again */ } finally {
    busy = false;
  }
  if (booked) toast(t('stand.collected', { n: booked }));
  if (listed) emit('unpaid');
  return booked + listed;
}

export function startStand() {
  collectStand();
  setInterval(() => { if (!document.hidden) collectStand(); }, 45_000);
  addEventListener('online', () => collectStand());
}
