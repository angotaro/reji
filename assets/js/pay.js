// Customer pay page. Opened from the register's QR; all data comes from the URL
// and is treated as untrusted. Payment goes wallet-to-wallet (JPYC.transfer).
import { html, $, yen, fmtInt, shortAddr, copyText, toast, store, mmss, attr, b64urlDecode, inAppBrowser } from './util.js';
import { t, getLang, setLang } from './i18n.js';
import { CHAINS, JPYC, LIMITS, chainName, explorerTx } from './config.js';
import { addressStatus, checksum, yenToWei, formatUnits, exactUnits, eip681, sameAddress, isTipValue } from './evm.js';
import { rpc, tokenBalance, nativeBalance, txReceipt, scanTransfers, transfersInReceipt, Watcher, blockNumber } from './rpc.js';
import { discoverWallets, connect, ensureChain, sendTransfer, watchAsset, walletDeepLinks, isUserRejection, nativeSymbol, pageLinkForWallet, watchDeepLinks, walletRpcFailed, repairChain } from './wallet.js';
import { receiptUrl, sanitizeReceipt } from './receipt.js';
import { icon, stampSvg } from './ui.js';
import { applyBrandColor, cachedBrand, fetchBrand, eventLine, storePageUrl } from './brand.js';
import { storeCard } from './storecard.js';

const RKEY = 'reji:receipts:v1';
const TKEY = 'reji:tips:v1'; // tips this phone sent
const app = $('#pay');

function parse() {
  const q = new URLSearchParams(location.search);
  const tip = q.get('tip') === '1'; // a supporter's tip (応援) from a store page, not a sale
  const to = q.get('to') || '';
  const chainId = Number(q.get('c'));
  const amountYen = Number(q.get('a'));
  const suffix = tip ? LIMITS.tipMark : q.get('u') == null ? 0 : Number(q.get('u'));
  const exp = !tip && q.get('e') ? Number(q.get('e')) : 0;
  if (addressStatus(to) !== 'ok' || !CHAINS[chainId]) return null;
  if (!Number.isInteger(amountYen) || amountYen < (tip ? LIMITS.tipMin : 1) || amountYen > (tip ? LIMITS.tipMax : LIMITS.maxYen)) return null;
  if (!tip && (!Number.isInteger(suffix) || suffix < 0 || suffix > LIMITS.suffixMax)) return null;
  if (!Number.isFinite(exp) || exp < 0) return null;
  const clean = (v, n) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n);
  const hex43 = (k) => (/^[A-Za-z0-9_-]{43}$/.test(q.get(k) || '') ? Array.from(b64urlDecode(q.get(k)), (x) => x.toString(16).padStart(2, '0')).join('') : '');
  return {
    tip,
    to: checksum(to),
    chainId,
    amountYen,
    suffix,
    value: yenToWei(amountYen) + BigInt(suffix),
    store: clean(q.get('s'), 60),
    no: tip ? '' : clean(q.get('r'), 40),
    desc: tip ? '' : clean(q.get('d'), 120),
    exp: exp ? exp * 1000 : 0,
    channel: !tip && (chainId === 137 || chainId === 80002) && /^[0-9a-f]{32}$/.test(q.get('n') || '') && /^[A-Za-z0-9_-]{43}$/.test(q.get('k') || '') ? q.get('n') : '',
    relayPub: tip ? '' : hex43('k'),
    brandPub: hex43('b'),
    brandColor: /^[0-9a-fA-F]{6}$/.test(q.get('bc') || '') ? '#' + q.get('bc').toUpperCase() : '',
  };
}

const req = parse();
const S = { phase: req ? 'loading' : 'invalid', wallets: [], wallet: null, account: '', bal: null, gas: null, elsewhere: [], tx: '', error: '', receiptLink: '', paidAt: 0, relay: null, relayFailed: false, pool: null, waitUntil: 0 };
// The store's look: colour at once from the link, logo/message/link from its signed profile.
S.brand = req?.brandPub ? cachedBrand(req.brandPub) : null;
if (req) applyBrandColor(document.documentElement, req.brandColor || S.brand?.color || '');
// A tip link is trusted only when the store's own signed profile agrees on where tips go
// (the wallet signed it); a crafted link with another address is refused.
const tipOk = (b) => !!b?.tip && sameAddress(b.tip.to, req.to) && b.tip.chains.includes(req.chainId);
if (req?.tip) S.tipCheck = !req.brandPub ? 'bad' : tipOk(S.brand) ? 'ok' : 'checking';
function loadBrand() {
  if (!req?.brandPub) return;
  fetchBrand(req.brandPub).then((b) => {
    if (req.tip) S.tipCheck = b ? (tipOk(b) ? 'ok' : b.tip ? 'bad' : 'off') : S.tipCheck === 'ok' ? 'ok' : 'unknown';
    if (b) {
      S.brand = b;
      if (!req.brandColor) applyBrandColor(document.documentElement, b.color);
    }
    render();
  }).catch(() => {
    if (req.tip && S.tipCheck !== 'ok') S.tipCheck = 'unknown';
    render();
  });
}
loadBrand();
const expired = () => !!req?.exp && Date.now() > req.exp;
const validText = () => (expired() ? t('pay.expiredShort') : mmss(req.exp - Date.now()));

