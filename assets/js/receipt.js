// Receipts: one compact model used for the register's printout, the customer's
// saved copy, and the receipt link/QR (data lives in the URL #fragment, so it
// never reaches any server).
import { html, yen, shortAddr, shortHash, packJson, unpackJson } from './util.js';
import { t, fmtDateTime } from './i18n.js';
import { computeTotals } from './tax.js';
import { CHAINS, chainName, explorerTx } from './config.js';
import { isAddress } from './evm.js';
import { safeColor, validLink, validLogo, linkLabel, brandPub, hasBrand } from './brand.js';

const line = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n) : '');

export function receiptFromSale(sale, st) {
  return {
    v: 1,
    s: st.storeName || '',
    ad: st.storeAddr || '',
    tel: st.storeTel || '',
    reg: st.regNo || '',
    ft: st.footer || '',
    n: sale.no,
    t: Math.floor((sale.paidAt || sale.createdAt) / 1000),
    c: sale.chainId,
    tx: sale.txHash || '',
    fr: sale.from || '',
    to: sale.to || '',
    m: sale.taxMode === 'excl' ? 'e' : 'i',
    it: (sale.items || []).map((i) => [i.name, i.qty, i.price, i.tax]),
    a: sale.amountYen,
    b: hasBrand(st) ? brandPub() : '', // where customers' phones find the store's logo
    bc: safeColor(st.brandColor),
    ln: validLink(st.storeLink),
    ev: line(sale.ev, 64), // the event the sale happened at
  };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.trunc(Number(v)))) : lo);

/** Treat every receipt from a URL or storage as untrusted input. */
export function sanitizeReceipt(r) {
  if (!r || typeof r !== 'object') throw new Error('bad receipt');
  const items = Array.isArray(r.it)
    ? r.it
      .slice(0, 200)
      .filter(Array.isArray)
      .map((x) => [str(x[0], 60) || '-', int(x[1], 0, 9999), int(x[2], 0, 10_000_000), [10, 8, 0].includes(x[3]) ? x[3] : null])
    : [];
  return {
    v: 1,
    s: str(r.s, 60),
    ad: str(r.ad, 100),
    tel: str(r.tel, 30),
    reg: /^T\d{13}$/.test(r.reg || '') ? r.reg : '',
    ft: str(r.ft, 120),
    n: str(r.n, 40),
    t: int(r.t, 0, 4102444800),
    c: CHAINS[r.c] ? Number(r.c) : 0,
    tx: /^0x[0-9a-fA-F]{64}$/.test(r.tx || '') ? r.tx : '',
    fr: isAddress(r.fr) ? r.fr : '',
    to: isAddress(r.to) ? r.to : '',
    m: r.m === 'e' ? 'e' : 'i',
    it: items,
    a: int(r.a, 0, 10_000_000),
    d: str(r.d, 120),
    b: /^[0-9a-f]{64}$/.test(r.b || '') ? r.b : '',
    bc: safeColor(r.bc),
    ln: validLink(r.ln),
    ev: line(r.ev, 64),
    an: line(r.an, 30), // 宛名 (addressee), added by the customer on their own phone
    tg: line(r.tg, 30), // 但し書き (what it was for)
  };
}

export async function receiptUrl(r, base = location.href) {
  const u = new URL('receipt.html', base);
  u.search = '';
  u.hash = 'r=' + (await packJson(r));
  return u.toString();
}

