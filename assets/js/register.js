// The register: tap products (or key in an amount), review the receipt tape, charge.
import { html, raw, $, $$, yen, attr, uid, toast, fmtInt } from './util.js';
import { t } from './i18n.js';
import { LIMITS } from './config.js';
import { computeTotals } from './tax.js';
import { state, saveCart, saveSettings, saveProducts, sampleProducts, on } from './state.js';
import { icon, confirmDialog } from './ui.js';
import { startCharge } from './charge.js';
import { publishBrand } from './brand.js';
import { getLang } from './i18n.js';

let cat = '';
let kp = '';
let root = null;
let sheetOpen = false;

const mode = () => state.settings.regMode;

export function renderRegister(main) {
  root = main;
  main.innerHTML = String(html`<div class="register" data-mode="${mode()}" data-sheet="${sheetOpen ? 'open' : 'closed'}">
    <section class="pick" aria-label="${t('reg.pickLabel')}">
      <div class="pick-bar">
        <div class="seg" role="tablist" aria-label="${t('reg.modeLabel')}">
          <button type="button" role="tab" aria-selected="${String(mode() === 'menu')}" data-act="mode" data-v="menu">${t('reg.menu')}</button>
          <button type="button" role="tab" aria-selected="${String(mode() === 'keypad')}" data-act="mode" data-v="keypad">${t('reg.keypad')}</button>
        </div>
        <div class="cats" id="cats"></div>
      </div>
      <div class="pick-body" id="pick-body"></div>
    </section>
    <div class="sheet-scrim" data-act="sheet-close"></div>
    <aside class="tape-col" id="tape-col" aria-label="${t('tape.title')}"></aside>
    <div class="tape-bar" id="tape-bar"></div>
  </div>`);
  const reg = main.querySelector('.register');
  reg.addEventListener('click', onClick);
  reg.addEventListener('input', onInput);
  renderPick();
  renderTape();
}

function renderPick() {
  if (!root) return;
  const body = $('#pick-body', root);
  const cats = $('#cats', root);
  if (!body) return;
  if (mode() === 'keypad') {
    cats.innerHTML = '';
    body.innerHTML = String(keypadHtml());
    return;
  }
  const names = [...new Set(state.products.map((p) => p.cat).filter(Boolean))];
  if (cat && !names.includes(cat)) cat = '';
  cats.innerHTML = names.length > 1 || (names.length === 1 && state.products.some((p) => !p.cat))
    ? String(html`<div class="chips" role="tablist" aria-label="${t('reg.catLabel')}">
        <button type="button" class="chip" role="tab" aria-selected="${String(!cat)}" data-act="cat" data-v="">${t('reg.all')}</button>
        ${names.map((n) => html`<button type="button" class="chip" role="tab" aria-selected="${String(cat === n)}" data-act="cat" data-v="${n}">${n}</button>`)}
      </div>`)
    : '';
  body.innerHTML = String(state.products.length ? tilesHtml() : emptyMenuHtml());
  updateBadges();
}

function tilesHtml() {
  const list = state.products.filter((p) => !cat || p.cat === cat);
  return html`<div class="tiles">${list.map((p) => html`<button type="button" class="tile" data-act="add" data-id="${p.id}">
      <span class="tile-name">${p.name}</span>
      <span class="tile-foot"><span class="tile-price">${yen(p.price)}</span>${p.tax !== 10 ? html`<span class="tile-tax">${p.tax}%</span>` : ''}</span>
      <span class="tile-qty" data-qty="${p.id}" hidden></span>
    </button>`)}</div>`;
}

function emptyMenuHtml() {
  return html`<div class="empty">
    <p class="empty-title">${t('reg.emptyTitle')}</p>
    <p class="empty-text">${t('reg.emptyText')}</p>
    <div class="empty-actions">
      <button type="button" class="btn primary" data-act="sample">${t('reg.loadSample')}</button>
      <a class="btn ghost" href="#/settings?s=menu">${t('reg.editMenu')}</a>
      <button type="button" class="btn ghost" data-act="mode" data-v="keypad">${t('reg.useKeypad')}</button>
    </div>
  </div>`;
}