function errText(e) {
  const m = String(e?.data?.message || e?.shortMessage || e?.message || e || '');
  if (/insufficient funds|exceeds balance|gas required exceeds/i.test(m)) return t('pay.errFunds');
  return m.slice(0, 160) || t('pay.tryAgain');
}

// ---------- render ----------
function render() {
  document.title = !req ? t('pay.titleGeneric') : req.tip ? t('pay.tipTitle', { store: req.store || t('pay.theStore') }) : `${yen(req.amountYen)} ${req.store || t('pay.titleGeneric')}`;
  const test = req && CHAINS[req.chainId].testnet;
  app.innerHTML = String(html`<header class="noren pay-top">
      <span class="pay-store">${S.brand?.logo ? html`<img class="store-logo${S.logoShown ? ' shown' : ''}" src="${S.brand.logo}" alt="">` : ''}<span class="brand-name">${req?.store || t('pay.titleGeneric')}</span></span>
      <button type="button" class="lang-btn" data-act="lang" lang="${getLang() === 'ja' ? 'en' : 'ja'}">${getLang() === 'ja' ? 'EN' : '日本語'}</button>
    </header>
    ${test ? html`<p class="test-strip">${t('pay.testStrip')}</p>` : ''}
    <main class="pay-main">
      ${req ? billHtml() : ''}
      <section class="pay-panel" aria-live="polite">${panelHtml()}</section>
    </main>
    <footer class="pay-foot"><p>${t(req?.tip ? 'pay.tipFooter' : 'pay.footer')}</p><p><a href="receipt.html">${t('pay.myReceipts')}</a></p></footer>`);
  if (S.brand?.logo) S.logoShown = true;
  if (S.phase === 'ready' && !S.wallets.length) watchManual();
}

function billHtml() {
  const done = S.phase === 'done';
  return html`<div class="bill${done ? ' is-paid' : ''}">
    <p class="bill-label">${t(req.tip ? 'pay.tipLabel' : 'pay.billLabel')}</p>
    <p class="bill-amount">${yen(req.amountYen)}</p>
    <p class="bill-sub">${t('pay.inJpyc', { amount: fmtInt(req.amountYen) })}</p>
    ${req.desc ? html`<p class="bill-desc">${req.desc}</p>` : ''}
    ${eventLine(S.brand?.event) ? html`<p class="bill-event">${icon('pin')}<span>${eventLine(S.brand.event)}</span></p>` : ''}
    <dl class="kv bill-kv">
      ${req.no ? html`<div><dt>${t('rc.no')}</dt><dd>${req.no}</dd></div>` : ''}
      <div><dt>${t('pay.network')}</dt><dd>${chainName(req.chainId)}</dd></div>
      <div><dt>${t(req.tip ? 'pay.tipTo' : 'pay.to')}</dt><dd title="${req.to}">${shortAddr(req.to)}</dd></div>
      ${req.exp && !['done', 'confirming', 'slow', 'relaying', 'waitexpire', 'signing'].includes(S.phase) ? html`<div><dt>${t('pay.validFor')}</dt><dd id="valid">${validText()}</dd></div>` : ''}
    </dl>
    ${done ? html`<div class="bill-stamp stamp">${stampSvg(S.paidAt, req.tip ? { label: t('pay.tipStampLabel'), bottom: t('pay.tipStamp') } : {})}</div>` : ''}
  </div>`;
}

function manualHtml() {
  const row = (k, v, copy) => html`<div><dt>${k}</dt><dd><code>${v}</code>${copy ? html`<button type="button" class="icon-btn" data-act="copy" data-v="${v}" aria-label="${t('common.copy')}">${icon('copy')}</button>` : ''}</dd></div>`;
  const ch = CHAINS[req.chainId];
  return html`<details class="manual">
    <summary>${t('pay.manual')}</summary>
    <p class="fine">${t('pay.manualText', { yen: fmtInt(req.amountYen) })}</p>
    <dl class="kv copyable">
      ${row(t('pay.network'), `${ch.fullName || ch.name} (${req.chainId})`, false)}
      ${row(t('pay.token'), JPYC.address, true)}
      ${row(t('pay.to'), req.to, true)}
      ${row(t('pay.amountExact'), exactUnits(req.value), true)}
    </dl>
  </details>`;
}

