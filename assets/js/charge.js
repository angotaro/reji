// Charging: show the payment QR, watch every accepted chain, book the sale.
import { html, raw, $, yen, shortAddr, shortHash, mmss, copyText, toast, randInt, uid, wakeLock, b64urlEncode, forQr } from './util.js';
import { t } from './i18n.js';
import { CHAINS, LIMITS, chainName, explorerTx } from './config.js';
import { yenToWei, eip681, formatUnits, isAddress, UNIT, isTipValue } from './evm.js';
import { Watcher, blockNumber, scanTransfers, txReceipt, transfersInReceipt, rpc, confirmElsewhere } from './rpc.js';
import { qrSvg } from './qr.js';
import { computeTotals, summarizeItems } from './tax.js';
import { receiptFromSale, receiptUrl, renderReceipt } from './receipt.js';
import { chime, unlockAudio } from './sound.js';
import {
  state, saveCart, saveSales, savePending, saveUnpaid, saveSettings, activeChains, nextReceiptNo, consumedKeys, transferKey, emit, on,
} from './state.js';
import { icon, stampSvg, confirmDialog, printHtml } from './ui.js';
import { gaslessReady, startDeviceRelay, gasChainId } from './gas.js';
import { newChannel } from './nostr.js';
import { hasBrand, brandPub, ensureBrandKey, safeColor, validLogo, eventLine } from './brand.js';
import { randomPrivateKey, privateKeyToHex, schnorrPublicKey, hexToBytes } from './secp256k1.js';

const GRACE_MS = 3 * 60_000; // keep listening this long after expiry for payments already in flight
const EXTEND_MS = 10 * 60_000;
let cur = null;
let bound = false;

const expectedWei = (c) => yenToWei(c.amountYen) + BigInt(c.suffix);
const keyOf = (tr) => transferKey(tr.txHash, tr.logIndex);
export const chargeOpen = () => !!cur;

/** Link to the customer pay page. Everything the payer needs travels in the URL. */
export function payUrl(c, chainId = c.chainId) {
  const u = new URL('pay.html', location.href);
  const p = new URLSearchParams({ to: c.to, c: String(chainId), a: String(c.amountYen), u: String(c.suffix) });
  if (c.storeName) p.set('s', c.storeName.slice(0, 40));
  p.set('r', c.no);
  p.set('e', String(Math.floor(c.expiresAt / 1000)));
  if (c.desc) p.set('d', c.desc);
  if (/^[0-9a-f]{64}$/.test(c.brandPub || '')) p.set('b', b64urlEncode(hexToBytes(c.brandPub))); // store profile (logo…)
  if (c.brandColor) p.set('bc', c.brandColor.slice(1));
  if (c.relayChannel && c.relayPub && chainId === gasChainId()) {
    p.set('n', c.relayChannel); // this register relays a no-fee payment…
    p.set('k', b64urlEncode(hexToBytes(c.relayPub))); // …and signs its replies with this key
  }
  u.search = p.toString();
  u.hash = '';
  if (u.href.length > 420 && c.desc) {
    p.delete('d'); // keep the QR easy to scan
    u.search = p.toString();
  }
  return u.href;
}

// One QR for everyone: the payment page. The phone camera or LINE opens it, and from there every wallet has a way in
// (HashPort Wallet's steps, buttons that open it inside wallet apps, a link to paste, manual sending).
const qrText = (c, chainId) => payUrl(c, chainId);

