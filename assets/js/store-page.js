// A store's public page: who runs it, where it is today and where to follow it.
// Built from the store's signed profile on the Nostr relays (no server), and it
// lists this phone's own receipts from the store.
import { html, $, b64urlDecode, b64urlEncode, copyText, toast, store, yen, attr } from './util.js';
import { TIP_PRESETS, LIMITS, CHAINS, chainName } from './config.js';
import { sameAddress, isOkuriValue, isTipValue, UNIT } from './evm.js';
import { t, getLang, setLang, fmtDateTime, fmtDay } from './i18n.js';
import { icon, modal } from './ui.js';
import { STAMP, stampable, cardState, stampRec } from './stampcore.js';
import { cachedBrand, fetchBrand, applyBrandColor, okuriActive } from './brand.js';
import { txReceipt, transfersInReceipt, rpc, blockNumber, scanTransfers } from './rpc.js';
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
let mineAll = []; // every receipt this phone has from the store (the stamp card counts these)
let tipYen = 0;
let tipChain = 0;
let tipOpen = false;
let standYen = 0; // 置きQR: the amount the customer typed (or tapped together from the menu)
let standChain = 0;
let okuriSeen = false;
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
    ${groups.map((g) => html`${g.cat ? html`<h3 class="sp-cat">${g.cat}</h3>` : ''}<ul class="sp-items">${g.items.map((it) => html`<li class="${it.o ? 'out' : ''}"><span class="sp-name">${it.n}</span>${it.o ? html`<span class="sp-soldout">${t('sp.soldOut')}</span>` : ''}<span class="sp-lead" aria-hidden="true"></span><span class="sp-price">${yen(it.p)}</span>${profile.stand && !it.o ? html`<button type="button" class="btn quiet small sp-add" data-act="stand-add" data-p="${it.p}" aria-label="${t('sp.standAdd', { name: it.n })}">＋</button>` : ''}</li>`)}</ul>`)}
    ${m.items.length > limit ? html`<button type="button" class="btn quiet sp-more" data-act="menu-all">${t('sp.menuAll', { n: m.items.length })}</button>` : ''}
  </section>`;
}
const TKEY = 'reji:tips:v1';
const myTips = () => { const l = store.get(TKEY, []); return (Array.isArray(l) ? l : []).filter((x) => x && x.b === pub); };
const okTip = (n) => Number.isInteger(n) && n >= LIMITS.tipMin && n <= LIMITS.tipMax;

/** 応援: collapsed and near the bottom, only when the receiving wallet itself agreed (checked here). */
// ---- 恩送り: facts anyone can check on the blockchain, for the supporter to weigh. Reji judges nothing. ----
let facts = null; // { n, payers, first, last } from the store's own example sales, or { n: 0 }
let factsFor = '';
let tally = null; // { n, sum } of 恩送り in the last days, counted on request
async function okuriFacts() {
  const k = profile?.okuri;
  const to = profile?.tip?.to;
  const key = `${pub}:${k?.since}`;
  if (!k || !to || factsFor === key) return;
  factsFor = key;
  const seen = [];
  for (const pr of k.proofs) {
    try {
      const rc = await txReceipt(pr.c, pr.tx);
      const tr = transfersInReceipt(rc, to).find((x) => !isTipValue(x.value) && x.value % UNIT <= BigInt(LIMITS.suffixMax) && x.value >= UNIT);
      if (!tr) continue;
      const b = await rpc(pr.c, 'eth_getBlockByNumber', ['0x' + BigInt(rc.blockNumber).toString(16), false]);
      seen.push({ from: String(tr.from).toLowerCase(), at: Number(BigInt(b.timestamp)) * 1000 });
    } catch { /* a node did not answer: that example is simply not counted */ }
  }
  facts = seen.length ? { n: seen.length, payers: new Set(seen.map((x) => x.from)).size, first: Math.min(...seen.map((x) => x.at)), last: Math.max(...seen.map((x) => x.at)) } : { n: 0 };
  render();
}
async function countOkuri(btn) {
  const to = profile?.tip?.to;
  if (!to) return;
  btn.disabled = true;
  btn.textContent = t('sp.okuriCounting');
  try {
    const ch = CHAINS[tipChain];
    const latest = await blockNumber(tipChain);
    const from = Math.max(0, latest - Math.ceil((7 * 86400) / ch.blockTime));
    const found = await scanTransfers(tipChain, to, from, latest, { chunk: 2000, maxChunks: 400 });
    const mine = found.filter((x) => isOkuriValue(x.value));
    tally = { n: mine.length, sum: Number(mine.reduce((a, x) => a + x.value / UNIT, 0n)) };
  } catch {
    tally = { failed: true };
  }
  render();
}
function okuriHtml() {
  const k = profile.okuri;
  return html`<div class="okuri-info">
      <p class="okuri-tags"><span class="okuri-cat" data-cat="${k.cat}">${t(k.cat === 'disaster' ? 'okuri.catDisaster' : 'okuri.catOther')}</span>${k.area ? html`<span class="okuri-area">${k.area}</span>` : ''}<span class="okuri-until">${t('okuri.until', { date: fmtDay(k.until) })}</span></p>
      ${k.msg ? html`<p class="okuri-msg">${k.msg}</p>` : ''}
      <ul class="tip-checks okuri-facts">
        ${facts == null ? html`<li>${t('sp.okuriChecking')}</li>`
          : facts.n ? html`<li class="ok">${icon('check')}<span>${t('sp.okuriUsed', { n: facts.n, first: fmtDay(facts.first), last: fmtDay(facts.last), payers: facts.payers })}</span></li>`
          : html`<li>${t('sp.okuriNoProof')}</li>`}
        ${tally == null ? html`<li><button type="button" class="btn ghost small" data-act="okuri-count">${t('sp.okuriCount')}</button></li>`
          : tally.failed ? html`<li>${t('sp.okuriCountFailed')}</li>`
          : html`<li class="ok">${icon('check')}<span>${t('sp.okuriCounted', { n: tally.n, sum: yen(tally.sum) })}</span></li>`}
      </ul>
      <p class="fine">${t('sp.okuriJudge')}</p>
    </div>`;
}

// ---- 置きQR (unattended sales): the customer types the amount and pays the address the store's wallet signed ----
const okStand = (n) => Number.isInteger(n) && n >= 1 && n <= LIMITS.maxYen;
function standHtml() {
  const st = profile?.stand;
  if (!st) return '';
  if (!st.chains.includes(standChain)) standChain = st.chains[0];
  return html`<section class="sp-stand" id="stand">
    <h2 class="panel-title">${t('sp.standTitle')}</h2>
    <p class="sp-tip-lead">${t(profile.menu?.items?.length ? 'sp.standLeadMenu' : 'sp.standLead')}</p>
    <label class="field"><span class="label sub">${t('sp.standAmount')}</span>
      <span class="tip-input"><input name="standYen" type="text" inputmode="numeric" maxlength="7" autocomplete="off" value="${standYen || ''}" placeholder="0"><span>${t('sp.tipYen')}</span></span></label>
    ${standYen ? html`<button type="button" class="btn quiet small stand-clear" data-act="stand-clear">${t('sp.standClear')}</button>` : ''}
    ${st.chains.length > 1 ? html`<label class="field"><span class="label sub">${t('sp.tipNet')}</span><select name="standChain">${st.chains.map((c) => html`<option value="${c}"${attr('selected', c === standChain)}>${chainName(c)}</option>`)}</select></label>` : ''}
    <button type="button" class="btn primary big stand-go" data-act="stand-go"${attr('disabled', !okStand(standYen))}>${okStand(standYen) ? t('sp.standGo', { amount: yen(standYen) }) : t('sp.standGoNone')}</button>
    <p class="fine">${t('sp.standFine')}</p>
  </section>`;
}

// ---- スタンプカード: counted here, from this phone's own receipts; each stamp is a payment checked on the blockchain ----
const stampCard = () => (profile?.stamp && profile.addr ? profile.stamp : null);
const stampAll = () => { const a = store.get(STAMP.key, {}); return a && typeof a === 'object' && !Array.isArray(a) ? a : {}; };
const stampMine = () => stampRec(stampAll(), pub);
const stampSave = (rec) => store.set(STAMP.key, { ...stampAll(), [pub]: rec });
const stampNow = (card, rec = stampMine()) => cardState(stampable(mineAll.map((x) => x.r), pub, card), rec, card.n);
let stampBusy = false;
async function checkStamps() {
  const card = stampCard();
  if (!card || stampBusy) return;
  const rec = stampMine();
  const known = new Set([...rec.ok, ...rec.bad]);
  const todo = stampable(mineAll.map((x) => x.r), pub, card).filter((x) => !known.has(x.id));
  if (!todo.length) return;
  stampBusy = true;
  let changed = false;
  for (const x of todo) {
    try {
      const rc = await txReceipt(x.c, x.tx);
      if (!rc) continue; // not in a block yet: looked at again next time
      const good = rc.status === '0x1' && transfersInReceipt(rc, profile.addr).some((v) => !isTipValue(v.value) && v.value / UNIT === BigInt(x.a));
      (good ? rec.ok : rec.bad).push(x.id);
      changed = true;
    } catch { /* a node did not answer: that receipt waits */ }
  }
  stampBusy = false;
  if (changed) {
    const now = stampMine(); // keep what a reward used meanwhile
    stampSave({ ...now, ok: [...new Set([...now.ok, ...rec.ok])], bad: [...new Set([...now.bad, ...rec.bad])] });
    render();
  }
}
function stampHtml() {
  const card = stampCard();
  if (!card) return '';
  const rec = stampMine();
  const st = stampNow(card, rec);
  const filled = Math.min(st.have, card.n);
  const last = rec.log.at(-1);
  return html`<section class="sp-stamp" id="stamp">
    <h2 class="panel-title">${t('sp.stampTitle')}</h2>
    <p class="stamp-gift"><span>${t('sp.stampFor', { n: card.n })}</span><b>${card.gift}</b></p>
    <ol class="stamp-grid" aria-label="${t('sp.stampCount', { have: filled, n: card.n })}">${Array.from({ length: card.n }, (_, i) => html`<li class="${i < filled ? 'on' : ''}">${i < filled ? icon('check') : String(i + 1)}</li>`)}</ol>
    ${st.full ? html`<button type="button" class="btn primary big" data-act="stamp-use">${t('sp.stampUse')}</button>${st.have > card.n ? html`<p class="fine">${t('sp.stampCarry', { k: st.have - card.n })}</p>` : ''}`
      : html`<p class="stamp-left">${t('sp.stampLeft', { k: card.n - st.have })}</p>`}
    ${st.pending ? html`<p class="fine">${t('sp.stampPending', { n: st.pending })}</p>` : ''}
    <p class="fine">${t(card.min ? 'sp.stampRuleMin' : 'sp.stampRule', { min: yen(card.min) })}</p>
    ${last ? html`<p class="fine stamp-last">${t('sp.stampLast', { when: fmtDateTime(last.t) })}</p>` : ''}
  </section>`;
}
/** The reward: shown to the store's staff, then marked used in front of them. The stamps it used are gone for good. */
function useStamps() {
  const card = stampCard();
  if (!card) return;
  const st = stampNow(card);
  if (!st.full) return;
  const clock = () => { const d = new Date(); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':'); };
  const ticket = (used) => html`<div class="stamp-ticket${used ? ' used' : ''}">
      <p class="st-store">${profile.name || ''}</p>
      <p class="st-gift">${card.gift}</p>
      ${used ? html`<p class="st-used">${icon('check')}<span>${t('sp.useDone')}</span></p><p class="st-clock">${fmtDateTime(used)}</p>` : html`<p class="st-clock" data-clock>${clock()}</p>`}
    </div>`;
  const m = modal(html`<h2 class="modal-title">${t('sp.useTitle')}</h2>
    ${ticket(0)}
    <p class="modal-text">${t('sp.useLead', { n: card.n })}</p>
    <details class="st-nos"><summary>${t('sp.useNos')}</summary><p>${st.next.map((x) => x.no || `${x.tx.slice(0, 10)}…`).join('、')}</p></details>
    <div class="modal-actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button>
      <button type="button" class="btn primary" data-ok>${t('sp.useOk')}</button></div>`, { label: t('sp.useTitle'), size: 'small', onClose: () => { clearInterval(tick); render(); } });
  const tick = setInterval(() => { const c = m.el.querySelector('[data-clock]'); if (c) c.textContent = clock(); }, 1000);
  m.el.querySelector('[data-ok]').addEventListener('click', () => {
    const rec = stampMine();
    const at = Date.now();
    stampSave({ ...rec, used: [...rec.used, ...st.next.map((x) => x.id)], log: [...rec.log, { t: at, n: card.n, gift: card.gift }] });
    m.el.innerHTML = String(html`<h2 class="modal-title">${t('sp.useTitle')}</h2>${ticket(at)}
      <p class="modal-text">${t('sp.useDoneText')}</p>
      <div class="modal-actions"><button type="button" class="btn primary" data-close>${t('common.close')}</button></div>`);
  });
}

function tipHtml() {
  const tip = profile?.tip;
  if (!tip) return '';
  const chains = tip.chains.filter((c) => CHAINS[c]);
  if (!chains.includes(tipChain)) tipChain = chains[0];
  const seen = mine.map((x) => x.r.to).filter(Boolean);
  const same = seen.some((a) => sameAddress(a, tip.to));
  const sent = myTips();
  const ok = okuriActive(profile); // while the store lists itself, the section is 恩送り and starts open
  if (ok && !okuriSeen) { okuriSeen = true; tipOpen = true; }
  return html`<details class="sp-tip${ok ? ' sp-okuri' : ''}"${attr('open', tipOpen)}>
    <summary>${icon('pochi')}<span>${t(ok ? 'sp.okuriTitle' : 'sp.tipTitle')}</span><small class="opt">${t('sp.tipOptional')}</small></summary>
    <div class="sp-tip-body">
      ${ok ? okuriHtml() : ''}
      <p class="sp-tip-lead">${t(ok ? 'sp.okuriLead' : 'sp.tipLead')}</p>
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
  return out.sort((a, b) => b.r.t - a.r.t);
}

