// A store's public page: who runs it, where it is today and where to follow it.
// Built from the store's signed profile on the Nostr relays (no server), and it
// lists this phone's own receipts from the store.
import { html, $, b64urlDecode, b64urlEncode, copyText, toast, store, yen, attr } from './util.js';
import { TIP_PRESETS, LIMITS, CHAINS, chainName } from './config.js';
import { sameAddress } from './evm.js';
import { t, getLang, setLang, fmtDateTime } from './i18n.js';
import { icon } from './ui.js';
import { cachedBrand, fetchBrand, applyBrandColor } from './brand.js';
import { storeCard } from './storecard.js';
import { sanitizeReceipt, receiptUrl } from './receipt.js';

const app = $('#store');
const KEY = 'reji:receipts:v1';
const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
function pubFromHash() {
  const m = /(?:^#|&)p=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash);
  try { return m ? hexOf(b64urlDecode(m[1])) : ''; } catch { return ''; }
}

let pub = '';
let profile = null;
let phase = 'loading'; // loading | ready | missing | invalid
let mine = [];
let tipYen = 0;
let tipChain = 0;
let tipOpen = false;
let logoShown = false; // the logo fades in once
let menuOpen = false;

/** お品書き: the store's menu, grouped by category, with dotted leaders like a printed menu. */
function menuHtml() {
  const m = profile?.menu;
  if (!m?.items?.length) return '';
  const limit = menuOpen ? m.items.length : 12;
  const groups = [];
  for (const it of m.items.slice(0, limit)) {
    let g = groups.find((x) => x.cat === it.c);
    if (!g) groups.push((g = { cat: it.c, items: [] }));
    g.items.push(it);
  }
  return html`<section class="sp-menu">
    <h2 class="panel-title">${t('sp.menu')}<small>${t(m.tax === 'excl' ? 'sp.menuExcl' : 'sp.menuIncl')}</small></h2>
    ${groups.map((g) => html`${g.cat ? html`<h3 class="sp-cat">${g.cat}</h3>` : ''}<ul class="sp-items">${g.items.map((it) => html`<li><span class="sp-name">${it.n}</span><span class="sp-lead" aria-hidden="true"></span><span class="sp-price">${yen(it.p)}</span></li>`)}</ul>`)}
    ${m.items.length > limit ? html`<button type="button" class="btn quiet sp-more" data-act="menu-all">${t('sp.menuAll', { n: m.items.length })}</button>` : ''}
  </section>`;
}
const TKEY = 'reji:tips:v1';
const myTips = () => { const l = store.get(TKEY, []); return (Array.isArray(l) ? l : []).filter((x) => x && x.b === pub); };
const okTip = (n) => Number.isInteger(n) && n >= LIMITS.tipMin && n <= LIMITS.tipMax;

/** 応援: collapsed and near the bottom, only when the receiving wallet itself agreed (checked here). */
function tipHtml() {
  const tip = profile?.tip;
  if (!tip) return '';
  const chains = tip.chains.filter((c) => CHAINS[c]);
  if (!chains.includes(tipChain)) tipChain = chains[0];
  const seen = mine.map((x) => x.r.to).filter(Boolean);
  const same = seen.some((a) => sameAddress(a, tip.to));
  const sent = myTips();
  return html`<details class="sp-tip"${attr('open', tipOpen)}>
    <summary>${icon('pochi')}<span>${t('sp.tipTitle')}</span><small class="opt">${t('sp.tipOptional')}</small></summary>
    <div class="sp-tip-body">
      <p class="sp-tip-lead">${t('sp.tipLead')}</p>
      <div class="tip-amounts">${TIP_PRESETS.map((a) => html`<button type="button" class="tip-amt" data-act="tip-amt" data-a="${a}" aria-pressed="${String(tipYen === a)}">${yen(a)}</button>`)}</div>
      <label class="field tip-other"><span class="label sub">${t('sp.tipOther')}</span>
        <span class="tip-input"><input name="tipYen" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" value="${tipYen && !TIP_PRESETS.includes(tipYen) ? String(tipYen) : ''}" placeholder="${t('sp.tipOtherPh', { min: LIMITS.tipMin, max: LIMITS.tipMax.toLocaleString('ja-JP') })}"><span>${t('sp.tipYen')}</span></span></label>
      ${chains.length > 1 ? html`<label class="field"><span class="label sub">${t('sp.tipNet')}</span><select name="tipChain">${chains.map((c) => html`<option value="${c}"${attr('selected', c === tipChain)}>${chainName(c)}</option>`)}</select></label>` : ''}
      <dl class="kv tip-kv">
        <div><dt>${t('sp.tipTo')}</dt><dd><code class="mono">${tip.to}</code></dd></div>
        ${chains.length === 1 ? html`<div><dt>${t('sp.tipNet')}</dt><dd>${chainName(tipChain)}</dd></div>` : ''}
      </dl>
      <ul class="tip-checks">
        <li class="ok">${icon('check')}<span>${t('sp.tipSigned')}</span></li>
        ${same ? html`<li class="ok">${icon('check')}<span>${t('sp.tipSameAsReceipt')}</span></li>` : ''}
        ${seen.length && !same ? html`<li class="warn">${t('sp.tipDiffers')}</li>` : ''}
      </ul>
      <button type="button" class="btn primary tip-go" data-act="tip-go"${attr('disabled', !okTip(tipYen))}>${okTip(tipYen) ? t('sp.tipGo', { amount: yen(tipYen) }) : t('sp.tipPick')}</button>
      <p class="fine">${t('sp.tipFine')}</p>
      ${sent.length ? html`<p class="fine tip-mine">${t('sp.tipMine', { n: sent.length, sum: yen(sent.reduce((n, x) => n + (Number(x.a) || 0), 0)) })}</p>` : ''}
    </div>
  </details>`;
}
function tipUi() {
  const go = app.querySelector('.tip-go');
  if (!go) return;
  app.querySelectorAll('.tip-amt').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.a) === tipYen)));
  go.disabled = !okTip(tipYen);
  go.textContent = okTip(tipYen) ? t('sp.tipGo', { amount: yen(tipYen) }) : t('sp.tipPick');
}