export function startCharge() {
  if (hasBrand(state.settings) && !brandPub()) ensureBrandKey().catch(() => {}); // ready for the next charge
  if (cur) return;
  const s = state.settings;
  if (!isAddress(s.address)) {
    toast(t('err.noAddress'), 'error');
    location.hash = '#/settings';
    return;
  }
  const items = state.cart.map(({ name, price, tax, qty }) => ({ name, price, tax, qty }));
  const tot = computeTotals(items, s.taxMode);
  if (!tot.total) return;
  if (tot.total > LIMITS.maxYen) {
    toast(t('err.tooMuch', { max: yen(LIMITS.maxYen) }), 'error');
    return;
  }
  const chains = activeChains();
  const now = Date.now();
  const c = {
    id: uid(),
    no: nextReceiptNo(),
    createdAt: now,
    expiresAt: now + s.expiryMin * 60_000,
    amountYen: tot.total,
    items,
    taxMode: s.taxMode,
    suffix: randInt(1, LIMITS.suffixMax), // invisible wei suffix that makes this charge's amount unique
    to: s.address,
    storeName: s.storeName,
    brandPub: hasBrand(s) ? brandPub() : '',
    brandColor: safeColor(s.brandColor),
    event: eventLine({ name: s.eventName, space: s.eventSpace }),
    chains,
    chainId: chains[0],
    startBlocks: {},
    network: s.network,
    desc: summarizeItems(items, 32),
    ...relayFields(gaslessReady(chains)),
  };
  state.pending = c;
  savePending();
  unlockAudio();
  open(c);
}

/** After a reload, pick the open charge back up and keep listening. */
export function resumeCharge() {
  const c = state.pending;
  if (cur || !c) return;
  if (!Array.isArray(c.chains) || !c.chains.length || !isAddress(c.to) || !Number.isInteger(c.amountYen)) {
    state.pending = null;
    savePending();
    return;
  }
  c.startBlocks = c.startBlocks || {};
  open(c);
}

function open(c) {
  bind();
  cur = { c, watchers: new Map(), others: [], phase: 'waiting', rpc: {}, sale: null, present: false, receiptLink: '' };
  document.body.classList.add('charging');
  $('#overlay').hidden = false;
  render();
  for (const id of c.chains) startWatcher(id);
  if (c.relayChannel) {
    cur.stopRelay = startDeviceRelay(c, (st, info) => {
      if (!cur || cur.c !== c) return;
      cur.relay = { st, info };
      updateRelay();
    });
  }
  cur.tick = setInterval(tick, 1000);
  tick();
  cur.wl = wakeLock();
  cur.wl.on();
}