function keypadHtml() {
  const v = Number(kp || 0);
  const rate = state.settings.keypadTax;
  return html`<div class="kp">
    <div class="kp-screen">
      <output class="kp-amount" id="kp-amount" aria-live="polite">${yen(v)}</output>
      <input class="kp-label" id="kp-label" type="text" maxlength="40" autocomplete="off" placeholder="${t('kp.labelPh')}" aria-label="${t('kp.label')}">
    </div>
    <div class="seg kp-rate" role="radiogroup" aria-label="${t('kp.rate')}">
      ${[10, 8, 0].map((r) => html`<button type="button" role="radio" aria-checked="${String(r === rate)}" data-act="kp-rate" data-v="${r}">${t('tax.r' + r)}</button>`)}
    </div>
    <div class="kp-keys">
      ${['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0'].map((k) => html`<button type="button" class="key" data-act="kp" data-v="${k}">${k}</button>`)}
      <button type="button" class="key key-bs" data-act="kp-bs" aria-label="${t('kp.backspace')}">${icon('backspace')}</button>
    </div>
    <button type="button" class="btn primary big kp-add" id="kp-add" data-act="kp-add"${attr('disabled', !v)}>${t('kp.add')}</button>
  </div>`;
}

function lineHtml(l) {
  return html`<li class="line">
    <span class="line-name">${l.name}${l.tax === 8 ? html`<span class="rm" title="${t('tax.reducedMark')}"> ※</span>` : ''}</span>
    <span class="line-amt">${yen(l.price * l.qty)}</span>
    <span class="line-unit">${yen(l.price)}${l.tax === 0 ? html` <span class="line-tag">${t('tax.r0')}</span>` : ''}</span>
    <span class="stepper">
      <button type="button" class="step" data-act="dec" data-key="${l.key}" aria-label="${t('tape.less', { name: l.name })}">${icon('minus')}</button>
      <output class="qty" aria-label="${t('tape.qty')}">${l.qty}</output>
      <button type="button" class="step" data-act="inc" data-key="${l.key}" aria-label="${t('tape.more', { name: l.name })}">${icon('plus')}</button>
    </span>
  </li>`;
}

export function renderTape() {
  if (!root) return;
  const col = $('#tape-col', root);
  const bar = $('#tape-bar', root);
  if (!col) return;
  const s = state.settings;
  const lines = state.cart;
  const tot = computeTotals(lines, s.taxMode);
  const rated = tot.byRate.filter((g) => g.rate);
  col.innerHTML = String(html`<div class="sheet-handle" data-act="sheet-close"><span></span></div>
    <div class="tape">
      <div class="tape-top">
        <span class="tape-store">${s.storeName || 'Reji'}</span>
        <span class="tape-count">${t('tape.items', { n: tot.count })}</span>
      </div>
      ${lines.length
        ? html`<ol class="tape-lines">${lines.map(lineHtml)}</ol>`
        : html`<p class="tape-empty">${t(mode() === 'keypad' ? 'tape.emptyKeypad' : 'tape.emptyMenu')}</p>`}
      <div class="tape-sum">
        ${s.taxMode === 'excl' && lines.length
          ? html`<div class="sum-row"><span>${t('rc.subtotalExcl')}</span><span>${yen(tot.subtotal)}</span></div>
            ${rated.map((g) => html`<div class="sum-row"><span>${t('rc.tax')} ${g.rate}%</span><span>${yen(g.tax)}</span></div>`)}`
          : ''}
        <div class="sum-total"><span>${t('rc.total')}</span><span class="amt">${yen(tot.total)}</span></div>
        ${s.taxMode === 'incl' && tot.taxTotal ? html`<p class="sum-note">${t('tape.inclTax', { tax: yen(tot.taxTotal) })}</p>` : ''}
        ${lines.some((l) => l.tax === 8) ? html`<p class="sum-note">${t('rc.reducedNote')}</p>` : ''}
      </div>
    </div>
    <div class="tape-actions">
      <button type="button" class="btn ghost" data-act="clear"${attr('disabled', !lines.length)}>${t('tape.clear')}</button>
      <button type="button" class="btn primary charge-btn" data-act="charge"${attr('disabled', !tot.total)}>${t('tape.charge', { amount: yen(tot.total) })}</button>
    </div>`);
  bar.innerHTML = String(html`<button type="button" class="bar-sum" data-act="sheet-open"${attr('disabled', !lines.length)}>
      <span class="bar-count">${t('tape.items', { n: tot.count })}</span>
      <span class="bar-amt">${yen(tot.total)}</span>
      ${icon('up')}
    </button>
    <button type="button" class="btn primary charge-btn" data-act="charge"${attr('disabled', !tot.total)}>${t('tape.chargeShort')}</button>`);
  if (!lines.length && sheetOpen) setSheet(false);
  updateBadges();
}

function updateBadges() {
  if (!root) return;
  const q = new Map();
  for (const l of state.cart) if (l.pid) q.set(l.pid, (q.get(l.pid) || 0) + l.qty);
  for (const b of $$('[data-qty]', root)) {
    const n = q.get(b.dataset.qty) || 0;
    b.hidden = !n;
    b.textContent = n ? fmtInt(n) : '';
    b.closest('.tile')?.classList.toggle('in-cart', !!n);
  }
}

