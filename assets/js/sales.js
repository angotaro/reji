// Sales ledger: daily summary (a Z report), receipts, CSV export, unpaid charges.
import { html, raw, $, $$, yen, fmtInt, shortAddr, csv, download, toast, copyText, attr, ymd, pad2 } from './util.js';
import { t, fmtDateTime, fmtDay, fmtTime } from './i18n.js';
import { chainName, explorerTx } from './config.js';
import { computeTotals } from './tax.js';
import { receiptFromSale, receiptUrl, renderReceipt } from './receipt.js';
import { qrSvg } from './qr.js';
import { exactUnits, formatUnits } from './evm.js';
import { state, saveSales, saveUnpaid, isTestnet, on } from './state.js';
import { icon, modal, confirmDialog, requirePin, printHtml, chainBadge } from './ui.js';
import { recheckUnpaid, bookUnpaid, trackConfirmations, printSale, confText } from './charge.js';

const RANGES = ['today', 'yesterday', '7d', 'month', 'all'];
let range = 'today';
let query = '';
let root = null;

const when = (s) => s.paidAt || s.createdAt;
const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const dstr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const tstr = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

function bounds(r) {
  const now = new Date();
  if (r === 'today') return [sod(now), Infinity];
  if (r === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return [sod(y), sod(now)];
  }
  if (r === '7d') {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return [sod(d), Infinity];
  }
  if (r === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), Infinity];
  return [0, Infinity];
}

function rangeText() {
  if (range === 'all') return t('sales.range.all');
  const [a, b] = bounds(range);
  if (range === 'today' || range === 'yesterday') return fmtDay(a);
  return t('sales.rangeSpan', { from: fmtDay(a), to: fmtDay(b === Infinity ? Date.now() : b - 1) });
}

function filtered() {
  const [a, b] = bounds(range);
  const test = isTestnet();
  const q = query.trim().toLowerCase();
  return state.sales
    .filter((s) => !!s.testnet === test && when(s) >= a && when(s) < b)
    .filter((s) => !q || [s.no, s.txHash, s.from, s.desc, ...(s.items || []).map((i) => i.name)].some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((x, y) => when(y) - when(x));
}

export function summarize(list) {
  const rates = new Map();
  const chains = new Map();
  const items = new Map();
  let total = 0;
  for (const s of list) {
    total += s.amountYen;
    for (const g of computeTotals(s.items || [], s.taxMode).byRate) {
      const k = g.rate == null ? 'na' : g.rate;
      const r = rates.get(k) || { rate: g.rate, gross: 0, tax: 0 };
      r.gross += g.gross;
      r.tax += g.tax;
      rates.set(k, r);
    }
    const c = chains.get(s.chainId) || { id: s.chainId, n: 0, sum: 0 };
    c.n++;
    c.sum += s.amountYen;
    chains.set(s.chainId, c);
    for (const i of s.items || []) {
      const k = `${i.name}\u0000${i.price}`;
      const it = items.get(k) || { name: i.name, price: i.price, qty: 0, sum: 0 };
      it.qty += i.qty;
      it.sum += i.price * i.qty;
      items.set(k, it);
    }
  }
  return {
    count: list.length,
    total,
    avg: list.length ? Math.round(total / list.length) : 0,
    rates: [...rates.values()].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1)),
    chains: [...chains.values()].sort((a, b) => b.sum - a.sum),
    items: [...items.values()].sort((a, b) => b.sum - a.sum),
  };
}

export function renderSales(main) {
  root = main;
  main.innerHTML = String(html`<div class="sales">
    <div class="sales-bar">
      <div class="seg" role="tablist" aria-label="${t('sales.rangeLabel')}">
        ${RANGES.map((r) => html`<button type="button" role="tab" aria-selected="${String(r === range)}" data-act="range" data-v="${r}">${t('sales.range.' + r)}</button>`)}
      </div>
      <label class="search">${icon('search')}<input type="search" id="sales-q" value="${query}" placeholder="${t('sales.searchPh')}" aria-label="${t('sales.searchLabel')}"></label>
    </div>
    <div class="sales-grid">
      <section class="summary" id="sales-summary" aria-label="${t('sales.summary')}"></section>
      <section class="ledger" id="sales-ledger" aria-label="${t('sales.ledger')}"></section>
    </div>
  </div>`);
  main.querySelector('.sales').addEventListener('click', onClick);
  $('#sales-q', main).addEventListener('input', (e) => {
    query = e.target.value;
    renderBody();
  });
  renderBody();
}

function renderBody() {
  if (!root || !$('#sales-ledger', root)) return;
  const keepOpen = $('.z-items', root)?.open;
  const list = filtered();
  $('#sales-summary', root).innerHTML = String(summaryHtml(list, summarize(list)));
  $('#sales-ledger', root).innerHTML = String(html`${unpaidHtml()}${ledgerHtml(list)}`);
  if (keepOpen) $('.z-items', root).open = true;
}

