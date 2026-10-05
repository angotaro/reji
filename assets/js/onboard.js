// "かんたん設定": the guided first-run setup. One step at a time; required steps
// can't be skipped, recommended and optional ones are labelled and can be. Progress
// is kept on this device, so closing the browser resumes where the owner left off.
import { state, saveSettings, saveProducts, sampleProducts, normalizeProducts, isTestnet } from './state.js';
import { MAINNET_IDS, chainName, JPYC } from './config.js';
import { addressStatus, checksum, sameAddress, formatUnits } from './evm.js';
import { t, getLang } from './i18n.js';
import { html, raw, attr, $, $$, store, uid, shortAddr, nextTerminal } from './util.js';
import { readBackup, applyBackup } from './backup.js';
import { fmtDateTime } from './i18n.js';
import { icon, modal, hashPin, markUnlocked } from './ui.js';
import { verifyOwner } from './owner.js';
import { ownerVerified, gasWallet, createGasWallet, refreshGasBalance, cachedGasBalance, gasChainId, MIN_GAS } from './gas.js';
import { qrSvg } from './qr.js';
import { cleanAddress, normalizeRegNo, toHalfWidth } from './settings.js';
import { brandFields, brandPreview, readBrand, bindBrandFields } from './brandui.js';
import { publishBrand, validLogo as okLogo, validColor as okColor, validLink as okLink } from './brand.js';

const OB_KEY = 'reji:onboard:v1';
const STEPS = [
  { id: 'welcome' },
  { id: 'store', kind: 'req' },
  { id: 'wallet', kind: 'req' },
  { id: 'owner', kind: 'rec' },
  { id: 'network', kind: 'req' },
  { id: 'menu', kind: 'opt' },
  { id: 'receipt', kind: 'opt' },
  { id: 'brand', kind: 'opt' },
  { id: 'pin', kind: 'rec' },
  { id: 'gasless', kind: 'opt' },
  { id: 'done' },
];
const NUMBERED = STEPS.filter((s) => s.kind);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const onboardState = () => store.get(OB_KEY, null);
const saveOb = (o) => store.set(OB_KEY, o);

/** First run (no receiving wallet yet, unless manual setup was chosen) or a guide left unfinished. */
export function needsOnboarding() {
  const o = onboardState();
  if (!state.settings.address) return !o?.manual;
  return !!(o && !o.finished);
}
/** Start over from the welcome screen (after choosing manual setup, before any wallet was set). */
export const restartOnboarding = () => saveOb({ step: 0, done: {}, skipped: {}, finished: false });
/** Open the guide again from Settings (starts at the first real step). */
export const reopenOnboarding = () => saveOb({ step: 1, done: {}, skipped: {}, rerun: true, finished: false });
export function endRerun() {
  const o = onboardState();
  if (o) saveOb({ ...o, finished: true });
}

const badge = (kind) => html`<span class="ob-badge" data-k="${kind}">${t('ob.' + kind)}</span>`;
const choice = (name, value, checked, title, hint, tag = '') => html`<label class="ob-choice">
  <input type="radio" name="${name}" value="${value}"${attr('checked', checked)}>
  <span class="ob-choice-mark" aria-hidden="true"></span>
  <span class="ob-choice-body"><b>${title}${tag ? html`<em>${tag}</em>` : ''}</b><small>${hint}</small></span>
</label>`;
const seg = (name, value, cur, label) => html`<label class="seg-opt"><input type="radio" name="${name}" value="${value}"${attr('checked', cur === value)}><span>${label}</span></label>`;
const prow = () => html`<div class="ob-prow">
  <input name="pn" maxlength="40" placeholder="${t('ob.menu.namePh')}" autocomplete="off" aria-label="${t('ob.menu.namePh')}">
  <input name="pp" inputmode="numeric" placeholder="${t('ob.menu.pricePh')}" autocomplete="off" aria-label="${t('ob.menu.pricePh')}">
  <select name="pt" aria-label="${t('ob.menu.tax')}"><option value="10">10%</option><option value="8">8%</option></select>
</div>`;
function addrCard(a) {
  const g = a.slice(2).match(/.{1,4}/g);
  return html`<div class="ob-addr-card"><span class="ob-addr-label">${icon('check')} ${t('ob.wallet.checkTitle')}</span>
    <code><b>0x${g[0]}</b> ${g.slice(1, -1).join(' ')} <b>${g[g.length - 1]}</b></code>
    <small>${t('ob.wallet.check')}</small></div>`;
}