/** HashPort Wallet can't be reached from a web page (no in-app browser access, no links), but its own
 *  送る screen works for everyone: copy the address here, paste it there, type the yen amount. This page
 *  then spots the payment on chain and shows the receipt, as with a wallet-signed payment. */
function hpHtml() {
  if (req.tip) return html`<p class="notice hp-tipnote">${t('pay.hpTip')}</p>`;
  const yenStr = String(req.amountYen);
  return html`<section class="hp-card" aria-labelledby="hp-title">
    <h2 class="panel-title" id="hp-title">${t('pay.hpTitle')}</h2>
    <ol class="hp-steps">
      <li><span>${t('pay.hpStep1')}</span>
        <button type="button" class="btn primary" data-act="hp-addr">${icon('copy')}<span>${t('pay.hpCopyAddr')}</span></button>
        <code class="hp-addr">${req.to}</code></li>
      <li><span>${t('pay.hpStep2', { net: chainName(req.chainId) })}</span></li>
      <li><span>${t('pay.hpStep3', { yen: yenStr })}</span>
        <button type="button" class="btn ghost" data-act="hp-amt">${icon('copy')}<span>${t('pay.hpCopyAmt', { yen: yenStr })}</span></button></li>
    </ol>
    ${req.chainId === 137 ? html`<p class="fine">${t('pay.hpFree')}</p>` : ''}
    <p class="hp-wait">${icon('refresh')}<span>${t('pay.hpBack')}</span></p>
  </section>`;
}

// Payments sent from another app (HashPort's 送る screen, a copied address): watch the chain for them.
// Only blocks after this page opened count, so the previous customer's payment of the same amount is
// never taken for this one.
let manualWatch = null;
async function watchManual() {
  if (manualWatch || !req || req.tip || S.wallets.length || S.tx || S.phase !== 'ready' || expired()) return;
  manualWatch = 'starting';
  let head = null;
  try { head = await blockNumber(req.chainId); } catch { head = null; }
  if (manualWatch !== 'starting') return;
  const want = new Set([req.value.toString(), yenToWei(req.amountYen).toString()]); // exact, or the plain yen a wallet app sends
  manualWatch = new Watcher({
    chainId: req.chainId,
    to: req.to,
    startBlock: head == null ? null : head + 1,
    createdAt: Date.now(),
    onTransfer: (tr) => {
      if (S.tx || S.phase === 'done' || isTipValue(tr.value) || !want.has(tr.value.toString())) return;
      if (head != null && Number(tr.blockNumber) <= head) return;
      manualWatch?.stop?.();
      manualWatch = null;
      S.tx = tr.txHash;
      S.account = tr.from;
      finish();
    },
  });
  manualWatch.start();
  const stopAt = (req.exp || Date.now() + 15 * 60_000) + 5 * 60_000; // like the register: a little past expiry
  setTimeout(() => { manualWatch?.stop?.(); manualWatch = null; }, Math.max(0, stopAt - Date.now()));
}

/** When the browser has no wallet: what to do if the app doesn't open, or the wallet isn't listed. */
function otherWaysHtml() {
  const failed = S.openFailed ? walletDeepLinks().find((l) => l.id === S.openFailed)?.name || '' : '';
  return html`${failed ? html`<p class="notice warn open-failed" role="status">${t('pay.openFailed', { name: failed })}</p>` : ''}
    <details class="other-ways"${attr('open', !!failed)}>
      <summary>${t('pay.otherWays')}</summary>
      <ol class="ways">
        <li><span>${t('pay.wayCopy')}</span><button type="button" class="btn ghost" data-act="copy-page">${icon('copy')}<span>${t('pay.copyPage')}</span></button></li>
        ${req.tip ? '' : html`<li><span>${t('pay.wayWalletQr')}</span></li><li><span>${t('pay.wayManual')}</span></li>`}
      </ol>
    </details>`;
}