/** A no-fee charge gets a channel and a one-off key; customers only trust replies signed by it. */
function relayFields(on) {
  if (!on) return { relayChannel: '', relayKey: '', relayPub: '' };
  const d = randomPrivateKey();
  return { relayChannel: newChannel(), relayKey: privateKeyToHex(d), relayPub: schnorrPublicKey(d) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startWatcher(id) {
  const c = cur.c;
  const w = new Watcher({
    chainId: id,
    to: c.to,
    startBlock: c.startBlocks[id] ?? null,
    createdAt: c.createdAt,
    onStart: (b) => {
      c.startBlocks[id] = b;
      if (state.pending === c) savePending();
    },
    onTransfer: (tr) => onTransfer(id, tr),
    onState: (st) => {
      if (!cur || cur.c !== c) return;
      cur.rpc[id] = st;
      updateListen();
    },
  });
  cur.watchers.set(id, w);
  w.start();
}

function stopWatchers() {
  if (!cur) return;
  for (const w of cur.watchers.values()) w.stop();
  cur.stopRelay?.();
  cur.stopRelay = null;
}

function onTransfer(chainId, tr) {
  if (!cur || cur.phase === 'paid' || cur.phase === 'ended') return;
  if (consumedKeys().has(keyOf(tr))) return;
  const c = cur.c;
  if (isTipValue(tr.value)) return; // a supporter's tip (応援) from the store page: never a sale, never offered to staff as one
  const match = tr.value === expectedWei(c) ? 'exact' : tr.value === yenToWei(c.amountYen) ? 'amount' : '';
  if (match) return verifyThenPay(chainId, tr, match);
  if (!cur.others.some((o) => keyOf(o) === keyOf(tr))) {
    cur.others.push({ ...tr, chainId });
    renderOthers();
  }
}

/** A payment seen on one node is confirmed on a node run by someone else before it counts. */
async function verifyThenPay(chainId, tr, match) {
  const c = cur.c;
  const key = keyOf(tr);
  cur.verifying ||= new Set();
  if (cur.verifying.has(key)) return;
  cur.verifying.add(key);
  updateListen();
  const until = Date.now() + 120_000;
  let verdict = 'pending';
  while (Date.now() < until) {
    verdict = await confirmElsewhere(chainId, tr);
    if (verdict !== 'pending' && verdict !== 'unavailable') break;
    if (!cur || cur.c !== c || cur.phase === 'paid' || cur.phase === 'ended') return;
    await sleep(3000);
  }
  if (!cur || cur.c !== c) return;
  cur.verifying.delete(key);
  updateListen();
  if (cur.phase === 'paid' || cur.phase === 'ended') return;
  if (verdict === 'ok' || verdict === 'single') return markPaid(tr, chainId, match);
  // Nobody else confirms it: show it to staff instead of booking it automatically.
  if (!cur.others.some((o) => keyOf(o) === key)) {
    cur.others.push({ ...tr, chainId, unverified: true });
    renderOthers();
  }
}

function makeSale(c, tr, chainId, match, paidAt = Date.now()) {
  return {
    id: c.id,
    no: c.no,
    createdAt: c.createdAt,
    paidAt,
    amountYen: c.amountYen,
    items: c.items,
    taxMode: c.taxMode,
    chainId,
    testnet: !!CHAINS[chainId]?.testnet,
    txHash: tr.txHash,
    logIndex: tr.logIndex,
    blockNumber: tr.blockNumber,
    from: tr.from,
    to: c.to,
    valueWei: tr.value.toString(),
    match,
    confirmed: false,
    conf: 0,
    desc: c.desc,
    ev: c.event || '',
  };
}

function markPaid(tr, chainId, match) {
  if (!cur || cur.phase === 'paid' || cur.phase === 'ended') return;
  if (consumedKeys().has(keyOf(tr))) return;
  const c = cur.c;
  stopWatchers();
  const sale = makeSale(c, tr, chainId, match);
  state.sales.unshift(sale);
  saveSales();
  state.pending = null;
  savePending();
  state.cart = [];
  saveCart();
  cur.phase = 'paid';
  cur.sale = sale;
  exitPresent();
  render();
  if (state.settings.sound) chime();
  try { navigator.vibrate?.(80); } catch { /* ignore */ }
  trackConfirmations(sale);
  emit('sale', sale);
  emit('cart');
}

// ---- rendering ----
function render() {
  if (!cur) return;
  const ov = $('#overlay');
  const view = cur.phase === 'paid' ? paidHtml() : cur.phase === 'ended' ? endedHtml() : waitingHtml();
  ov.innerHTML = String(view);
  ov.classList.toggle('present', cur.present);
  if (cur.phase === 'paid') fillReceiptQr();
  else if (cur.phase !== 'ended') {
    updateListen();
    updateRelay();
    renderOthers();
    tick();
  }
  ov.querySelector('[autofocus]')?.focus({ preventScroll: true });
}
export const rerenderCharge = () => render();

const storeLine = (cls) => {
  const s = state.settings;
  const logo = validLogo(s.logo);
  const ev = eventLine({ name: s.eventName, space: s.eventSpace });
  return html`${s.storeName || logo ? html`<p class="${cls}">${logo ? html`<img src="${logo}" alt="">` : ''}<span>${s.storeName}</span></p>` : ''}${ev ? html`<p class="${cls}-event">${ev}</p>` : ''}`;
};

function waitingHtml() {
  const c = cur.c;
  const s = state.settings;
  const test = !!CHAINS[c.chainId]?.testnet;
  return html`<div class="charge" data-phase="${cur.phase}" role="dialog" aria-modal="true" aria-label="${t('charge.title')}">
    <div class="charge-bill">
      ${storeLine('bill-store')}
      <p class="bill-no">${t('charge.no', { no: c.no })}</p>
      <p class="bill-amount">${yen(c.amountYen)}</p>
      ${c.desc ? html`<p class="bill-desc">${c.desc}</p>` : ''}
      ${test ? html`<p class="bill-test">${t('charge.testNote')}</p>` : ''}
    </div>
    <div class="charge-stage">
      <div class="tent">
        ${c.chains.length > 1
          ? html`<div class="chain-tabs" role="tablist" aria-label="${t('charge.chainLabel')}">${c.chains.map((id) => html`<button type="button" role="tab" aria-selected="${String(id === c.chainId)}" data-act="chain" data-v="${id}">${chainName(id)}</button>`)}</div>`
          : html`<p class="tent-chain">${t('charge.onChain', { chain: chainName(c.chainId) })}</p>`}
        <div class="qr-frame" id="qr-frame">
          ${raw(qrSvg(forQr(qrText(c, c.chainId)), { ecl: 'M', title: t('charge.qrTitle') }))}
          <span class="qr-expired" aria-hidden="true">${t('charge.expiredLabel')}</span>
        </div>
        <p class="tent-hint">${t('charge.hintWeb')}</p>
      </div>
      <div class="charge-side">
        <p class="listen" id="listen" aria-live="polite"></p>
        <p class="countdown" id="countdown"></p>
        ${c.relayChannel && c.chainId === gasChainId() ? html`<p class="relay-line" id="relay-line" data-st="listening">${t('charge.freeOn')}</p>` : ''}
        <div class="tool-row">
          <button type="button" class="btn quiet" data-act="copy">${icon('copy')}<span>${t('charge.copy')}</span></button>
          ${navigator.share ? html`<button type="button" class="btn quiet" data-act="share">${icon('share')}<span>${t('charge.share')}</span></button>` : ''}
          <button type="button" class="btn quiet" data-act="present">${icon('expand')}<span>${t('charge.present')}</span></button>
        </div>
        <details class="txcheck">
          <summary>${t('charge.checkTx')}</summary>
          <form class="txcheck-form" data-form="tx" novalidate>
            <input name="hash" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="0x…" aria-label="${t('charge.txLabel')}">
            <button type="submit" class="btn">${t('charge.txCheck')}</button>
          </form>
          <p class="field-msg" id="tx-msg" role="status"></p>
        </details>
        <div id="others"></div>
        <div class="charge-foot">
          <button type="button" class="btn danger-ghost" data-act="cancel">${t('charge.cancel')}</button>
          <button type="button" class="btn ${cur.phase === 'expired' ? 'primary' : 'ghost'}" data-act="extend" id="extend-btn">${t('charge.extend')}</button>
        </div>
      </div>
    </div>
    <button type="button" class="btn present-exit" data-act="present-exit">${icon('back')}<span>${t('charge.presentExit')}</span></button>
  </div>`;
}

export function confText(s) {
  const need = CHAINS[s.chainId]?.confirmations || 1;
  if (s.flag === 'failed') return t('status.failed');
  return s.confirmed ? t('status.confirmed') : t('status.confirming', { n: Math.min(s.conf || 0, need), need });
}

function paidHtml() {
  const s = cur.sale;
  const got = BigInt(s.valueWei);
  const short = got / UNIT !== BigInt(s.amountYen);
  return html`<div class="charge" data-phase="paid" role="dialog" aria-modal="true" aria-label="${t('charge.paidTitle')}">
    <div class="paid">
      <div class="paid-slip">
        ${storeLine('slip-store')}
        <p class="bill-no">${t('charge.no', { no: s.no })}</p>
        <p class="bill-amount">${yen(s.amountYen)}</p>
        <div class="paid-stamp stamp">${stampSvg(s.paidAt)}</div>
        <p class="paid-title">${t('charge.paidTitle')}</p>
        <p class="paid-sub">${t('charge.paidVia', { chain: chainName(s.chainId) })}</p>
        ${s.match !== 'exact' ? html`<p class="paid-flag">${t('match.' + s.match)}</p>` : ''}
        <dl class="kv">
          ${short ? html`<div><dt>${t('charge.received')}</dt><dd>${formatUnits(got, 18, 2)} JPYC</dd></div>` : ''}
          <div><dt>${t('rc.from')}</dt><dd>${shortAddr(s.from)}</dd></div>
          <div><dt>${t('rc.tx')}</dt><dd><a href="${explorerTx(s.chainId, s.txHash)}" target="_blank" rel="noopener noreferrer">${shortHash(s.txHash)}</a></dd></div>
          <div><dt>${t('charge.status')}</dt><dd id="conf">${confText(s)}</dd></div>
        </dl>
      </div>
      <div class="paid-receipt">
        <div class="qr-frame small" id="rc-qr"></div>
        <p class="tent-hint">${t('charge.receiptHint')}</p>
        <button type="button" class="btn quiet" data-act="copy-receipt">${icon('copy')}<span>${t('charge.copyReceipt')}</span></button>
      </div>
      <div class="paid-actions">
        <button type="button" class="btn ghost" data-act="print">${icon('print')}<span>${t('charge.print')}</span></button>
        <button type="button" class="btn primary big" data-act="next" autofocus>${t('charge.next')}</button>
      </div>
    </div>
  </div>`;
}

function endedHtml() {
  const c = cur.c;
  return html`<div class="charge" data-phase="ended" role="dialog" aria-modal="true" aria-label="${t('charge.endedTitle')}">
    <div class="ended">
      <p class="bill-no">${t('charge.no', { no: c.no })}</p>
      <p class="bill-amount">${yen(c.amountYen)}</p>
      <h2 class="ended-title">${t('charge.endedTitle')}</h2>
      <p class="ended-text">${t('charge.endedText')}</p>
      <div class="paid-actions">
        <a class="btn ghost" href="#/sales" data-act="close">${t('charge.toSales')}</a>
        <button type="button" class="btn primary big" data-act="close" autofocus>${t('charge.backToRegister')}</button>
      </div>
    </div>
  </div>`;
}

async function fillReceiptQr() {
  const sale = cur?.sale;
  if (!sale) return;
  const link = await receiptUrl(receiptFromSale(sale, state.settings));
  if (!cur || cur.sale !== sale) return;
  cur.receiptLink = link;
  const box = $('#rc-qr');
  if (box) box.innerHTML = qrSvg(forQr(link), { ecl: 'L', title: t('charge.receiptQr') });
}

function updateListen() {
  const el = $('#listen');
  if (!el || !cur) return;
  const c = cur.c;
  const sep = t('common.sep');
  const bad = c.chains.filter((id) => cur.rpc[id] === 'error');
  const ok = c.chains.some((id) => cur.rpc[id] === 'ok');
  el.dataset.state = bad.length === c.chains.length ? 'bad' : bad.length ? 'partial' : ok ? 'ok' : 'start';
  const text = cur.verifying?.size
    ? t('charge.verifying')
    : bad.length
    ? t('charge.rpcError', { chains: bad.map(chainName).join(sep) })
    : ok ? t('charge.listening', { chains: c.chains.map(chainName).join(sep) }) : t('charge.connecting');
  el.innerHTML = String(html`<span class="pulse" aria-hidden="true"></span><span>${text}</span>`);
}

function updateRelay() {
  const el = $('#relay-line');
  if (!el || !cur?.relay) return;
  const { st, info } = cur.relay;
  el.dataset.st = st;
  el.textContent = st === 'relaying' ? t('charge.relayBusy') : st === 'sent' ? t('charge.relaySent') : st === 'error' ? t('charge.relayError', { code: info }) : t('charge.freeOn');
}

function renderOthers() {
  const box = $('#others');
  if (!box || !cur) return;
  if (!cur.others.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = String(html`<div class="others">
    <p class="others-title">${t('charge.others')}</p>
    <ul class="others-list">${cur.others.map((o, i) => html`<li>
      <span class="o-amt">${formatUnits(o.value, 18, 2)} JPYC</span>
      <span class="o-meta">${chainName(o.chainId)} ${shortAddr(o.from)}${o.unverified ? html`<small class="o-warn">${t('charge.unverified')}</small>` : ''}</span>
      <button type="button" class="btn small" data-act="use-other" data-i="${i}">${t('charge.useThis')}</button>
    </li>`)}</ul>
  </div>`);
}

function tick() {
  if (!cur || cur.phase === 'paid' || cur.phase === 'ended') return;
  const c = cur.c;
  const now = Date.now();
  const left = c.expiresAt - now;
  const cd = $('#countdown');
  const phase = left > 0 ? 'waiting' : 'expired';
  if (phase !== cur.phase) {
    cur.phase = phase;
    const el = $('#overlay .charge');
    if (el) el.dataset.phase = phase;
    const ext = $('#extend-btn');
    ext?.classList.toggle('primary', phase === 'expired');
    ext?.classList.toggle('ghost', phase !== 'expired');
  }
  if (left > 0) {
    if (cd) cd.textContent = t('charge.expiresIn', { time: mmss(left) });
    return;
  }
  const grace = c.expiresAt + GRACE_MS - now;
  if (grace > 0) {
    if (cd) cd.textContent = t('charge.expiredWait', { time: mmss(grace) });
    return;
  }
  const settled = [...cur.watchers.values()].every((w) => w.scanned != null && !w.fail);
  if (settled || grace < -60_000) endUnpaid('expired');
  else if (cd) cd.textContent = t('charge.finalCheck');
}

function endUnpaid(status) {
  if (!cur) return;
  const c = cur.c;
  stopWatchers();
  clearInterval(cur.tick);
  state.unpaid = [{ ...c, status, endedAt: Date.now() }, ...state.unpaid.filter((u) => u.id !== c.id)];
  saveUnpaid();
  if (state.pending?.id === c.id) {
    state.pending = null;
    savePending();
  }
  emit('unpaid');
  if (status === 'cancelled') {
    closeCharge();
    toast(t('charge.cancelledToast'));
    return;
  }
  cur.phase = 'ended';
  exitPresent();
  render();
}

export function closeCharge() {
  if (!cur) return;
  stopWatchers();
  clearInterval(cur.tick);
  cur.wl?.off();
  exitPresent();
  cur = null;
  const ov = $('#overlay');
  ov.hidden = true;
  ov.innerHTML = '';
  ov.classList.remove('present');
  document.body.classList.remove('charging');
  emit('charge-closed');
}

function enterPresent() {
  if (!cur) return;
  cur.present = true;
  $('#overlay').classList.add('present');
  try { document.documentElement.requestFullscreen?.()?.catch?.(() => {}); } catch { /* not supported */ }
}

function exitPresent() {
  if (!cur) return;
  cur.present = false;
  $('#overlay')?.classList.remove('present');
  try { if (document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {}); } catch { /* ignore */ }
}

// ---- actions ----
function bind() {
  if (bound) return;
  bound = true;
  const ov = $('#overlay');
  ov.addEventListener('click', onClick);
  ov.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form="tx"]');
    if (!f) return;
    e.preventDefault();
    checkTx(f.elements.namedItem('hash').value, f.querySelector('button'));
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && cur?.present) exitPresent();
  });
  document.addEventListener('keydown', (e) => {
    if (cur?.present && e.key === 'Escape') exitPresent();
  });
  on('sale', (s) => {
    if (cur?.sale && cur.sale.id === s.id) {
      const el = $('#conf');
      if (el) el.textContent = confText(s);
    }
  });
}