function confirmSkipAll() {
  const m = modal(html`<div class="ob-warn">
      <div class="ob-warn-icon" aria-hidden="true">!</div>
      <h2 class="modal-title">${t('ob.manual.title')}</h2>
      <p class="modal-text">${t('ob.manual.body')}</p>
      <ul class="ob-warn-list"><li>${t('ob.manual.r1')}</li><li>${t('ob.manual.r2')}</li><li>${t('ob.manual.r3')}</li></ul>
      <p class="ob-warn-strong">${t('ob.manual.strong')}</p>
      <div class="ob-warn-actions">
        <button type="button" class="btn primary big" data-close autofocus>${t('ob.manual.cancel')}</button>
        <button type="button" class="btn quiet" data-ok>${t('ob.manual.ok')}</button>
      </div>
    </div>`, { label: t('ob.manual.title'), size: 'small' });
  m.el.querySelector('[data-ok]').addEventListener('click', () => m.close(true));
  return m.result.then((v) => v === true);
}

export function renderOnboarding(main, { finish, manual }) {
  let ob = onboardState();
  if (!ob || ob.finished) {
    ob = { step: 0, done: {}, skipped: {}, finished: false };
    saveOb(ob);
  }
  ob.step = Math.min(Math.max(ob.rerun ? 1 : 0, ob.step | 0), STEPS.length - 1);
  ob.done ||= {};
  ob.skipped ||= {};
  main.innerHTML = String(html`<div class="ob">
    <div class="ob-top">
      <p class="ob-brand">${icon('check')}<span>${t('ob.brand')}</span></p>
      <p class="ob-count" id="ob-count"></p>
      <button type="button" class="ob-later" data-ob="later">${t(ob.rerun ? 'ob.close' : 'ob.later')}</button>
    </div>
    <div class="ob-progress" aria-hidden="true"><span id="ob-bar"></span></div>
    <div class="ob-body">
      <ol class="ob-rail" id="ob-rail">${NUMBERED.map((s, i) => html`<li data-id="${s.id}"><span class="ob-dot">${i + 1}</span><span class="ob-rname">${t('ob.' + s.id + '.name')}</span>${badge(s.kind)}</li>`)}</ol>
      <div class="ob-stage"><section class="ob-card" id="ob-card" aria-live="polite"></section></div>
    </div>
    <div class="ob-actions" id="ob-actions"></div>
  </div>`);

  const card = () => $('#ob-card', main);
  const cur = () => STEPS[ob.step];
  const field = (name) => card().querySelector(`[name="${name}"]`);
  const all = (sel) => [...$$(sel, card())];
  const errors = (map) => {
    for (const el of all('[data-err]')) {
      const msg = map[el.dataset.err] || '';
      el.textContent = msg;
      el.closest('.field')?.classList.toggle('has-error', !!msg);
    }
    const first = Object.keys(map)[0];
    if (first) card().querySelector(`[data-err="${first}"]`)?.closest('.field')?.querySelector('input')?.focus();
    return !first;
  };
  const head = (st) => html`<p class="ob-kicker">${badge(st.kind)}</p>
    <h1 class="ob-title">${t('ob.' + st.id + '.title')}</h1>
    <p class="ob-lead">${t('ob.' + st.id + '.lead')}</p>`;
  const canNext = (st) => st.id !== 'owner' || ownerVerified();
  const rs = { open: false, b: null, bad: false, mode: 'replace' }; // お店の引き継ぎ (restore from a backup)
  const restoreView = () => {
    const b = rs.b;
    return html`<p class="ob-kicker"></p>
      <h1 class="ob-title">${t('rs.title')}</h1>
      <p class="ob-lead">${t('rs.lead')}</p>
      <ol class="rs-steps"><li>${t('rs.step1')}</li><li>${t('rs.step2')}</li><li>${t('rs.step3')}</li></ol>
      <div class="rs-pick">
        <label class="btn ${b ? 'ghost' : 'primary big'} file-btn">${icon('upload')}<span>${t(b ? 'rs.repick' : 'rs.pick')}</span><input type="file" accept="application/json,.json" data-ob-file hidden></label>
        <a class="rs-guide" href="backup.html" target="_blank" rel="noopener">${icon('external')}<span>${t('rs.guide')}</span></a>
      </div>
      ${rs.bad ? html`<p class="notice error" role="alert">${t('rs.bad')}</p>` : ''}
      ${b ? html`<div class="rs-preview">
          ${okLogo(b.settings.logo) ? html`<img class="rs-logo" src="${b.settings.logo}" alt="">` : html`<span class="rs-logo rs-mono" aria-hidden="true">${[...(b.settings.storeName || '・')][0]}</span>`}
          <div class="rs-info">
            <p class="rs-name">${b.settings.storeName || '—'}</p>
            <p class="rs-meta">${b.exportedAt ? t('rs.saved', { when: fmtDateTime(b.exportedAt) }) : ''}</p>
            <p class="rs-meta">${t('rs.counts', { p: b.products.length, s: b.sales.length })}${b.settings.address ? html`　${t('rs.addr', { a: shortAddr(b.settings.address) })}` : ''}</p>
          </div>
        </div>
        <fieldset class="rs-how"><legend>${t('rs.how')}</legend>
          <label class="rs-opt"><input type="radio" name="rsmode" value="replace"${attr('checked', rs.mode === 'replace')}><span><b>${t('rs.replace')}</b><small>${t('rs.replaceText')}</small></span></label>
          <label class="rs-opt"><input type="radio" name="rsmode" value="second"${attr('checked', rs.mode === 'second')}><span><b>${t('rs.second')}</b><small>${t('rs.secondText', { t: nextTerminal(b.settings.terminal) })}</small></span></label>
        </fieldset>
        <p class="hint">${t('rs.note')}</p>` : ''}`;
  };
  const complete = (st) => (st.id === 'owner' ? ownerVerified() : st.id === 'pin' ? !!state.settings.pinHash : false);

  const statusOf = (id) => {
    const s = state.settings;
    if (id === 'store') return s.storeName ? 'done' : 'warn';
    if (id === 'wallet') return s.address ? 'done' : 'warn';
    if (id === 'owner') return ownerVerified() ? 'done' : 'warn';
    if (id === 'menu') return state.products.length ? 'done' : 'none';
    if (id === 'receipt') return ob.done.receipt ? 'done' : 'default';
    if (id === 'brand') return okLogo(s.logo) || okColor(s.brandColor) || okLink(s.storeLink) ? 'done' : 'default';
    if (id === 'pin') return s.pinHash ? 'done' : 'warn';
    if (id === 'gasless') return gasWallet() && s.chains.includes(137) ? 'done' : 'skipped';
    return 'done';
  };

  const VIEWS = {
    welcome: () => html`<div class="ob-hero">
        <div class="ob-mark" aria-hidden="true">${icon('receipt')}</div>
        <h1 class="ob-title">${t('ob.welcome.title')}</h1>
        <p class="ob-lead">${t('ob.welcome.lead')}</p>
      </div>
      <div class="ob-choices">
        <button type="button" class="ob-choice" data-ob="next">
          <span class="ob-choice-icon" aria-hidden="true">${icon('plus')}</span>
          <span class="ob-choice-text"><b>${t('ob.new.title')}</b><small>${t('ob.new.text')}</small></span>
          ${icon('back', 'flip')}
        </button>
        <button type="button" class="ob-choice" data-ob="restore">
          <span class="ob-choice-icon" aria-hidden="true">${icon('upload')}</span>
          <span class="ob-choice-text"><b>${t('ob.move.title')}</b><small>${t('ob.move.text')}</small></span>
          ${icon('back', 'flip')}
        </button>
      </div>
      <p class="ob-help"><a href="backup.html" target="_blank" rel="noopener">${icon('external')}<span>${t('ob.move.help')}</span></a></p>
      <h2 class="ob-sub">${t('ob.flow')}</h2>
      <ol class="ob-list">${NUMBERED.map((s, i) => html`<li style="--i:${i}"><span class="ob-num">${i + 1}</span><span class="ob-lname">${t('ob.' + s.id + '.name')}</span>${badge(s.kind)}</li>`)}</ol>
      <div class="ob-need"><p><b>${t('ob.welcome.need')}</b></p><ul>
        <li>${icon('wallet')}<span>${t('ob.welcome.need1')}</span></li>
        <li>${icon('qr')}<span>${t('ob.welcome.need2')}</span></li></ul></div>
      <p class="ob-safe">${icon('lock')}<span>${t('setup.safe')}</span></p>
      <p class="ob-agree">${t('ob.welcome.agree1')}<a href="terms.html" target="_blank" rel="noopener">${t('about.terms')}</a>${t('ob.welcome.agree2')}<a href="privacy.html" target="_blank" rel="noopener">${t('about.privacy')}</a>${t('ob.welcome.agree3')}</p>`,

    store: (st) => html`${head(st)}
      <label class="field"><span class="label">${t('set.storeName')}</span>
        <input name="storeName" value="${state.settings.storeName}" maxlength="40" placeholder="${t('setup.storePh')}" autocomplete="off" enterkeyhint="next">
        <small class="field-error" data-err="storeName"></small></label>`,

    wallet: (st) => {
      const s = state.settings;
      if (ob.rerun && s.address && ownerVerified()) {
        return html`${head(st)}${addrCard(s.address)}<p class="ob-note">${icon('lock')}<span>${t('ob.wallet.locked')}</span></p>`;
      }
      return html`${head(st)}
        <label class="field"><span class="label">${t('ob.wallet.label')}</span>
          <input name="address" class="addr-input" value="${s.address}" placeholder="0x…" spellcheck="false" autocapitalize="off" autocomplete="off" enterkeyhint="next">
          <small class="field-error" data-err="address"></small></label>
        ${window.ethereum ? html`<button type="button" class="btn ghost small" data-ob-act="from-wallet">${icon('wallet')}<span>${t('ob.wallet.fromBrowser')}</span></button>` : ''}
        <div class="ob-addr" id="ob-addr">${addressStatus(cleanAddress(s.address)) === 'ok' ? addrCard(checksum(cleanAddress(s.address))) : ''}</div>
        <p class="ob-note warn">${t('ob.wallet.warn')}</p>`;
    },

    owner: (st) => {
      const s = state.settings;
      const ok = ownerVerified();
      return html`${head(st)}
        ${ok
          ? html`<p class="ob-okline">${icon('check')}<span>${t('ob.owner.done', { addr: shortAddr(s.owner.address) })}</span></p>`
          : html`<div class="ob-ownerbox"><button type="button" class="btn primary big" data-ob-act="verify">${icon('lock')}<span>${t('ob.owner.btn')}</span></button>
              <p class="hint">${t('owner.setupHint')}</p></div>
            <p class="ob-note warn">${t('ob.owner.skipNote')}</p>`}`;
    },

    network: (st) => {
      const s = state.settings;
      const net = ob.done.network || ob.rerun ? s.network : 'testnet';
      return html`${head(st)}
        <div class="ob-choices" role="radiogroup" aria-label="${t('ob.network.name')}">
          ${choice('network', 'testnet', net === 'testnet', t('ob.network.test'), t('ob.network.testHint'), t('ob.recommended'))}
          ${choice('network', 'mainnet', net === 'mainnet', t('ob.network.live'), t('ob.network.liveHint'))}
        </div>
        <fieldset class="field"><legend class="label">${t('set.chains')}</legend>
          <div class="chip-checks">${MAINNET_IDS.map((id) => html`<label class="chip-check"><input type="checkbox" name="chains" value="${id}"${attr('checked', s.chains.includes(id))}><span>${chainName(id)}</span></label>`)}</div>
          <small class="hint">${t('ob.network.chainsHint')}</small>
          <small class="field-error" data-err="chains"></small></fieldset>`;
    },

    menu: (st) => {
      const n = state.products.length;
      return html`${head(st)}
        <div class="ob-choices" role="radiogroup" aria-label="${t('ob.menu.name')}">
          ${n ? choice('menu', 'keep', true, t('ob.menu.keep'), t('ob.menu.keepHint', { n })) : ''}
          ${choice('menu', 'sample', !n, t('ob.menu.sample'), t('ob.menu.sampleHint'), n ? '' : t('ob.recommended'))}
          ${choice('menu', 'own', false, t('ob.menu.own'), t('ob.menu.ownHint'))}
          ${choice('menu', 'none', false, t('ob.menu.none'), t('ob.menu.noneHint'))}
        </div>
        <div class="ob-own" id="ob-own" hidden>
          <div class="ob-prows" id="ob-prows">${[0, 1, 2].map(prow)}</div>
          <button type="button" class="btn quiet small" data-ob-act="add-row">${icon('plus')}<span>${t('ob.menu.addRow')}</span></button>
          <p class="field-error" data-err="menu"></p>
        </div>`;
    },

    receipt: (st) => {
      const s = state.settings;
      return html`${head(st)}
        <fieldset class="field"><legend class="label">${t('set.taxMode')}</legend>
          <div class="seg">${seg('taxMode', 'incl', s.taxMode, t('set.taxIncl'))}${seg('taxMode', 'excl', s.taxMode, t('set.taxExcl'))}</div></fieldset>
        <label class="field"><span class="label">${t('set.regNo')}</span>
          <input name="regNo" value="${s.regNo}" placeholder="T1234567890123" autocomplete="off" spellcheck="false">
          <small class="hint">${t('ob.receipt.regHint')}</small><small class="field-error" data-err="regNo"></small></label>
        <div class="ob-two">
          <label class="field"><span class="label">${t('set.storeAddr')}</span><input name="storeAddr" value="${s.storeAddr}" maxlength="80" autocomplete="off"></label>
          <label class="field"><span class="label">${t('set.storeTel')}</span><input name="storeTel" value="${s.storeTel}" maxlength="20" inputmode="tel" autocomplete="off"></label>
        </div>`;
    },

    brand: (st) => html`${head(st)}<div class="brand-grid">${brandFields(state.settings)}${brandPreview()}</div>`,

    pin: (st) => html`${head(st)}
      ${state.settings.pinHash
        ? html`<p class="ob-okline">${icon('check')}<span>${t('ob.pin.already')}</span></p>`
        : html`<div class="ob-two">
            <label class="field"><span class="label">${t('set.pinNew')}</span><input name="p1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password"></label>
            <label class="field"><span class="label">${t('set.pinAgain')}</span><input name="p2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password"></label>
          </div>
          <p class="field-error" data-err="pin"></p>
          <p class="ob-note warn">${t('ob.pin.skipNote')}</p>`}`,

    gasless: (st) => {
      const s = state.settings;
      const w = gasWallet();
      let body;
      if (!s.chains.includes(137)) body = html`<p class="ob-note">${t('ob.gasless.noPolygon')}</p>`;
      else if (!ownerVerified()) body = html`<p class="ob-note warn">${t('ob.gasless.needOwner')}</p>`;
      else if (!w) body = html`<button type="button" class="btn primary big" data-ob-act="gas-create">${icon('wallet')}<span>${t('ob.gasless.create')}</span></button>`;
      else {
        const b = cachedGasBalance();
        body = html`<div class="ob-gas">
          <div class="qr-frame">${raw(qrSvg(`ethereum:${w.address}@${gasChainId()}`, { ecl: 'M', title: t('gas.address') }))}</div>
          <div>
            <p class="ob-gas-label">${t('gas.address')}（${chainName(gasChainId())}）</p>
            <code class="ob-gas-addr">${w.address}</code>
            <p class="ob-gas-text">${t('ob.gasless.fund')}${isTestnet() ? html` ${t('ob.gasless.fundTest')}` : ''}</p>
            <p class="ob-gas-bal" id="ob-gas-bal" data-ok="${b != null && b >= MIN_GAS}">${b == null ? t('ob.gasless.checking') : t(b >= MIN_GAS ? 'ob.gasless.ready' : 'ob.gasless.balance', { b: formatUnits(b, 18, 4) })}</p>
            <button type="button" class="btn ghost small" data-ob-act="gas-check">${icon('refresh')}<span>${t('ob.gasless.check')}</span></button>
          </div></div>`;
      }
      return html`${head(st)}${body}`;
    },

    done: () => html`<div class="ob-done">
        <div class="ob-seal" aria-hidden="true"><svg viewBox="0 0 120 120"><circle class="ob-seal-ring" cx="60" cy="60" r="52"/><path class="ob-seal-check" d="M37 62l16 16 31-33"/></svg></div>
        <h1 class="ob-title">${t('ob.done.title')}</h1>
        <p class="ob-lead">${t(isTestnet() ? 'ob.done.leadTest' : 'ob.done.leadLive')}</p>
      </div>
      <ul class="ob-summary">${NUMBERED.map((s, i) => {
        const st = statusOf(s.id);
        return html`<li data-st="${st}" style="--i:${i}"><span class="ob-sdot">${st === 'done' ? icon('check') : ''}</span><span class="ob-sname">${t('ob.' + s.id + '.name')}</span><small>${t('ob.st.' + st)}</small></li>`;
      })}</ul>
      ${isTestnet() ? html`<div class="ob-tip"><p><b>${t('ob.done.nextTitle')}</b></p><p>${t('ob.done.nextTest')}</p>
        <a class="btn ghost small" href="${JPYC.faucet}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${t('ob.done.faucet')}</span></a></div>` : ''}
      <p class="ob-help"><a href="docs/reji-manual-ja.pdf" target="_blank" rel="noopener">${icon('receipt')}<span>${t('ob.done.manual')}</span></a><span>${t('ob.done.later')}</span></p>`,
  };

  const LEAVE = {
    welcome: () => true,
    store: () => {
      const name = String(field('storeName').value || '').trim().slice(0, 40);
      if (!errors(name ? {} : { storeName: t('err.required') })) return false;
      saveSettings({ ...state.settings, storeName: name });
      return true;
    },
    wallet: () => {
      if (!field('address')) return true; // owner-confirmed address in a re-run: changed only in Settings
      const s = state.settings;
      const a = cleanAddress(field('address').value);
      const st = addressStatus(a);
      if (!errors(st === 'ok' ? {} : { address: t('err.addr.' + st) })) return false;
      const addr = checksum(a);
      if (!sameAddress(addr, s.address) || addr !== s.address) {
        saveSettings({ ...s, address: addr, owner: s.owner && sameAddress(s.owner.address, addr) ? s.owner : null });
      }
      return true;
    },
    owner: () => ownerVerified(),
    network: () => {
      const net = card().querySelector('[name="network"]:checked')?.value === 'mainnet' ? 'mainnet' : 'testnet';
      const chains = all('[name="chains"]:checked').map((x) => Number(x.value)).filter((id) => MAINNET_IDS.includes(id));
      if (!errors(chains.length ? {} : { chains: t('err.chains') })) return false;
      const s = state.settings;
      saveSettings({ ...s, network: net, chains, defaultChain: chains.includes(s.defaultChain) ? s.defaultChain : chains[0] });
      return true;
    },
    menu: () => {
      const pick = card().querySelector('[name="menu"]:checked')?.value || 'sample';
      if (pick === 'own') {
        const rows = all('.ob-prow').map((r) => ({
          name: r.querySelector('[name="pn"]').value.trim(),
          price: Number(toHalfWidth(r.querySelector('[name="pp"]').value).replace(/[^\d]/g, '')),
          tax: Number(r.querySelector('[name="pt"]').value),
        })).filter((p) => p.name && p.price > 0);
        if (!errors(rows.length ? {} : { menu: t('ob.menu.needOne') })) return false;
        state.products = normalizeProducts(rows);
        saveProducts();
      } else if (pick === 'sample') {
        state.products = sampleProducts(getLang());
        saveProducts();
      }
      publishBrand(state.settings).catch(() => {}); // the store page's menu, if the store has a profile
      const regMode = pick === 'none' && !state.products.length ? 'keypad' : 'menu';
      if (state.settings.regMode !== regMode) saveSettings({ ...state.settings, regMode });
      return true;
    },
    receipt: () => {
      const reg = normalizeRegNo(field('regNo').value);
      if (!errors(reg === null ? { regNo: t('err.regNo') } : {})) return false;
      saveSettings({
        ...state.settings,
        taxMode: card().querySelector('[name="taxMode"]:checked')?.value === 'excl' ? 'excl' : 'incl',
        regNo: reg,
        storeAddr: field('storeAddr').value.trim().slice(0, 80),
        storeTel: field('storeTel').value.trim().slice(0, 20),
      });
      return true;
    },
    brand: () => {
      const b = readBrand(card());
      if (!errors(b.errors)) return false;
      saveSettings({ ...state.settings, logo: b.logo, brandColor: b.brandColor, storeLink: b.storeLink, links: [b.storeLink, ...state.settings.links.slice(1)].filter(Boolean) });
      publishBrand(state.settings, { force: true }).catch(() => {}); // customers' phones pick it up
      return true;
    },
    pin: () => {
      if (state.settings.pinHash) return true;
      const p1 = toHalfWidth(field('p1').value);
      const p2 = toHalfWidth(field('p2').value);
      if (!/^\d{4,8}$/.test(p1)) return errors({ pin: t('set.pinRule') });
      if (p1 !== p2) return errors({ pin: t('set.pinMismatch') });
      const salt = uid(16);
      saveSettings({ ...state.settings, pinSalt: salt, pinHash: hashPin(salt, p1) });
      markUnlocked();
      return true;
    },
    gasless: () => true,
  };

  function chrome() {
    const st = cur();
    const n = NUMBERED.indexOf(st);
    $('#ob-count', main).textContent = n >= 0 ? t('ob.step', { n: n + 1, total: NUMBERED.length }) : '';
    const pct = st.id === 'done' ? 100 : n < 0 ? 0 : Math.round((n / NUMBERED.length) * 100);
    $('#ob-bar', main).style.width = `${pct}%`;
    for (const li of $$('#ob-rail li', main)) {
      const id = li.dataset.id;
      li.dataset.state = id === st.id ? 'current' : ob.done[id] ? 'done' : ob.skipped[id] ? 'skipped' : 'todo';
    }
    $('.ob', main).dataset.step = rs.open ? 'restore' : st.id;
    $('[data-ob="later"]', main).hidden = st.id === 'done' || rs.open;
    $('#ob-actions', main).hidden = st.id === 'welcome' && !rs.open; // the two choices are the buttons there
    if (rs.open) {
      $('#ob-count', main).textContent = '';
      $('#ob-bar', main).style.width = '0%';
      $('#ob-actions', main).innerHTML = String(html`<button type="button" class="btn ghost" data-ob="restore-back">${icon('back')}<span>${t('ob.back')}</span></button>
        <span class="grow"></span>
        <button type="button" class="btn primary" data-ob="restore-go"${attr('disabled', !rs.b)}>${icon('check')}<span>${t('rs.go')}</span></button>`);
      return;
    }
    $('#ob-actions', main).innerHTML = String(st.id === 'welcome'
      ? ''
      : st.id === 'done'
        ? html`<span class="grow"></span><button type="button" class="btn primary big" data-ob="finish">${icon('register')}<span>${t('ob.open')}</span></button>`
        : html`<button type="button" class="btn ghost" data-ob="back"${attr('hidden', ob.rerun && ob.step <= 1)}>${icon('back')}<span>${t('ob.back')}</span></button>
          <span class="grow"></span>
          ${st.kind !== 'req' && !complete(st) ? html`<button type="button" class="btn quiet" data-ob="skip">${t(st.kind === 'rec' ? 'ob.skipRec' : 'ob.skip')}</button>` : ''}
          ${canNext(st) ? html`<button type="button" class="btn primary" data-ob="next"><span>${t('ob.next')}</span>${icon('back', 'flip')}</button>` : ''}`);
  }

  async function updateGas() {
    const el = $('#ob-gas-bal', main);
    if (!el) return;
    try {
      const b = await refreshGasBalance();
      if (!el.isConnected || b == null) return;
      el.dataset.ok = String(b >= MIN_GAS);
      el.textContent = t(b >= MIN_GAS ? 'ob.gasless.ready' : 'ob.gasless.balance', { b: formatUnits(b, 18, 4) });
    } catch {
      if (el.isConnected) el.textContent = t('ob.gasless.unknown');
    }
  }

  function after(st) {
    card().addEventListener('input', (e) => { // an error goes away as soon as the owner starts fixing it
      const f = e.target.closest('.field');
      if (!f?.classList.contains('has-error')) return;
      f.classList.remove('has-error');
      const er = f.querySelector('[data-err]');
      if (er) er.textContent = '';
    });
    if (st.id === 'wallet' && field('address')) {
      field('address').addEventListener('input', () => {
        const a = cleanAddress(field('address').value);
        $('#ob-addr', main).innerHTML = addressStatus(a) === 'ok' ? String(addrCard(checksum(a))) : '';
      });
    }
    if (st.id === 'menu') {
      card().addEventListener('change', (e) => {
        if (e.target.name === 'menu') $('#ob-own', main).hidden = e.target.value !== 'own';
      });
    }
    if (st.id === 'gasless' && gasWallet()) updateGas();
    if (st.id === 'brand') bindBrandFields(card(), { name: () => state.settings.storeName, msg: () => state.settings.footer });
  }

  function paint(dir = 1) {
    const st = cur();
    const c = card();
    c.className = `ob-card ${dir > 0 ? 'ob-in' : 'ob-in-back'}`;
    c.innerHTML = String(rs.open ? restoreView() : VIEWS[st.id](st));
    chrome();
    if (!rs.open) after(st);
    main.scrollTo?.({ top: 0 });
    const first = c.querySelector('input:not([type=radio]):not([type=checkbox])');
    if (first && matchMedia('(hover: hover) and (pointer: fine)').matches) first.focus({ preventScroll: true });
  }

  let busy = false;
  async function go(to, dir) {
    if (busy) return;
    busy = true;
    try {
      if (!reduced()) {
        card().className = `ob-card ${dir > 0 ? 'ob-out' : 'ob-out-back'}`;
        await wait(150);
      }
      ob.step = to;
      saveOb(ob);
      paint(dir);
    } finally {
      busy = false;
    }
  }

  main.onclick = async (e) => {
    const b = e.target.closest('[data-ob], [data-ob-act]');
    if (!b || busy) return;
    const act = b.dataset.ob || b.dataset.obAct;
    const st = cur();
    if (act === 'next') {
      b.disabled = true;
      const ok = await LEAVE[st.id]?.();
      b.disabled = false;
      if (!ok) return;
      ob.done[st.id] = true;
      delete ob.skipped[st.id];
      return go(ob.step + 1, 1);
    }
    if (act === 'skip' && st.kind !== 'req') {
      ob.skipped[st.id] = true;
      delete ob.done[st.id];
      return go(ob.step + 1, 1);
    }
    if (act === 'back') return go(Math.max(ob.rerun ? 1 : 0, ob.step - 1), -1);
    if (act === 'restore') {
      Object.assign(rs, { open: true, b: null, bad: false, mode: 'replace' });
      return paint(1);
    }
    if (act === 'restore-back') {
      rs.open = false;
      return paint(-1);
    }
    if (act === 'restore-go') {
      if (!rs.b) return;
      b.disabled = true;
      await applyBackup(rs.b, { mode: rs.mode });
      saveOb({ step: 0, done: {}, skipped: {}, finished: true });
      // A real reload. Changing only the #hash would re-run the guide with the old settings first,
      // and that would mark it unfinished again.
      location.replace(location.pathname + location.search);
      return;
    }
    if (act === 'finish') {
      ob.finished = true;
      saveOb(ob);
      return finish();
    }
    if (act === 'later') {
      if (ob.rerun) {
        ob.finished = true;
        saveOb(ob);
        return finish();
      }
      if (await confirmSkipAll()) {
        saveOb({ ...ob, finished: true, manual: true });
        manual();
      }
      return;
    }
    if (act === 'verify') {
      const rec = await verifyOwner(state.settings.address, state.settings.storeName);
      if (!rec) return;
      saveSettings({ ...state.settings, owner: rec });
      ob.done.owner = true;
      saveOb(ob);
      return paint(1);
    }
    if (act === 'from-wallet') {
      try {
        const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (a) {
          field('address').value = a;
          field('address').dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch { /* the owner closed the wallet prompt */ }
      return;
    }
    if (act === 'add-row') {
      const box = $('#ob-prows', main);
      if (box.children.length < 12) box.insertAdjacentHTML('beforeend', String(prow()));
      box.lastElementChild.querySelector('input')?.focus();
      return;
    }
    if (act === 'gas-create') {
      createGasWallet();
      return paint(1);
    }
    if (act === 'gas-check') updateGas();
  };
  main.onchange = async (e) => {
    if (e.target.matches('[data-ob-file]')) {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      rs.b = readBackup(await f.text());
      rs.bad = !rs.b;
      rs.mode = 'replace';
      paint(0);
    } else if (e.target.name === 'rsmode') rs.mode = e.target.value === 'second' ? 'second' : 'replace';
  };
  main.onkeydown = (e) => {
    if (e.key !== 'Enter' || e.isComposing || !e.target.matches('.ob-card input:not([type=radio]):not([type=checkbox])')) return;
    e.preventDefault();
    $('[data-ob="next"]', main)?.click();
  };

  paint(1);
}