function tipGateHtml() {
  if (S.tipCheck === 'checking') return html`<p class="working"><span class="spinner" aria-hidden="true"></span>${t('pay.tipChecking')}</p>`;
  if (S.tipCheck === 'unknown') return html`<div class="notice warn"><p>${t('pay.tipUnknown')}</p></div><button type="button" class="btn primary" data-act="tip-recheck">${t('pay.tipRetry')}</button>`;
  return html`<div class="notice error"><p>${t(S.tipCheck === 'off' ? 'pay.tipOff' : 'pay.tipBad')}</p></div>
    ${req.brandPub ? html`<a class="btn ghost" href="${storePageUrl(req.brandPub)}">${icon('store')}<span>${t('pay.tipBack')}</span></a>` : ''}`;
}

function panelHtml() {
  if (req?.tip && S.tipCheck !== 'ok' && !['invalid', 'done'].includes(S.phase)) return tipGateHtml();
  const name = S.wallet?.name || '';
  switch (S.phase) {
    case 'invalid':
      return html`<div class="notice error"><h1>${t('pay.invalidTitle')}</h1><p>${t('pay.invalidText')}</p></div>`;
    case 'loading':
      return html`<p class="working"><span class="spinner" aria-hidden="true"></span>${t('pay.looking')}</p>`;
    case 'expired':
      return html`<div class="notice warn"><h1>${t('pay.expiredTitle')}</h1><p>${t('pay.expiredText')}</p></div>`;
    case 'ready':
      return html`${S.relay ? html`<p class="notice free">${t('pay.freeBadge')}</p>` : ''}${S.wallets.length
        ? html`<h2 class="panel-title">${t('pay.choose')}</h2>
          <div class="wallet-list">${S.wallets.map((w, i) => html`<button type="button" class="btn wallet-btn" data-act="pick" data-i="${i}">
            ${w.icon ? html`<img src="${w.icon}" alt="" width="28" height="28">` : icon('wallet')}<span>${t('pay.payWith', { name: w.name })}</span></button>`)}</div>`
        : html`${hpHtml()}
          <h2 class="panel-title">${t(req.tip ? 'pay.openIn' : 'pay.openInOther')}</h2>
          <p class="panel-text">${t('pay.openInText')}</p>
          ${inAppBrowser() ? html`<p class="notice warn in-app">${t('pay.inApp')}</p>` : ''}
          <div class="deep-links">${walletDeepLinks().map((l) => html`<a class="btn wallet-btn" data-deep="${l.id}" href="${l.href}" rel="noopener noreferrer">${icon('wallet')}<span>${l.name}</span></a>`)}</div>
          ${otherWaysHtml()}`}
        ${req.tip ? '' : manualHtml()}`;
    case 'connecting':
      return html`<p class="working"><span class="spinner" aria-hidden="true"></span>${t('pay.connecting', { name })}</p>
        <button type="button" class="btn quiet" data-act="back">${t('pay.back')}</button>`;
    case 'connected': {
      const sym = nativeSymbol(req.chainId);
      const low = S.bal != null && S.bal < req.value;
      const free = !!S.relay && !S.relayFailed;
      const noGas = !free && S.gas != null && S.gas === 0n;
      return html`<dl class="kv acct">
          <div><dt>${t('pay.account')}</dt><dd>${shortAddr(S.account)}</dd></div>
          <div><dt>${t('pay.balance')}</dt><dd>${S.bal == null ? '…' : `${formatUnits(S.bal, 18, 2)} JPYC`}</dd></div>
          ${free ? '' : html`<div><dt>${t('pay.gasBal', { sym })}</dt><dd>${S.gas == null ? '…' : `${formatUnits(S.gas, 18, 4)} ${sym}`}</dd></div>`}
        </dl>
        ${low ? html`<p class="notice warn">${t('pay.lowJpyc', { chain: chainName(req.chainId) })}${S.elsewhere.length ? ` ${t('pay.elsewhere', { chains: S.elsewhere.map(chainName).join(t('common.sep')) })}` : ''}</p>` : ''}
        ${noGas ? html`<p class="notice warn">${t('pay.noGas', { sym, chain: chainName(req.chainId) })}</p>` : ''}
        ${S.error ? html`<p class="notice error">${S.error}</p>` : ''}
        ${S.walletRpc ? html`<div class="notice warn wallet-rpc" role="alert">
          <p class="wallet-rpc-title">${t('pay.walletRpcTitle', { net: chainName(req.chainId) })}</p>
          <p>${t('pay.walletRpcText', { net: chainName(req.chainId) })}</p>
          <button type="button" class="btn primary" data-act="fix-rpc">${icon('refresh')}<span>${t('pay.walletRpcFix')}</span></button>
          <p class="fine">${t('pay.walletRpcManual', { net: chainName(req.chainId) })}</p>
          <p class="rpc-url"><code class="mono">${CHAINS[req.chainId].rpc[0]}</code><button type="button" class="btn quiet small" data-act="copy-rpc">${icon('copy')}<span>${t('common.copy')}</span></button></p>
          <p class="fine wallet-rpc-detail">${t('pay.walletRpcDetail', { msg: S.walletRpc })}</p>
        </div>` : ''}
        <button type="button" class="btn primary big pay-btn" data-act="send"${attr('disabled', low)}>${req.tip ? t('pay.tipSend', { amount: yen(req.amountYen) }) : free ? t('pay.payFree', { amount: yen(req.amountYen) }) : t('pay.payAmount', { amount: yen(req.amountYen) })}</button>
        <p class="fine">${free ? t('pay.freeNote') : t('pay.gasNote', { sym })}</p>
        <button type="button" class="btn quiet" data-act="back">${t('pay.otherWallet')}</button>`;
    }
    case 'signing':
      return html`<p class="working"><span class="spinner" aria-hidden="true"></span>${t('pay.signInWallet', { name })}</p>`;
    case 'relaying':
      return html`<p class="working"><span class="spinner" aria-hidden="true"></span>${t('pay.relaying')}</p>`;
    case 'waitexpire':
      return html`<p class="working"><span class="spinner" aria-hidden="true"></span><span>${t('pay.waitExpire')} <b id="wait-left">${mmss(Math.max(0, S.waitUntil * 1000 - Date.now()))}</b></span></p>`;
    case 'sending':
      return html`<p class="working"><span class="spinner" aria-hidden="true"></span>${t('pay.confirmInWallet', { name })}</p>`;
    case 'confirming':
      return html`<p class="working"><span class="spinner" aria-hidden="true"></span>${t('pay.sent')}</p>
        <a class="btn quiet" href="${explorerTx(req.chainId, S.tx)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${t('pay.viewTx')}</span></a>`;
    case 'slow':
      return html`<div class="notice warn"><h1>${t('pay.slowTitle')}</h1><p>${t('pay.slowText')}</p></div>
        <div class="btn-row">
          <button type="button" class="btn primary" data-act="recheck">${t('pay.checkAgain')}</button>
          <a class="btn quiet" href="${explorerTx(req.chainId, S.tx)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${t('pay.viewTx')}</span></a>
        </div>`;
    case 'failed':
      return html`<div class="notice error"><p>${S.error || t('pay.reverted')}</p></div>
        <button type="button" class="btn primary" data-act="retry">${t('pay.tryAgain')}</button>`;
    case 'done':
      if (req.tip) {
        return html`<h2 class="panel-title done-title">${icon('check')}<span>${t('pay.tipDoneTitle')}</span></h2>
        <p class="panel-text">${t('pay.tipDoneText', { store: req.store || t('pay.theStore'), amount: yen(req.amountYen) })}</p>
        ${S.brand?.msg ? html`<p class="store-msg">${S.brand.msg}</p>` : ''}
        ${req.brandPub ? html`<a class="btn primary big" href="${storePageUrl(req.brandPub)}">${icon('store')}<span>${t('pay.tipBack')}</span></a>` : ''}
        <div class="btn-row">
          <a class="btn quiet" href="${explorerTx(req.chainId, S.tx)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${t('pay.viewTx')}</span></a>
        </div>`;
      }
      return html`<h2 class="panel-title done-title">${icon('check')}<span>${t('pay.doneTitle')}</span></h2>
        <p class="panel-text">${t('pay.doneText', { store: req.store || t('pay.theStore') })}</p>
        ${S.brand?.msg ? html`<p class="store-msg">${S.brand.msg}</p>` : ''}
        <a class="btn primary big" href="${S.receiptLink || 'receipt.html'}">${icon('receipt')}<span>${t('pay.viewReceipt')}</span></a>
        <p class="fine">${t('pay.savedHint')}</p>
        ${S.brand ? html`<div class="done-store">${storeCard(S.brand, { name: req.store, compact: true })}<a class="btn ghost store-page" href="${storePageUrl(req.brandPub)}">${icon('store')}<span>${t('sc.openPage')}</span></a></div>` : ''}
        <div class="btn-row">
          <a class="btn quiet" href="${explorerTx(req.chainId, S.tx)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${t('pay.viewTx')}</span></a>
          ${S.wallet ? html`<button type="button" class="btn quiet" data-act="watch">${t('pay.addToken')}</button>` : ''}
        </div>`;
    default:
      return '';
  }
}