export async function receiptFromHash(hash) {
  const m = /(?:^#|&)r=([^&]+)/.exec(hash || '');
  if (!m) return null;
  return sanitizeReceipt(await unpackJson(m[1]));
}

/** opts.logo: the store's logo (data URL), kept out of the receipt itself. */
export function renderReceipt(r, { logo = '' } = {}) {
  const lg = validLogo(logo);
  const mode = r.m === 'e' ? 'excl' : 'incl';
  const items = r.it.map(([name, qty, price, tax]) => ({ name, qty, price, tax }));
  const tot = computeTotals(items, mode);
  const total = items.length ? tot.total : r.a;
  const hasReduced = items.some((i) => i.tax === 8);
  const rated = tot.byRate.filter((g) => g.rate != null);
  const chain = r.c ? chainName(r.c) : '';
  const ext = (href, label) => html`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  return html`<article class="receipt" data-brand="${r.bc ? 1 : 0}" style="${r.bc ? `--rc-brand:${r.bc}` : ''}">
    <header class="rc-head">
      ${lg ? html`<img class="rc-logo" src="${lg}" alt="">` : ''}
      <h3 class="rc-store">${r.s || '—'}</h3>
      ${r.ad ? html`<p>${r.ad}</p>` : ''}
      ${r.tel ? html`<p>TEL ${r.tel}</p>` : ''}
      ${r.reg ? html`<p>${t('rc.regNo')} ${r.reg}</p>` : ''}
      ${r.ev ? html`<p class="rc-event">${r.ev}</p>` : ''}
    </header>
    <p class="rc-title">${t('rc.title')}</p>
    ${r.an ? html`<p class="rc-addressee">${t('rc.addressee', { name: r.an })}</p>` : ''}
    <div class="rc-meta"><span>${r.t ? fmtDateTime(r.t * 1000) : ''}</span><span>${r.n ? `${t('rc.no')} ${r.n}` : ''}</span></div>
    ${items.length
      ? html`<ol class="rc-items">${items.map((i) => html`<li>
          <span class="rc-name">${i.name}${i.tax === 8 ? ' ※' : ''}</span>
          <span class="rc-amt">${yen(i.price * i.qty)}</span>
          ${i.qty !== 1 ? html`<span class="rc-qty">${yen(i.price)} × ${i.qty}</span>` : ''}
        </li>`)}</ol>`
      : r.d ? html`<p class="rc-desc">${r.d}</p>` : ''}
    <dl class="rc-totals">
      ${mode === 'excl' && rated.length
        ? html`<div><dt>${t('rc.subtotalExcl')}</dt><dd>${yen(tot.subtotal)}</dd></div>
          ${rated.filter((g) => g.rate).map((g) => html`<div><dt>${t('rc.tax')} ${g.rate}%</dt><dd>${yen(g.tax)}</dd></div>`)}`
        : ''}
      <div class="rc-total"><dt>${t('rc.total')}</dt><dd>${yen(total)}</dd></div>
      ${rated.map((g) => html`<div class="rc-rate">
        <dt>${g.rate ? t('rc.target', { rate: g.rate }) : t('rc.taxFree')}</dt>
        <dd>${yen(mode === 'excl' ? g.net : g.gross)}${g.rate ? html` <small>(${mode === 'excl' ? t('rc.tax') : t('rc.inclTax')} ${yen(g.tax)})</small>` : ''}</dd>
      </div>`)}
    </dl>
    ${r.an ? html`<p class="rc-proviso">${t('rc.proviso', { what: r.tg || t('rc.provisoDefault') })}</p><p class="rc-received">${t('rc.received')}</p>` : ''}
    <dl class="rc-pay">
      <div><dt>${t('rc.payment')}</dt><dd>JPYC${chain ? ` (${chain})` : ''}</dd></div>
      ${r.tx ? html`<div><dt>${t('rc.tx')}</dt><dd>${ext(explorerTx(r.c, r.tx), shortHash(r.tx))}</dd></div>` : ''}
      ${r.fr ? html`<div><dt>${t('rc.from')}</dt><dd>${shortAddr(r.fr)}</dd></div>` : ''}
      ${r.to ? html`<div><dt>${t('rc.to')}</dt><dd>${shortAddr(r.to)}</dd></div>` : ''}
    </dl>
    ${hasReduced ? html`<p class="rc-note">${t('rc.reducedNote')}</p>` : ''}
    ${r.ft ? html`<p class="rc-foot">${r.ft}</p>` : ''}
    ${r.ln ? html`<p class="rc-link"><a href="${r.ln}" target="_blank" rel="noopener noreferrer">${t('pay.storeLink', { label: linkLabel(r.ln) })}</a><span class="rc-link-url">${r.ln}</span></p>` : ''}
  </article>`;
}