async function myReceipts() {
  const list = store.get(KEY, []);
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    try {
      const r = sanitizeReceipt(x.r);
      if (r.b === pub) out.push({ r, url: await receiptUrl(r) });
    } catch { /* skip a damaged entry */ }
  }
  return out.sort((a, b) => b.r.t - a.r.t).slice(0, 30);
}

function render() {
  const name = profile?.name || mine[0]?.r.s || '';
  document.title = name ? `${name} | ${t('sp.title')}` : t('sp.title');
  applyBrandColor(document.documentElement, profile?.color || '');
  app.innerHTML = String(html`<header class="noren pay-top">
      <span class="pay-store">${profile?.logo ? html`<img class="store-logo${logoShown ? ' shown' : ''}" src="${profile.logo}" alt="">` : ''}<span class="brand-name">${name || t('sp.title')}</span></span>
      <button type="button" class="lang-btn" data-act="lang" lang="${getLang() === 'ja' ? 'en' : 'ja'}">${getLang() === 'ja' ? 'EN' : '日本語'}</button>
    </header>
    <main class="pay-main sp-main">
      ${phase === 'invalid' ? html`<p class="notice error">${t('sp.invalid')}</p>` : ''}
      ${phase === 'loading' && !profile ? html`<p class="working"><span class="spinner" aria-hidden="true"></span>${t('sp.loading')}</p>` : ''}
      ${phase === 'missing' && !profile ? html`<div class="notice warn"><p>${t('sp.missing')}</p></div><button type="button" class="btn primary" data-act="retry">${t('sp.retry')}</button>` : ''}
      ${profile ? html`${storeCard(profile)}
        <p class="sp-note">${t('sp.note')}</p>
        ${menuHtml()}
        <div class="btn-row sp-actions">
          ${navigator.share ? html`<button type="button" class="btn primary" data-act="share">${icon('share')}<span>${t('sp.share')}</span></button>` : ''}
          <button type="button" class="btn ghost" data-act="copy">${icon('copy')}<span>${t('sp.copy')}</span></button>
        </div>
        <section class="sp-jpyc"><h2 class="panel-title">${t('sp.payTitle')}</h2><p>${t('sp.pay')}</p></section>` : ''}
      ${mine.length ? html`<section class="sp-mine"><h2 class="panel-title">${t('sp.mine')}</h2>
        <ul class="saved-list">${mine.map(({ r, url }) => html`<li><a class="saved-row" href="${url}"><span class="row-main"><span class="row-desc">${r.n || r.s}</span><span class="row-no">${r.t ? fmtDateTime(r.t * 1000) : ''}</span></span><span class="row-amt">${yen(r.a)}</span></a></li>`)}</ul>
      </section>` : ''}
      ${tipHtml()}
    </main>
    <footer class="pay-foot"><p><a href="receipt.html">${t('pay.myReceipts')}</a></p></footer>`);
  if (profile?.logo) logoShown = true;
}