// ---------- flow ----------
let listening = null;
function listen(p) {
  if (listening === p || typeof p.on !== 'function') return;
  listening = p;
  p.on('accountsChanged', (a) => {
    if (!['connected', 'connecting'].includes(S.phase)) return;
    if (a?.[0]) {
      S.account = checksum(a[0]);
      S.bal = S.gas = null;
      render();
      loadBalances();
    } else {
      S.phase = 'ready';
      render();
    }
  });
}

async function loadBalances() {
  const acct = S.account;
  const [b, g] = await Promise.allSettled([tokenBalance(req.chainId, acct), nativeBalance(req.chainId, acct)]);
  if (acct !== S.account) return;
  S.bal = b.status === 'fulfilled' ? b.value : null;
  S.gas = g.status === 'fulfilled' ? g.value : null;
  S.elsewhere = [];
  if (S.bal != null && S.bal < req.value) {
    const test = CHAINS[req.chainId].testnet;
    const ids = Object.values(CHAINS).filter((c) => c.testnet === test && c.id !== req.chainId).map((c) => c.id);
    const res = await Promise.allSettled(ids.map((id) => tokenBalance(id, acct)));
    S.elsewhere = ids.filter((id, i) => res[i].status === 'fulfilled' && res[i].value >= req.value);
  }
  if (S.phase === 'connected' && acct === S.account) render();
}