function summaryHtml(list, sum) {
  const test = isTestnet();
  const hidden = state.sales.filter((s) => !!s.testnet !== test).length;
  const unconfirmed = list.filter((s) => !s.confirmed).length;
  return html`<div class="z">
    <p class="z-range">${rangeText()}</p>
    <p class="z-total">${yen(sum.total)}</p>
    <p class="z-count">${t('sales.countAvg', { n: sum.count, avg: yen(sum.avg) })}</p>
    ${sum.rates.length ? html`<dl class="z-rows">${sum.rates.map((r) => html`<div>
        <dt>${r.rate ? t('rc.target', { rate: r.rate }) : t('rc.taxFree')}</dt>
        <dd>${yen(r.gross)}${r.rate ? html` <small>${t('sales.taxOf', { tax: yen(r.tax) })}</small>` : ''}</dd>
      </div>`)}</dl>` : ''}
    ${sum.chains.length ? html`<dl class="z-rows">${sum.chains.map((c) => html`<div>
        <dt>${chainName(c.id)}</dt><dd>${yen(c.sum)} <small>${t('sales.nSales', { n: c.n })}</small></dd>
      </div>`)}</dl>` : ''}
    ${sum.items.length ? html`<details class="z-items"><summary>${t('sales.byItem')}</summary><ol>
      ${sum.items.slice(0, 60).map((i) => html`<li><span>${i.name}</span><span>×${fmtInt(i.qty)}</span><span>${yen(i.sum)}</span></li>`)}
    </ol></details>` : ''}
    ${unconfirmed ? html`<p class="z-note">${t('sales.unconfirmed', { n: unconfirmed })}</p>` : ''}
    ${hidden ? html`<p class="z-note">${t(test ? 'sales.hiddenLive' : 'sales.hiddenTest', { n: hidden })}</p>` : ''}
    <div class="z-actions">
      <button type="button" class="btn ghost" data-act="print-z"${attr('disabled', !list.length)}>${icon('print')}<span>${t('sales.printZ')}</span></button>
      <button type="button" class="btn ghost" data-act="csv-sales"${attr('disabled', !list.length)}>${icon('download')}<span>${t('sales.csvSales')}</span></button>
      <button type="button" class="btn ghost" data-act="csv-items"${attr('disabled', !list.length)}>${icon('download')}<span>${t('sales.csvItems')}</span></button>
    </div>
  </div>`;
}

function ledgerHtml(list) {
  if (!list.length) {
    return html`<div class="empty">
      <p class="empty-title">${query ? t('sales.noMatch') : t('sales.emptyTitle')}</p>
      ${query ? '' : html`<p class="empty-text">${t('sales.emptyText')}</p><a class="btn primary" href="#/">${t('sales.toRegister')}</a>`}
    </div>`;
  }
  const groups = [];
  for (const s of list) {
    const day = sod(new Date(when(s)));
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) groups.push((g = { day, list: [], sum: 0 }));
    g.list.push(s);
    g.sum += s.amountYen;
  }
  return html`${groups.map((g) => html`<div class="day">
    <h3 class="day-head"><span>${fmtDay(g.day)}</span><span>${yen(g.sum)}</span></h3>
    <ul class="rows">${g.list.map(rowHtml)}</ul>
  </div>`)}`;
}

function rowHtml(s) {
  const st = s.flag === 'failed' ? 'bad' : s.confirmed ? 'ok' : 'wait';
  return html`<li><button type="button" class="row" data-act="open" data-id="${s.id}">
    <span class="row-time">${fmtTime(when(s))}</span>
    <span class="row-main"><span class="row-desc">${s.desc || s.no}</span><span class="row-no">${s.no}</span></span>
    <span class="row-chain">${chainBadge(chainName(s.chainId), s.testnet)}</span>
    <span class="row-amt">${yen(s.amountYen)}</span>
    <span class="row-state" data-state="${st}" title="${confText(s)}">${st === 'ok' ? icon('check') : raw('<span class="mini-dot"></span>')}<span class="sr-only">${confText(s)}</span></span>
  </button></li>`;
}