async function onClick(e) {
  if (!cur) return;
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const c = cur.c;
  switch (b.dataset.act) {
    case 'chain': {
      const id = Number(b.dataset.v);
      if (!c.chains.includes(id) || id === c.chainId) return;
      c.chainId = id;
      savePending();
      render();
      break;
    }
    case 'copy': {
      const ok = await copyText(qrText(c, c.chainId));
      toast(ok ? t('common.copied') : t('common.copyFailed'), ok ? 'info' : 'error');
      break;
    }
    case 'share':
      try {
        await navigator.share({ title: t('charge.shareTitle', { store: c.storeName || 'Reji' }), text: t('charge.shareText', { amount: yen(c.amountYen) }), url: payUrl(c, c.chainId) });
      } catch { /* dismissed */ }
      break;
    case 'present':
      enterPresent();
      break;
    case 'present-exit':
      exitPresent();
      break;
    case 'extend':
      c.expiresAt = Math.max(Date.now(), c.expiresAt) + EXTEND_MS;
      savePending();
      cur.phase = 'waiting';
      render();
      toast(t('charge.extended'));
      break;
    case 'cancel': {
      const ok = await confirmDialog({ title: t('charge.cancelTitle'), body: t('charge.cancelBody'), ok: t('charge.cancelOk'), cancel: t('charge.keepWaiting'), danger: true });
      if (ok && cur && cur.c === c && cur.phase !== 'paid' && cur.phase !== 'ended') endUnpaid('cancelled');
      break;
    }
    case 'use-other':
      useOther(Number(b.dataset.i));
      break;
    case 'print':
      printSale(cur.sale);
      break;
    case 'copy-receipt': {
      const link = cur.receiptLink || (await receiptUrl(receiptFromSale(cur.sale, state.settings)));
      const ok = await copyText(link);
      toast(ok ? t('common.copied') : t('common.copyFailed'), ok ? 'info' : 'error');
      break;
    }
    case 'next':
    case 'close':
      closeCharge();
      break;
    default:
  }
}