async function pick(w) {
  if (!w) return;
  if (expired()) {
    S.phase = 'expired';
    render();
    return;
  }
  S.wallet = w;
  S.phase = 'connecting';
  S.error = '';
  render();
  try {
    S.account = checksum(await connect(w.provider));
  } catch (e) {
    S.phase = 'ready';
    render();
    toast(isUserRejection(e) ? t('pay.rejected') : errText(e), 'error');
    return;
  }
  listen(w.provider);
  try {
    await ensureChain(w.provider, req.chainId);
  } catch (e) {
    S.error = isUserRejection(e) ? t('pay.switchFailed', { chain: chainName(req.chainId) }) : errText(e);
  }
  if (S.phase !== 'connecting') return;
  S.phase = 'connected';
  render();
  loadBalances();
}

async function send() {
  if (req.tip && S.tipCheck !== 'ok') return; // never send a tip that was not verified
  if (expired()) {
    S.phase = 'expired';
    render();
    return;
  }
  if (S.relay && !S.relayFailed) return sendGasless();
  const w = S.wallet;
  S.phase = 'sending';
  S.error = '';
  S.walletRpc = '';
  render();
  try {
    await ensureChain(w.provider, req.chainId);
    const hash = await sendTransfer(w.provider, S.account, req.to, req.value);
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash || ''))) throw new Error('No transaction hash returned');
    S.tx = hash;
    await waitAndFinish();
  } catch (e) {
    S.phase = 'connected';
    if (isUserRejection(e)) toast(t('pay.rejected'));
    else if (walletRpcFailed(e)) S.walletRpc = String(e?.data?.message || e?.message || e || '').slice(0, 140); // the wallet's own network connection
    else S.error = errText(e);
    render();
  }
}

// ---------- no-fee payments: the store's own register pays the fee ----------
// The customer signs an EIP-3009 authorization; it goes to the store's register
// over Nostr, and the register submits it from its own gas wallet.
let mods = null;
async function loadMods() {
  if (!mods) {
    const [nostr, relayer, secp] = await Promise.all([import('./nostr.js'), import('./relayer.js'), import('./secp256k1.js')]);
    mods = { nostr, relayer, secp };
  }
  return mods;
}
const callChain = (method, params) => rpc(req.chainId, method, params);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function prepareNoFee() {
  if (!req?.channel) return;
  try {
    const m = await loadMods();
    S.pool = new m.nostr.Pool().connect();
    const domain = await m.relayer.findDomain(callChain, req.chainId);
    if (!domain) return;
    S.relay = { domain };
    if (['ready', 'connected'].includes(S.phase)) render();
  } catch { /* normal payment still works */ }
}

async function chainNow() {
  try {
    const b = await rpc(req.chainId, 'eth_getBlockByNumber', ['latest', false]);
    if (b?.timestamp) return Number(BigInt(b.timestamp));
  } catch { /* fall back to this phone's clock */ }
  return Math.floor(Date.now() / 1000);
}

function awaitReply(eventId, ms) {
  return new Promise((resolve) => {
    let stop = () => {};
    const timer = setTimeout(() => { stop(); resolve(null); }, ms);
    stop = S.pool.subscribe({ kinds: [mods.nostr.KIND.payReply], authors: [req.relayPub], '#t': ['reji-' + req.channel], '#e': [eventId] }, async (ev) => {
      // A relay (or anyone who saw the QR) could send a fake "failed" reply to push a second payment.
      if (ev.pubkey !== req.relayPub || !(await mods.nostr.verifyEvent(ev))) return;
      let body = null;
      try { body = JSON.parse(ev.content); } catch { return; }
      if (!body?.hash && !body?.error) return;
      clearTimeout(timer);
      stop();
      resolve(body);
    });
  });
}