function unpaidHtml() {
  const test = isTestnet();
  const list = state.unpaid.filter((u) => (u.network === 'testnet') === test);
  if (!list.length) return '';
  return html`<div class="unpaid">
    <h3 class="unpaid-head">${t('sales.unpaidTitle', { n: list.length })}</h3>
    <p class="unpaid-text">${t('sales.unpaidText')}</p>
    <ul class="unpaid-list">${list.map((u) => html`<li>
      <span class="row-main"><span class="row-desc">${u.desc || u.no}</span><span class="row-no">${fmtDateTime(u.createdAt)} ${t('sales.status.' + (u.status === 'cancelled' ? 'cancelled' : 'expired'))}</span></span>
      <span class="row-amt">${yen(u.amountYen)}</span>
      <span class="unpaid-actions">
        <button type="button" class="btn small" data-act="recheck" data-id="${u.id}">${icon('refresh')}<span>${t('sales.recheck')}</span></button>
        <button type="button" class="icon-btn" data-act="dismiss" data-id="${u.id}" aria-label="${t('sales.dismiss')}" title="${t('sales.dismiss')}">${icon('close')}</button>
      </span>
    </li>`)}</ul>
  </div>`;
}

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  if (act === 'range') {
    range = b.dataset.v;
    $$('[data-act="range"]', root).forEach((x) => x.setAttribute('aria-selected', String(x.dataset.v === range)));
    renderBody();
  } else if (act === 'open') openSale(b.dataset.id);
  else if (act === 'print-z') printZ();
  else if (act === 'csv-sales') exportSales();
  else if (act === 'csv-items') exportItems();
  else if (act === 'recheck') recheck(b.dataset.id, b);
  else if (act === 'dismiss') dismiss(b.dataset.id);
}

async function recheck(id, btn) {
  const u = state.unpaid.find((x) => x.id === id);
  if (!u) return;
  const label = btn.querySelector('span');
  const orig = label.textContent;
  btn.disabled = true;
  try {
    const res = await recheckUnpaid(u, (chainId, pct) => { label.textContent = t('sales.checking', { pct }); });
    if (res.hit) {
      const sale = await bookUnpaid(u, res.hit, res.chainId, res.match);
      toast(t('sales.foundPaid', { no: sale.no }));
      renderBody();
      return;
    }
    if (res.others.length) pickOther(u, res.others);
    else toast(t('sales.notFound'));
  } catch {
    toast(t('sales.checkFailed'), 'error');
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      label.textContent = orig;
    }
  }
}

function pickOther(u, others) {
  const m = modal(html`<h2 class="modal-title">${t('sales.othersTitle')}</h2>
    <p class="modal-text">${t('sales.othersText', { amount: yen(u.amountYen) })}</p>
    <ul class="others-list">${others.slice(0, 20).map((o, i) => html`<li>
      <span class="o-amt">${formatUnits(o.value, 18, 2)} JPYC</span>
      <span class="o-meta">${chainName(o.chainId)} ${shortAddr(o.from)}</span>
      <button type="button" class="btn small" data-pick="${i}">${t('charge.useThis')}</button>
    </li>`)}</ul>
    <div class="modal-actions"><button type="button" class="btn ghost" data-close>${t('common.close')}</button></div>`, { label: t('sales.othersTitle') });
  m.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const o = others[Number(b.dataset.pick)];
    m.close();
    try {
      const sale = await bookUnpaid(u, o, o.chainId, 'manual');
      toast(t('sales.foundPaid', { no: sale.no }));
    } catch {
      toast(t('charge.txUsed'), 'error');
    }
    renderBody();
  });
}

async function dismiss(id) {
  const ok = await confirmDialog({ title: t('sales.dismissTitle'), body: t('sales.dismissBody'), ok: t('sales.dismiss'), danger: true });
  if (!ok) return;
  state.unpaid = state.unpaid.filter((u) => u.id !== id);
  saveUnpaid();
  renderBody();
}

