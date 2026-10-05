// Customer receipts. The receipt travels in the URL #fragment (never sent to a
// server); this page checks the payment on-chain and can keep a copy on the device.
import { html, $, store, copyText, toast, csv, download, yen, ymd, pad2, attr } from './util.js';
import { t, getLang, setLang, fmtDateTime } from './i18n.js';
import { receiptFromHash, renderReceipt, sanitizeReceipt, receiptUrl } from './receipt.js';
import { txReceipt, transfersInReceipt } from './rpc.js';
import { UNIT } from './evm.js';
import { chainName } from './config.js';
import { cachedBrand, fetchBrand, storePageUrl } from './brand.js';

const brandOf = (r) => (r?.b ? cachedBrand(r.b) : null);
/** Fills what the receipt itself doesn't carry from the store's profile (never overrides it). */
const withBrand = (r) => {
  const b = brandOf(r);
  return b ? { ...r, ft: r.ft || b.msg, ln: r.ln || b.link, bc: r.bc || b.color } : r;
};
import { icon, stampSvg, printHtml, confirmDialog } from './ui.js';

const KEY = 'reji:receipts:v1';
const app = $('#rcpt');
let current = null;
let verify = 'idle';
let badLink = false;

const idOf = (r) => (r.tx ? r.tx.toLowerCase() : `${r.s}|${r.n}|${r.t}`);
function saved() {
  const list = store.get(KEY, []);
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list) {
    try { if (x && x.r) out.push({ id: String(x.id), savedAt: Number(x.savedAt) || 0, r: sanitizeReceipt(x.r) }); } catch { /* skip */ }
  }
  return out;
}
const isSaved = (r) => saved().some((x) => x.id === idOf(r));

async function load() {
  badLink = false;
  current = null;
  verify = 'idle';
  try {
    current = await receiptFromHash(location.hash);
  } catch {
    badLink = true;
  }
  render();
  if (current) check(current);
  if (current?.b) fetchBrand(current.b).then((b) => { if (b && current) render(); }).catch(() => {});
}

async function check(r) {
  if (!r.tx || !r.c) {
    verify = 'none';
    render();
    return;
  }
  verify = 'checking';
  render();
  let state = 'error';
  try {
    const rc = await txReceipt(r.c, r.tx);
    if (!rc) state = 'pending';
    else if (rc.status !== '0x1') state = 'failed';
    else {
      const trs = transfersInReceipt(rc, r.to || null);
      state = trs.some((x) => x.value / UNIT === BigInt(r.a)) ? 'verified' : 'mismatch';
    }
  } catch { /* stays "error" */ }
  if (current !== r) return;
  verify = state;
  render();
}

function verifyText() {
  const chain = current?.c ? chainName(current.c) : '';
  const map = {
    idle: t('rcp.checking', { chain }),
    checking: t('rcp.checking', { chain }),
    verified: t('rcp.verified', { chain }),
    pending: t('rcp.pending', { chain }),
    failed: t('rcp.failed'),
    mismatch: t('rcp.mismatch'),
    error: t('rcp.error', { chain }),
    none: t('rcp.none'),
  };
  return map[verify] || '';
}

/** Stores this phone has receipts from, newest first (for quick access to their pages). */
function storesOf(list) {
  const seen = new Map();
  for (const x of [...list].sort((a, b) => b.savedAt - a.savedAt)) {
    if (!x.r.b || seen.has(x.r.b)) continue;
    const p = cachedBrand(x.r.b);
    seen.set(x.r.b, { b: x.r.b, name: p?.name || x.r.s || '—', logo: p?.logo || '' });
  }
  return [...seen.values()].slice(0, 12);
}