function setSheet(open) {
  sheetOpen = open;
  const reg = root?.querySelector('.register');
  if (reg) reg.dataset.sheet = open ? 'open' : 'closed';
}

function addProduct(id, el) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  const line = state.cart.find((l) => l.pid === p.id && l.price === p.price && l.tax === p.tax && l.name === p.name);
  if (line) line.qty = Math.min(999, line.qty + 1);
  else {
    if (state.cart.length >= LIMITS.maxItems) return toast(t('err.tooManyLines'), 'error');
    state.cart.push({ key: p.id + uid(4), pid: p.id, name: p.name, price: p.price, tax: p.tax, qty: 1 });
  }
  saveCart();
  renderTape();
  if (el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
}

function kpSet(next) {
  const digits = next.replace(/^0+/, '').slice(0, 8);
  if (Number(digits || 0) > LIMITS.maxYen) return;
  kp = digits;
  const amt = $('#kp-amount', root);
  if (amt) amt.textContent = yen(Number(kp || 0));
  const add = $('#kp-add', root);
  if (add) add.disabled = !Number(kp || 0);
}

function kpAdd() {
  const v = Number(kp || 0);
  if (!v) return;
  if (state.cart.length >= LIMITS.maxItems) return toast(t('err.tooManyLines'), 'error');
  const label = ($('#kp-label', root)?.value || '').trim().slice(0, 40);
  state.cart.push({ key: 'k' + uid(8), pid: '', name: label || t('kp.item'), price: v, tax: state.settings.keypadTax, qty: 1 });
  saveCart();
  kpSet('');
  const lab = $('#kp-label', root);
  if (lab) lab.value = '';
  renderTape();
}

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  switch (act) {
    case 'mode':
      saveSettings({ ...state.settings, regMode: b.dataset.v });
      root.querySelector('.register').dataset.mode = mode();
      $$('.pick-bar [data-act="mode"]', root).forEach((x) => x.setAttribute('aria-selected', String(x.dataset.v === mode())));
      renderPick();
      renderTape();
      break;
    case 'cat':
      cat = b.dataset.v;
      renderPick();
      break;
    case 'add':
      addProduct(b.dataset.id, b);
      break;
    case 'inc':
    case 'dec': {
      const l = state.cart.find((x) => x.key === b.dataset.key);
      if (!l) return;
      l.qty += act === 'inc' ? 1 : -1;
      if (l.qty > 999) l.qty = 999;
      if (l.qty <= 0) state.cart = state.cart.filter((x) => x !== l);
      saveCart();
      renderTape();
      break;
    }
    case 'clear':
      if (await confirmDialog({ title: t('tape.clearTitle'), ok: t('tape.clear'), danger: true })) {
        state.cart = [];
        saveCart();
        renderTape();
      }
      break;
    case 'charge':
      setSheet(false);
      startCharge();
      break;
    case 'sheet-open':
      setSheet(true);
      break;
    case 'sheet-close':
      setSheet(false);
      break;
    case 'kp':
      kpSet(kp + b.dataset.v);
      break;
    case 'kp-bs':
      kpSet(kp.slice(0, -1));
      break;
    case 'kp-rate':
      saveSettings({ ...state.settings, keypadTax: Number(b.dataset.v) });
      $$('[data-act="kp-rate"]', root).forEach((x) => x.setAttribute('aria-checked', String(Number(x.dataset.v) === state.settings.keypadTax)));
      break;
    case 'kp-add':
      kpAdd();
      break;
    case 'sample':
      state.products = sampleProducts(getLang());
      saveProducts();
      publishBrand(state.settings).catch(() => {}); // the store page's menu (a no-op without a profile)
      renderPick();
      toast(t('reg.sampleLoaded'));
      break;
    default:
  }
}

function onInput() { /* label field: nothing to sync until Add */ }

/** Physical keyboard / USB keypad support while the keypad is showing. */
export function registerKey(e) {
  if (!root || mode() !== 'keypad' || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (e.key === 'Enter' && document.activeElement?.id === 'kp-label') { e.preventDefault(); kpAdd(); }
    return;
  }
  if (/^[0-9]$/.test(e.key)) { kpSet(kp + e.key); e.preventDefault(); }
  else if (e.key === 'Backspace') { kpSet(kp.slice(0, -1)); e.preventDefault(); }
  else if (e.key === 'Escape') kpSet('');
  else if (e.key === 'Enter') { e.preventDefault(); kpAdd(); }
}

on('cart', () => renderTape());