function render() {
  // Keep the cursor where the customer was typing (a fresh store profile can redraw the page).
  const focused = document.activeElement?.name ? { name: document.activeElement.name, sel: [document.activeElement.selectionStart, document.activeElement.selectionEnd] } : null;
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
        ${standHtml()}
        ${stampHtml()}
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
    <footer class="pay-foot"><p><a href="hajimete.html">${t('pay.firstTime')}</a> · <a href="receipt.html">${t('pay.myReceipts')}</a></p></footer>`);
  if (focused) {
    const el = app.querySelector(`[name="${focused.name}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (typeof focused.sel[0] === 'number') try { el.setSelectionRange(...focused.sel); } catch { /* not a text field */ }
    }
  }
  if (profile?.logo) logoShown = true;
  if (okuriActive(profile)) okuriFacts();
  checkStamps();
}

async function load() {
  pub = pubFromHash();
  if (!pub) {
    phase = 'invalid';
    profile = null;
    mine = [];
    mineAll = [];
    render();
    return;
  }
  profile = cachedBrand(pub);
  mineAll = await myReceipts();
  mine = mineAll.slice(0, 30);
  phase = 'loading';
  render();
  const fresh = await fetchBrand(pub).catch(() => null);
  // Redraw only when something changed: a redraw while a customer types a tip amount would take the cursor away.
  const changed = !!fresh && JSON.stringify(fresh) !== JSON.stringify(profile);
  if (fresh) profile = fresh;
  const next = profile ? 'ready' : 'missing';
  if (changed || next !== phase) {
    phase = next;
    render();
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
    case 'okuri-count':
      countOkuri(b);
      break;
    case 'stand-add':
      standYen = Math.min(LIMITS.maxYen, standYen + Number(b.dataset.p || 0));
      render();
      document.getElementById('stand')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      break;
    case 'stamp-use':
      useStamps();
      break;
    case 'stand-clear':
      standYen = 0;
      render();
      break;
    case 'stand-go': {
      const st = profile?.stand;
      if (!st || !okStand(standYen)) return;
      const u = new URL('pay.html', location.href);
      u.hash = '';
      u.search = new URLSearchParams({ st: '1', to: st.to, c: String(standChain), a: String(standYen), s: profile.name || '', d: t('sp.standItem'),
        b: b64urlEncode(Uint8Array.from(pub.match(/../g), (h) => parseInt(h, 16))), ...(profile.color ? { bc: profile.color.slice(1) } : {}) }).toString();
      location.href = u.toString();
      break;
    }
    case 'tip-go': {
      const tip = profile?.tip;
      if (!tip || !okTip(tipYen)) return;
      const u = new URL('pay.html', location.href);
      u.hash = '';
      u.search = new URLSearchParams({ tip: okuriActive(profile) ? '2' : '1', to: tip.to, c: String(tipChain), a: String(tipYen), s: profile.name || '',
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
  if (e.target.name === 'standYen') {
    const d = e.target.value.replace(/[０-９]/g, (x) => String.fromCharCode(x.charCodeAt(0) - 0xfee0)).replace(/[^0-9]/g, '');
    if (d !== e.target.value) e.target.value = d;
    standYen = d ? Number(d) : 0;
    const go = app.querySelector('[data-act="stand-go"]');
    if (go) { go.disabled = !okStand(standYen); go.textContent = okStand(standYen) ? t('sp.standGo', { amount: yen(standYen) }) : t('sp.standGoNone'); }
    return;
  }
  if (e.target.name !== 'tipYen') return;
  const digits = e.target.value.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/[^0-9]/g, ''); // 全角 digits are fine too
  if (digits !== e.target.value) e.target.value = digits;
  tipYen = digits ? Number(digits) : 0;
  tipOpen = true;
  tipUi();
});
app.addEventListener('change', (e) => { if (e.target.name === 'tipChain') tipChain = Number(e.target.value); if (e.target.name === 'standChain') standChain = Number(e.target.value); });
app.addEventListener('toggle', (e) => { if (e.target.classList?.contains('sp-tip')) tipOpen = e.target.open; }, true);
window.addEventListener('hashchange', load);
load();