function render() {
  const list = saved();
  const shops = storesOf(list);
  document.title = t('rcp.title');
  app.innerHTML = String(html`<header class="noren pay-top">
      <span class="brand-name">${t('rcp.title')}</span>
      <button type="button" class="lang-btn" data-act="lang" lang="${getLang() === 'ja' ? 'en' : 'ja'}">${getLang() === 'ja' ? 'EN' : '日本語'}</button>
    </header>
    <main class="pay-main rcpt-main">
      ${badLink ? html`<p class="notice error">${t('rcp.bad')}</p>` : ''}
      ${current ? html`<section class="rcpt-current">
        <div class="paper-wrap">
          ${renderReceipt(withBrand(current), { logo: brandOf(current)?.logo || '' })}
        </div>
        <p class="verify" data-state="${verify}">${verify === 'verified' ? icon('check') : ''}<span>${verifyText()}</span></p>
        <div class="btn-row">
          ${isSaved(current)
            ? html`<span class="saved-tag">${icon('check')}<span>${t('rcp.saved')}</span></span>`
            : html`<button type="button" class="btn primary" data-act="save">${t('rcp.save')}</button>`}
          <button type="button" class="btn ghost" data-act="print">${icon('print')}<span>${t('charge.print')}</span></button>
          <button type="button" class="btn ghost" data-act="copy">${icon('copy')}<span>${t('rcp.copy')}</span></button>
          ${current.b ? html`<a class="btn ghost" href="${storePageUrl(current.b)}">${icon('store')}<span>${t('rcp.storePage')}</span></a>` : ''}
        </div>
        <details class="rc-addr"${attr('open', !!current.an)}>
          <summary>${icon('receipt')}<span>${t('rcp.addr')}</span></summary>
          <div class="rc-addr-body">
            <label class="field"><span class="label">${t('rcp.addrName')}</span><input name="an" maxlength="30" value="${current.an}" placeholder="${t('rcp.addrNamePh')}" autocomplete="organization"></label>
            <label class="field"><span class="label">${t('rcp.addrFor')}</span><input name="tg" maxlength="30" value="${current.tg}" placeholder="${t('rcp.addrForPh')}"></label>
            <div class="btn-row"><button type="button" class="btn primary" data-act="addr">${t('rcp.addrApply')}</button>${current.an ? html`<button type="button" class="btn quiet" data-act="addr-clear">${t('rcp.addrClear')}</button>` : ''}</div>
            <small class="hint">${t('rcp.addrNote')}</small>
          </div>
        </details>
      </section>` : ''}
      <section class="rcpt-saved">
        <h2 class="panel-title">${t('rcp.savedTitle')}</h2>
        ${shops.length ? html`<div class="store-chips" role="list" aria-label="${t('rcp.stores')}">${shops.map((x) => html`<a class="store-chip" role="listitem" href="${storePageUrl(x.b)}">${x.logo ? html`<img src="${x.logo}" alt="">` : html`<span class="chip-mono" aria-hidden="true">${[...x.name][0] || '・'}</span>`}<span>${x.name}</span></a>`)}</div>` : ''}
        ${list.length
          ? html`<ul class="saved-list">${list.map((x) => html`<li>
              <button type="button" class="saved-row" data-act="open" data-id="${x.id}">
                ${brandOf(x.r)?.logo ? html`<img class="row-logo" src="${brandOf(x.r).logo}" alt="">` : ''}<span class="row-main"><span class="row-desc">${x.r.s || '—'}</span><span class="row-no">${x.r.t ? fmtDateTime(x.r.t * 1000) : ''}</span></span>
                <span class="row-amt">${yen(x.r.a)}</span>
              </button>
              <button type="button" class="icon-btn danger" data-act="del" data-id="${x.id}" aria-label="${t('rcp.delete')}">${icon('trash')}</button>
            </li>`)}</ul>
            <div class="btn-row">
              <button type="button" class="btn ghost" data-act="csv">${icon('download')}<span>${t('rcp.csv')}</span></button>
              <button type="button" class="btn danger-ghost" data-act="clear">${t('rcp.clear')}</button>
            </div>`
          : html`<p class="muted">${t('rcp.empty')}</p>`}
      </section>
    </main>`);
  if (current && verify === 'verified') {
    app.querySelector('.paper-wrap .rc-totals')?.insertAdjacentHTML('afterbegin', String(html`<div class="rc-stamp stamp">${stampSvg(current.t ? current.t * 1000 : Date.now())}</div>`));
  }
}

app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  switch (b.dataset.act) {
    case 'lang':
      setLang(getLang() === 'ja' ? 'en' : 'ja');
      render();
      break;
    case 'save': {
      if (!current) return;
      const rest = saved().filter((x) => x.id !== idOf(current));
      store.set(KEY, [{ id: idOf(current), savedAt: Date.now(), r: current }, ...rest].slice(0, 300));
      toast(t('rcp.savedToast'));
      render();
      break;
    }
    case 'addr':
    case 'addr-clear': {
      if (!current) return;
      const clear = b.dataset.act === 'addr-clear';
      const val = (n) => (clear ? '' : String(app.querySelector(`[name="${n}"]`)?.value || '').trim());
      current = sanitizeReceipt({ ...current, an: val('an'), tg: val('tg') });
      const id = idOf(current);
      const list = saved();
      if (list.some((x) => x.id === id)) store.set(KEY, list.map((x) => (x.id === id ? { id: x.id, savedAt: x.savedAt, r: current } : x)));
      history.replaceState(null, '', await receiptUrl(current)); // the link now carries the 宛名 too
      toast(t(clear ? 'rcp.addrCleared' : 'rcp.addrDone'));
      render();
      break;
    }
    case 'print':
      if (current) printHtml(renderReceipt(withBrand(current), { logo: brandOf(current)?.logo || '' }), { width: 80 });
      break;
    case 'copy': {
      const ok = await copyText(location.href);
      toast(ok ? t('common.copied') : t('common.copyFailed'), ok ? 'info' : 'error');
      break;
    }
    case 'open': {
      const x = saved().find((y) => y.id === b.dataset.id);
      if (!x) return;
      const url = await receiptUrl(x.r);
      location.hash = new URL(url).hash;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    }
    case 'del':
      store.set(KEY, saved().filter((x) => x.id !== b.dataset.id));
      render();
      break;
    case 'clear':
      if (await confirmDialog({ title: t('rcp.clearTitle'), body: t('rcp.clearBody'), ok: t('rcp.clear'), danger: true })) {
        store.del(KEY);
        render();
      }
      break;
    case 'csv': {
      const rows = saved().map(({ r }) => {
        const d = new Date(r.t * 1000);
        return [`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`, r.s, r.n, r.a, r.c ? chainName(r.c) : '', r.tx];
      });
      download(`reji-receipts-${ymd()}.csv`, csv([t('rcp.csvHead').split('|'), ...rows]), 'text/csv;charset=utf-8');
      break;
    }
    default:
  }
});

window.addEventListener('hashchange', load);
load();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