function fallBack() {
  S.phase = 'connected';
  S.relayFailed = true;
  S.error = t('pay.freeFailed');
  render();
}

async function findPaymentTx() {
  try {
    const latest = Number(BigInt(await rpc(req.chainId, 'eth_blockNumber')));
    const found = await scanTransfers(req.chainId, req.to, Math.max(0, latest - 400), latest, { chunk: 500, maxChunks: 4 });
    return found.find((x) => sameAddress(x.from, S.account) && x.value === req.value)?.txHash || '';
  } catch {
    return '';
  }
}

/** No clear answer from the register: wait until the signature has expired on-chain before offering another way. */
async function settle(message) {
  S.phase = 'waitexpire';
  S.waitUntil = Number(message.validBefore);
  render();
  const deadline = Date.now() + 8 * 60_000;
  while (S.phase === 'waitexpire' && Date.now() < deadline) {
    let used = false;
    try { used = await mods.relayer.authorizationUsed(callChain, message.from, message.nonce); } catch { /* keep checking */ }
    if (used) {
      const hash = await findPaymentTx();
      if (hash) {
        S.tx = hash;
        await waitAndFinish(true);
        return;
      }
    } else if ((await chainNow()) > Number(message.validBefore) + 3) {
      fallBack();
      return;
    }
    await sleep(4000);
  }
  if (S.phase === 'waitexpire') {
    S.phase = 'slow';
    render();
  }
}

async function sendGasless() {
  const w = S.wallet;
  const m = await loadMods();
  S.phase = 'signing';
  S.error = '';
  render();
  let message;
  let signature;
  try {
    await ensureChain(w.provider, req.chainId);
    const now = await chainNow();
    message = { from: S.account, to: req.to, value: req.value.toString(), validAfter: '0', validBefore: String(now + 150), nonce: '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('') };
    const typed = {
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
        TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }],
      },
      primaryType: 'TransferWithAuthorization',
      domain: { name: S.relay.domain.name, version: S.relay.domain.version, chainId: req.chainId, verifyingContract: JPYC.address },
      message,
    };
    signature = await w.provider.request({ method: 'eth_signTypedData_v4', params: [S.account, JSON.stringify(typed)] });
    if (!/^0x[0-9a-fA-F]{130}$/.test(String(signature || ''))) throw new Error('Unexpected signature from wallet');
  } catch (e) {
    S.phase = 'connected';
    if (isUserRejection(e)) toast(t('pay.rejected'));
    else {
      S.relayFailed = true;
      S.error = t('pay.freeFailed');
    }
    render();
    return;
  }
  S.phase = 'relaying';
  render();
  try {
    const ev = await m.nostr.makeEvent(m.secp.randomPrivateKey(), m.nostr.KIND.payRequest, [['t', 'reji-' + req.channel]], JSON.stringify({ v: 1, chainId: req.chainId, ...message, signature }));
    const replied = awaitReply(ev.id, 25_000);
    S.pool.publish(ev);
    const reply = await replied;
    if (reply?.hash && /^0x[0-9a-fA-F]{64}$/.test(reply.hash)) {
      S.tx = reply.hash;
      await waitAndFinish(true);
      return;
    }
    if (reply?.error && m.relayer.PRE_BROADCAST.includes(reply.error)) return fallBack();
  } catch { /* fall through to the safe check */ }
  await settle(message);
}

const paysStore = (rc) => transfersInReceipt(rc, req.to).some((x) => sameAddress(x.from, S.account) && x.value === req.value);