async function useOther(i) {
  const o = cur?.others[i];
  if (!o) return;
  const c = cur.c;
  const vars = { got: formatUnits(o.value, 18, 2), want: yen(c.amountYen) };
  const short = o.value < yenToWei(c.amountYen);
  const ok = await confirmDialog({
    title: t('charge.useTitle'),
    body: short ? t('charge.useShort', vars) : t('charge.useBody', vars),
    ok: t('charge.useOk'),
    danger: short,
  });
  if (ok && cur && cur.c === c) markPaid(o, o.chainId, 'manual');
}

/** Staff can paste a transaction ID when a payment didn't match automatically. */
async function checkTx(hash, btn) {
  const msg = (text, kind = '') => {
    const el = $('#tx-msg');
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind;
  };
  const h = String(hash || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) return msg(t('charge.txInvalid'), 'error');
  const c = cur.c;
  btn.disabled = true;
  msg(t('charge.txChecking'));
  let found = null;
  for (const id of [c.chainId, ...c.chains.filter((x) => x !== c.chainId)]) {
    try {
      const rc = await txReceipt(id, h);
      if (rc) {
        found = { id, rc };
        break;
      }
    } catch { /* try the next chain */ }
  }
  btn.disabled = false;
  if (!cur || cur.c !== c || cur.phase === 'paid' || cur.phase === 'ended') return;
  if (!found) return msg(t('charge.txNotFound'), 'error');
  if (found.rc.status !== '0x1') return msg(t('charge.txFailed'), 'error');
  const trs = transfersInReceipt(found.rc, c.to);
  if (!trs.length) return msg(t('charge.txNoTransfer'), 'error');
  const used = consumedKeys();
  const fresh = trs.filter((x) => !used.has(keyOf(x)));
  if (!fresh.length) return msg(t('charge.txUsed'), 'error');
  const exp = expectedWei(c);
  const base = yenToWei(c.amountYen);
  const hit = fresh.find((x) => x.value === exp) || fresh.find((x) => x.value === base);
  if (hit) return markPaid(hit, found.id, hit.value === exp ? 'exact' : 'amount');
  for (const x of fresh) if (!cur.others.some((o) => keyOf(o) === keyOf(x))) cur.others.push({ ...x, chainId: found.id });
  renderOthers();
  msg(t('charge.txDifferent'));
}

