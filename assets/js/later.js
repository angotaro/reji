// Pay later (後払い), for outages and emergencies: the customer takes the goods now and pays from any wallet
// whenever they have a connection, with a payment link valid for days. While the register is open and online,
// it looks for those payments on its own and books the sales. When the window runs out, the store chooses
// what to do: a new link, paid another way, or not collected.
import { html, raw, yen, randInt, forQr, copyText, toast, store } from './util.js';
import { t, fmtDateTime } from './i18n.js';
import { CHAINS, LIMITS } from './config.js';
import { blockNumber, scanTransfers } from './rpc.js';
import { qrSvg } from './qr.js';
import { state, saveUnpaid, saveSales, consumedKeys, transferKey, emit } from './state.js';
import { modal, printHtml, icon } from './ui.js';
import { payUrl, bookUnpaid } from './charge.js';
import { OPEN, isOpenLater, matchLater, laterCheck } from './latercore.js';
import { yenToWei } from './evm.js';

const DAY = 86_400_000;
const CURSOR_KEY = 'reji:latercursor:v1';
const keyOf = (tr) => transferKey(tr.txHash, tr.logIndex);

export const openLater = (net = state.settings.network) => state.unpaid.filter((u) => isOpenLater(u) && u.network === net);
export const outstanding = (net) => openLater(net).reduce((sum, u) => sum + u.amountYen, 0);
export const checkLater = (amountYen) => laterCheck(amountYen, outstanding(), state.settings);

/** The charge on screen as a pay-later entry: valid for days, and without the no-fee relay (nobody listens later). */
export function toLater(c) {
  const now = Date.now();
  const payBy = now + state.settings.laterDays * DAY;
  return { ...c, status: 'later', laterAt: now, endedAt: now, payBy, expiresAt: payBy, memo: '', relayChannel: '', relayKey: '', relayPub: '' };
}
export const laterLink = (u, chainId = u.chainId) => payUrl({ ...u, expiresAt: u.payBy }, chainId);

/** Shows the QR (and the slip to print); resolves with the memo when the store hands the goods over, else null. */
export function laterDialog(u) {
  const m = modal(html`<h2 class="modal-title">${t('later.title')}</h2>
    <p class="modal-text">${t('later.text', { date: fmtDateTime(u.payBy) })}</p>
    <div class="later-qr">${raw(qrSvg(forQr(laterLink(u)), { ecl: 'M', title: t('later.qrTitle') }))}</div>
    <p class="later-amount"><b>${yen(u.amountYen)}</b><span>${t('charge.no', { no: u.no })}</span></p>
    <label class="field"><span class="label">${t('later.memo')}</span>
      <input name="memo" type="text" maxlength="80" autocomplete="off" placeholder="${t('later.memoPh')}"></label>
    <p class="hint">${t('later.risk')}</p>
    <div class="modal-actions">
      <button type="button" class="btn ghost" data-act="later-print">${icon('receipt')}<span>${t('later.print')}</span></button>
      <button type="button" class="btn primary" data-ok>${t('later.ok')}</button>
    </div>`, { label: t('later.title') });
  const memo = () => m.el.querySelector('[name="memo"]').value.trim().slice(0, 80);
  m.el.querySelector('[data-act="later-print"]').addEventListener('click', () => printLater({ ...u, memo: memo() }));
  m.el.querySelector('[data-ok]').addEventListener('click', () => m.close({ memo: memo() }));
  return m.result.then((v) => (v ? v.memo : null));
}

/** A slip for customers who keep it on paper (a dead phone in an outage). */
export function printLater(u) {
  printHtml(html`<div class="later-slip">
    <p class="ls-store">${u.storeName || ''}</p>
    <h2 class="ls-title">${t('later.slipTitle')}</h2>
    <p class="ls-no">${t('charge.no', { no: u.no })}</p>
    <table class="ls-items">${(u.items || []).map((i) => html`<tr><td>${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}</td><td>${yen(i.price * i.qty)}</td></tr>`)}</table>
    <p class="ls-total"><span>${t('later.slipTotal')}</span><b>${yen(u.amountYen)}</b></p>
    <div class="ls-qr">${raw(qrSvg(forQr(laterLink(u)), { ecl: 'M', margin: 2 }))}</div>
    <p class="ls-note">${t('later.slipNote', { date: fmtDateTime(u.payBy) })}</p>
  </div>`, { width: state.settings.receiptWidth });
}