async function load() {
  pub = pubFromHash();
  if (!pub) {
    phase = 'invalid';
    profile = null;
    mine = [];
    render();
    return;
  }
  profile = cachedBrand(pub);
  mine = await myReceipts();
  phase = 'loading';
  render();
  const fresh = await fetchBrand(pub).catch(() => null);
  if (fresh) profile = fresh;
  phase = profile ? 'ready' : 'missing';
  render();
}

app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  switch (b.dataset.act) {
    case 'lang':
      setLang(getLang() === 'ja' ? 'en' : 'ja');
      render();
      break;
    case 'retry':
      load();
      break;
    case 'menu-all':
      menuOpen = true;
      render();
      break;
    case 'share':
      try { await navigator.share({ title: profile?.name || t('sp.title'), text: t('sp.shareText', { name: profile?.name || '' }), url: location.href }); } catch { /* closed */ }
      break;
    case 'tip-amt': {
      tipYen = Number(b.dataset.a);
      tipOpen = true;
      const inp = app.querySelector('[name="tipYen"]');
      if (inp) inp.value = '';
      tipUi();
      break;
    }
    case 'tip-go': {
      const tip = profile?.tip;
      if (!tip || !okTip(tipYen)) return;
      const u = new URL('pay.html', location.href);
      u.hash = '';
      u.search = new URLSearchParams({ tip: '1', to: tip.to, c: String(tipChain), a: String(tipYen), s: profile.name || '',
        b: b64urlEncode(Uint8Array.from(pub.match(/../g), (h) => parseInt(h, 16))), ...(profile.color ? { bc: profile.color.slice(1) } : {}) }).toString();
      location.href = u.toString();
      break;
    }
    case 'copy': {
      const ok = await copyText(location.href);
      toast(ok ? t('common.copied') : t('common.copyFailed'), ok ? 'info' : 'error');
      break;
    }
    default:
  }
});
app.addEventListener('input', (e) => {
  if (e.target.name !== 'tipYen') return;
  const digits = e.target.value.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/[^0-9]/g, ''); // 全角 digits are fine too
  if (digits !== e.target.value) e.target.value = digits;
  tipYen = digits ? Number(digits) : 0;
  tipOpen = true;
  tipUi();
});
app.addEventListener('change', (e) => { if (e.target.name === 'tipChain') tipChain = Number(e.target.value); });
app.addEventListener('toggle', (e) => { if (e.target.classList?.contains('sp-tip')) tipOpen = e.target.open; }, true);
window.addEventListener('hashchange', load);
load();