export async function printSale(sale) {
  if (!sale) return;
  const r = receiptFromSale(sale, state.settings);
  const link = await receiptUrl(r);
  printHtml(html`${renderReceipt(r, { logo: validLogo(state.settings.logo) })}<div class="rc-qr">${raw(qrSvg(forQr(link), { ecl: 'L', margin: 2 }))}<p>${t('rc.qrNote')}</p></div>`, { width: state.settings.receiptWidth });
}

// ---- confirmations: a sale shows as paid at once, then "confirmed" after N blocks ----
const tracking = new Set();
export function trackConfirmations(sale) {
  if (!sale?.txHash || sale.confirmed || sale.flag === 'failed' || tracking.has(sale.id)) return;
  const ch = CHAINS[sale.chainId];
  if (!ch) return;
  tracking.add(sale.id);
  const started = Date.now();
  const step = async () => {
    let done = false;
    try {
      const [rc, latest] = await Promise.all([txReceipt(sale.chainId, sale.txHash), blockNumber(sale.chainId)]);
      if (rc?.blockNumber) {
        if (rc.status === '0x0') {
          patchSale(sale.id, { flag: 'failed' });
          done = true;
        } else {
          const bn = Number(BigInt(rc.blockNumber));
          const conf = Math.max(1, latest - bn + 1);
          done = conf >= ch.confirmations;
          patchSale(sale.id, { conf, blockNumber: bn, confirmed: done });
        }
      }
    } catch { /* retry on the next round */ }
    if (!done && Date.now() - started < 30 * 60_000) setTimeout(step, Math.max(3000, ch.poll));
    else tracking.delete(sale.id);
  };
  step();
}