/** Shows an entry's QR again (or a new one), with copy and share. */
export function showLaterQr(u) {
  const url = laterLink(u);
  const m = modal(html`<h2 class="modal-title">${t('later.qrAgain')}</h2>
    <p class="modal-text">${t('later.text', { date: fmtDateTime(u.payBy) })}</p>
    <div class="later-qr">${raw(qrSvg(forQr(url), { ecl: 'M', title: t('later.qrTitle') }))}</div>
    <p class="later-amount"><b>${yen(u.amountYen)}</b><span>${t('charge.no', { no: u.no })}</span></p>
    <div class="modal-actions">
      <button type="button" class="btn ghost" data-act="later-copy">${icon('copy')}<span>${t('charge.copy')}</span></button>
      <button type="button" class="btn ghost" data-act="later-print">${icon('receipt')}<span>${t('later.print')}</span></button>
      <button type="button" class="btn primary" data-close>${t('common.close')}</button>
    </div>`, { label: t('later.qrAgain') });
  m.el.querySelector('[data-act="later-copy"]').addEventListener('click', async () => {
    const ok = await copyText(url);
    toast(ok ? t('common.copied') : t('common.copyFailed'), ok ? 'info' : 'error');
  });
  m.el.querySelector('[data-act="later-print"]').addEventListener('click', () => printLater(u));
}

/** A new link when the window ran out: a new fraction and deadline (payments to the earlier links still count). */
export function reissue(id) {
  const u = state.unpaid.find((x) => x.id === id && isOpenLater(x));
  if (!u) return null;
  const old = [...(u.oldSuffixes || []), u.suffix].slice(-5);
  let suffix;
  do suffix = randInt(1, LIMITS.suffixMax); while (old.includes(suffix));
  const payBy = Date.now() + state.settings.laterDays * DAY;
  Object.assign(u, { suffix, oldSuffixes: old, payBy, expiresAt: payBy, status: 'later', reissuedAt: Date.now() });
  saveUnpaid();
  emit('unpaid');
  return u;
}

/** Closes an entry the store settled another way ('settled') or will not collect ('writtenoff'). */
export function closeLater(id, status, note = '') {
  const u = state.unpaid.find((x) => x.id === id && isOpenLater(x));
  if (!u || !['settled', 'writtenoff'].includes(status)) return;
  Object.assign(u, { status, closedAt: Date.now(), closeNote: String(note).trim().slice(0, 80) });
  saveUnpaid();
  emit('unpaid');
}

function markOverdue() {
  let changed = false;
  for (const u of state.unpaid) {
    if (u.status === 'later' && Date.now() > u.payBy) {
      u.status = 'uncollected';
      changed = true;
    }
  }
  if (changed) {
    saveUnpaid();
    emit('unpaid');
  }
}

// ---- collecting the payments while the register is open and online ----
let busy = false;
export async function collect({ maxChunks = 25 } = {}) {
  markOverdue();
  const open = state.unpaid.filter(isOpenLater);
  if (!open.length || busy || !navigator.onLine) return 0;
  busy = true;
  let booked = 0;
  try {
    const cursors = store.get(CURSOR_KEY, {});
    const groups = new Map(); // one scan per chain and receiving address
    for (const u of open) for (const id of u.chains) {
      const k = `${id}|${String(u.to).toLowerCase()}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(u);
    }
    for (const [k, entries] of groups) {
      const id = Number(k.split('|')[0]);
      const ch = CHAINS[id];
      if (!ch) continue;
      const latest = await blockNumber(id);
      const startOf = (u) => u.startBlocks?.[id] ?? Math.max(0, latest - Math.ceil((Date.now() - u.createdAt) / 1000 / ch.blockTime) - 30);
      const earliest = Math.min(...entries.map(startOf));
      const from = Math.max(earliest, cursors[k] ?? earliest);
      if (from > latest) continue;
      const to = Math.min(latest, from + maxChunks * 2000 - 1); // a long outage catches up a step at a time
      const found = (await scanTransfers(id, entries[0].to, from, to, { chunk: 2000, maxChunks })).map((tr) => ({ ...tr, chainId: id }));
      const p = state.pending; // a payment for the charge on screen is that charge's, not a pay-later entry's
      const mine = p ? found.filter((tr) => !(p.chains?.includes(id) && Number(tr.blockNumber) >= Number(p.startBlocks?.[id] ?? 0)
        && (tr.value === yenToWei(p.amountYen) || tr.value === yenToWei(p.amountYen) + BigInt(p.suffix)))) : found;
      const withStart = entries.map((u) => ({ ...u, startBlocks: { ...(u.startBlocks || {}), [id]: startOf(u) } }));
      for (const h of matchLater(mine, withStart, consumedKeys(), keyOf)) {
        const u = state.unpaid.find((x) => x.id === h.id);
        if (!u) continue;
        try {
          const sale = await bookUnpaid(u, h.tr, id, h.match);
          sale.payLater = true;
          saveSales();
          booked++;
        } catch { /* booked meanwhile */ }
      }
      cursors[k] = to + 1;
      store.set(CURSOR_KEY, cursors);
    }
  } catch { /* offline or nodes busy: the next round tries again */ } finally {
    busy = false;
  }
  if (booked) toast(t('later.collected', { n: booked }));
  return booked;
}

export function startCollector() {
  collect();
  setInterval(() => { if (!document.hidden) collect(); }, 60_000);
  addEventListener('online', () => collect());
}

export { OPEN };