async function openSale(id) {
  const s = state.sales.find((x) => x.id === id);
  if (!s) return;
  const r = receiptFromSale(s, state.settings);
  const link = await receiptUrl(r);
  const m = modal(html`<div class="sale-view">
    <div class="sale-paper">${renderReceipt(r)}</div>
    <div class="sale-side">
      <p class="sale-status" data-state="${s.flag === 'failed' ? 'bad' : s.confirmed ? 'ok' : 'wait'}">${confText(s)}</p>
      ${s.match && s.match !== 'exact' ? html`<p class="paid-flag">${t('match.' + s.match)}</p>` : ''}
      ${s.late ? html`<p class="hint">${t('sales.lateNote')}</p>` : ''}
      <div class="qr-frame small">${raw(qrSvg(link, { ecl: 'L', title: t('charge.receiptQr') }))}</div>
      <p class="hint">${t('sales.qrHint')}</p>
      <div class="btn-col">
        <button type="button" class="btn ghost" data-a="print">${icon('print')}<span>${t('charge.print')}</span></button>
        <button type="button" class="btn ghost" data-a="copy">${icon('copy')}<span>${t('charge.copyReceipt')}</span></button>
        ${s.txHash ? html`<a class="btn ghost" href="${explorerTx(s.chainId, s.txHash)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${t('sales.explorer')}</span></a>` : ''}
        <button type="button" class="btn danger-ghost" data-a="delete">${icon('trash')}<span>${t('sales.delete')}</span></button>
      </div>
    </div>
    <button type="button" class="icon-btn modal-x" data-close aria-label="${t('common.close')}">${icon('close')}</button>
  </div>`, { label: t('sales.receiptFor', { no: s.no }), size: 'wide' });
  m.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'print') printSale(s);
    else if (b.dataset.a === 'copy') {
      const ok = await copyText(link);
      toast(ok ? t('common.copied') : t('common.copyFailed'), ok ? 'info' : 'error');
    } else if (b.dataset.a === 'delete') {
      m.close();
      if (!(await requirePin(state.settings))) return;
      const ok = await confirmDialog({ title: t('sales.deleteTitle'), body: t('sales.deleteBody'), ok: t('sales.delete'), danger: true });
      if (!ok) return;
      state.sales = state.sales.filter((x) => x.id !== s.id);
      saveSales();
      renderBody();
      toast(t('sales.deleted'));
    }
  });
  if (!s.confirmed) trackConfirmations(s);
}

function printZ() {
  const list = filtered();
  const sum = summarize(list);
  const st = state.settings;
  printHtml(html`<article class="receipt zreport">
    <header class="rc-head"><h3 class="rc-store">${st.storeName || 'Reji'}</h3></header>
    <p class="rc-title">${t('sales.zTitle')}</p>
    <div class="rc-meta"><span>${rangeText()}</span></div>
    <dl class="rc-totals">
      <div class="rc-total"><dt>${t('sales.total')}</dt><dd>${yen(sum.total)}</dd></div>
      <div><dt>${t('sales.count')}</dt><dd>${fmtInt(sum.count)}</dd></div>
      ${sum.rates.map((r) => html`<div class="rc-rate"><dt>${r.rate ? t('rc.target', { rate: r.rate }) : t('rc.taxFree')}</dt><dd>${yen(r.gross)}${r.rate ? html` <small>(${t('rc.tax')} ${yen(r.tax)})</small>` : ''}</dd></div>`)}
      ${sum.chains.map((c) => html`<div class="rc-rate"><dt>${chainName(c.id)}</dt><dd>${yen(c.sum)} <small>(${fmtInt(c.n)})</small></dd></div>`)}
    </dl>
    ${sum.items.length ? html`<ol class="rc-items">${sum.items.map((i) => html`<li><span class="rc-name">${i.name}</span><span class="rc-amt">${yen(i.sum)}</span><span class="rc-qty">${yen(i.price)} × ${i.qty}</span></li>`)}</ol>` : ''}
    <p class="rc-foot">${t('sales.printed', { time: fmtDateTime(Date.now()) })}</p>
  </article>`, { width: st.receiptWidth, kind: 'z' });
}

function exportSales() {
  const list = filtered().slice().reverse();
  const rows = list.map((s) => {
    const d = new Date(when(s));
    const tot = computeTotals(s.items || [], s.taxMode);
    const g = (rate) => tot.byRate.find((x) => x.rate === rate) || { gross: 0, tax: 0 };
    const free = tot.byRate.filter((x) => !x.rate).reduce((a, x) => a + x.gross, 0);
    let received = '';
    try { received = exactUnits(BigInt(s.valueWei || 0)); } catch { /* ignore */ }
    return [
      dstr(d), tstr(d), s.no, s.amountYen, g(10).gross, g(10).tax, g(8).gross, g(8).tax, free,
      s.taxMode === 'excl' ? t('csv.excl') : t('csv.incl'), chainName(s.chainId), s.txHash, s.from, s.to, received,
      t('match.short.' + (s.match || 'exact')), s.confirmed ? 'Y' : 'N', (s.items || []).map((i) => `${i.name}×${i.qty}`).join(' / '),
    ];
  });
  download(`reji-sales-${range}-${ymd()}.csv`, csv([t('csv.salesHead').split('|'), ...rows]), 'text/csv;charset=utf-8');
}

function exportItems() {
  const rows = [];
  for (const s of filtered().slice().reverse()) {
    const d = new Date(when(s));
    for (const i of s.items || []) {
      rows.push([dstr(d), tstr(d), s.no, i.name, i.price, i.qty, i.price * i.qty, i.tax == null ? '' : `${i.tax}%`,
        s.taxMode === 'excl' ? t('csv.excl') : t('csv.incl'), chainName(s.chainId), s.txHash]);
    }
  }
  download(`reji-items-${range}-${ymd()}.csv`, csv([t('csv.itemsHead').split('|'), ...rows]), 'text/csv;charset=utf-8');
}

on('sale', () => renderBody());
on('unpaid', () => renderBody());