function patchSale(id, patch) {
  const s = state.sales.find((x) => x.id === id);
  if (!s) return;
  if (!Object.keys(patch).some((k) => s[k] !== patch[k])) return;
  Object.assign(s, patch);
  saveSales();
  if (cur?.sale?.id === id && cur.sale !== s) Object.assign(cur.sale, patch);
  emit('sale', s);
}

// ---- unpaid charges: look again for a late payment ----
export async function recheckUnpaid(u, onProgress) {
  const used = consumedKeys();
  const exp = yenToWei(u.amountYen) + BigInt(u.suffix);
  const base = yenToWei(u.amountYen);
  const others = [];
  for (const id of u.chains) {
    const ch = CHAINS[id];
    if (!ch) continue;
    const latest = await blockNumber(id);
    let from = u.startBlocks?.[id];
    if (from == null) from = Math.max(0, latest - Math.ceil((Date.now() - u.createdAt) / 1000 / ch.blockTime) - 30);
    const to = Math.min(latest, from + Math.ceil(86_400 / ch.blockTime) + 100); // up to a day after the charge
    if (to < from) continue;
    const found = await scanTransfers(id, u.to, from, to, {
      chunk: 2000,
      maxChunks: 400,
      onProgress: (at) => onProgress?.(id, Math.min(99, Math.round(((at - from) / Math.max(1, to - from + 1)) * 100))),
    });
    for (const tr of found) {
      if (used.has(keyOf(tr))) continue;
      if (tr.value === exp || tr.value === base) return { hit: tr, chainId: id, match: tr.value === exp ? 'exact' : 'amount', others };
      others.push({ ...tr, chainId: id });
    }
  }
  return { hit: null, others };
}

export async function bookUnpaid(u, tr, chainId, match) {
  if (consumedKeys().has(keyOf(tr))) throw new Error('already used');
  let paidAt = Date.now();
  try {
    const b = await rpc(chainId, 'eth_getBlockByNumber', ['0x' + tr.blockNumber.toString(16), false]);
    if (b?.timestamp) paidAt = Number(BigInt(b.timestamp)) * 1000;
  } catch { /* keep "now" */ }
  const sale = makeSale(u, tr, chainId, match, paidAt);
  sale.late = true;
  state.sales.unshift(sale);
  state.sales.sort((a, b) => (b.paidAt || b.createdAt) - (a.paidAt || a.createdAt));
  saveSales();
  state.unpaid = state.unpaid.filter((x) => x.id !== u.id);
  saveUnpaid();
  emit('sale', sale);
  trackConfirmations(sale);
  return sale;
}