async function waitAndFinish(verify = false) {
  S.phase = 'confirming';
  render();
  const t0 = Date.now();
  while (Date.now() - t0 < 5 * 60_000) {
    let rc = null;
    try { rc = await txReceipt(req.chainId, S.tx); } catch { /* public node busy */ }
    if (!rc && S.wallet) {
      try { rc = await S.wallet.provider.request({ method: 'eth_getTransactionReceipt', params: [S.tx] }); } catch { /* ignore */ }
    }
    if (rc?.blockNumber) {
      if (rc.status === '0x1' && (!verify || paysStore(rc))) await finish();
      else {
        S.phase = 'failed';
        S.error = t('pay.reverted');
        render();
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  S.phase = 'slow';
  render();
}

async function finish() {
  S.paidAt = Date.now();
  if (req.tip) { // no 領収書 for a gift: keep a small record on this phone instead
    const list = store.get(TKEY, []);
    const prev = Array.isArray(list) ? list.filter((x) => x && x.tx !== S.tx) : [];
    store.set(TKEY, [{ tx: S.tx, t: S.paidAt, b: req.brandPub, s: req.store, a: req.amountYen, c: req.chainId }, ...prev].slice(0, 200));
    S.phase = 'done';
    S.pool?.close();
    render();
    try { navigator.vibrate?.(60); } catch { /* ignore */ }
    return;
  }
  const r = sanitizeReceipt({ v: 1, s: req.store, ft: S.brand?.msg || '', b: req.brandPub, bc: req.brandColor || S.brand?.color || '', ln: S.brand?.link || '', ev: eventLine(S.brand?.event), n: req.no, t: Math.floor(S.paidAt / 1000), c: req.chainId, tx: S.tx, fr: S.account, to: req.to, m: 'i', it: [], a: req.amountYen, d: req.desc });
  const id = S.tx.toLowerCase();
  const list = store.get(RKEY, []);
  const prev = Array.isArray(list) ? list.filter((x) => x && x.id !== id) : [];
  store.set(RKEY, [{ id, savedAt: S.paidAt, r }, ...prev].slice(0, 300));
  try { S.receiptLink = await receiptUrl(r); } catch { S.receiptLink = 'receipt.html'; }
  S.phase = 'done';
  S.pool?.close();
  render();
  try { navigator.vibrate?.(60); } catch { /* ignore */ }
}

app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  switch (b.dataset.act) {
    case 'lang':
      setLang(getLang() === 'ja' ? 'en' : 'ja');
      render();
      break;
    case 'pick':
      pick(S.wallets[Number(b.dataset.i)]);
      break;
    case 'send':
      send();
      break;
    case 'back':
      S.phase = expired() ? 'expired' : 'ready';
      S.error = '';
      render();
      break;
    case 'retry':
      S.phase = S.account ? 'connected' : 'ready';
      S.error = '';
      render();
      break;
    case 'recheck':
      waitAndFinish();
      break;
    case 'fix-rpc':
      try {
        await repairChain(S.wallet.provider, req.chainId);
        S.walletRpc = '';
        toast(t('pay.walletRpcFixed'));
        render();
      } catch (e) {
        if (!isUserRejection(e)) toast(t('pay.walletRpcFixFailed'), 'warn');
      }
      break;
    case 'copy-rpc': {
      const ok = await copyText(CHAINS[req.chainId].rpc[0]);
      toast(ok ? t('common.copied') : t('common.copyFailed'), ok ? 'info' : 'error');
      break;
    }
    case 'hp-addr':
    case 'hp-amt': {
      const amt = b.dataset.act === 'hp-amt';
      const ok = await copyText(amt ? String(req.amountYen) : req.to);
      toast(ok ? t(amt ? 'pay.hpAmtCopied' : 'pay.hpCopied', { yen: String(req.amountYen) }) : t('common.copyFailed'), ok ? 'info' : 'error');
      break;
    }
    case 'copy-page': {
      const ok = await copyText(pageLinkForWallet());
      toast(ok ? t('pay.pageCopied') : t('common.copyFailed'), ok ? 'info' : 'error');
      break;
    }
    case 'tip-recheck':
      S.tipCheck = 'checking';
      render();
      loadBrand();
      break;
    case 'pay-with-fee':
      S.relayFailed = true;
      S.phase = 'connected';
      render();
      break;
    case 'copy': {
      const ok = await copyText(b.dataset.v);
      toast(ok ? t('common.copied') : t('common.copyFailed'), ok ? 'info' : 'error');
      break;
    }
    case 'watch':
      try { await watchAsset(S.wallet.provider); } catch { /* dismissed */ }
      break;
    default:
  }
});

setInterval(() => {
  const wl = $('#wait-left');
  if (wl) wl.textContent = mmss(Math.max(0, S.waitUntil * 1000 - Date.now()));
  if (!req?.exp) return;
  const el = $('#valid');
  if (el) el.textContent = validText();
  if (expired() && ['ready', 'connected', 'connecting', 'loading'].includes(S.phase)) {
    S.phase = 'expired';
    render();
  }
}, 1000);

// ---- boot ----
watchDeepLinks(app, (id) => { S.openFailed = id; render(); });
if (!req) render();
else if (expired()) {
  S.phase = 'expired';
  render();
} else {
  render();
  prepareNoFee();
  discoverWallets().then((ws) => {
    S.wallets = ws;
    if (S.phase === 'loading') S.phase = 'ready';
    render();
  });
}
