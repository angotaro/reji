// Settings, menu editor, PIN, backup/restore, custom nodes and the first-run setup.
import { html, raw, $, $$, uid, toast, download, store, attr, fmtInt, clamp, ymd, shortAddr, copyText, forQr } from './util.js';
import { t, getLang, setLang, fmtDateTime, fmtDay } from './i18n.js';
import { brandFields, brandPreview, readBrand, bindBrandFields } from './brandui.js';
import { hasBrand, publishBrand, brandSent, brandKeyForBackup, restoreBrandKey, brandPub, brandProfile, storePageUrl, ensureBrandKey, tipCode, tipOffer } from './brand.js';
import { storeCard } from './storecard.js';
import { validLink as validLinkOf } from './brand.js';
import { APP, CHAINS, JPYC, MAINNET_IDS, chainName, explorerToken, resolveChain } from './config.js';
import { addressStatus, checksum, formatUnits, sameAddress } from './evm.js';
import { qrSvg } from './qr.js';
import { rpcStatus, probe, testEndpoint, maskUrl } from './rpc.js';
import { PROVIDERS, candidates, isApiKey } from './providers.js';
import { verifyOwner, requireOwner, ownerSign } from './owner.js';
import { gasWallet, createGasWallet, refreshGasBalance, gaslessStatus, gasChainId, gasKeyHex, withdrawGas, ownerVerified, GAS_KEY_STORE, gaslessReady } from './gas.js';
import { blockNumber } from './rpc.js';
import { state, KEYS, saveSettings, saveProducts, normalizeProducts, normalizeSettings, sampleProducts, activeChains } from './state.js';
import { icon, modal, confirmDialog, hashPin, lockNow, markUnlocked, printHtml } from './ui.js';

const fmtWhen = fmtDateTime;
const SECTIONS = ['store', 'brand', 'info', 'receipt', 'register', 'gasless', 'menu', 'security', 'data', 'nodes', 'about'];
let dirty = false;
let refresh = () => {};
export const settingsDirty = () => dirty;

const radio = (name, value, current, label) =>
  html`<label class="seg-opt"><input type="radio" name="${name}" value="${value}"${attr('checked', String(current) === String(value))}><span>${label}</span></label>`;

export const toHalfWidth = (s) => String(s || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
export const cleanAddress = (v) => toHalfWidth(v).trim().replace(/^ethereum:/i, '').split(/[@?/\s]/)[0];

export function normalizeRegNo(v) {
  const s = toHalfWidth(v).replace(/[\s\-‐－ー]/g, '').toUpperCase();
  if (!s) return '';
  const withT = s.startsWith('T') ? s : 'T' + s;
  return /^T\d{13}$/.test(withT) ? withT : null;
}

function showErrors(form, errors) {
  for (const el of $$('[data-err]', form)) {
    const msg = errors[el.dataset.err] || '';
    el.textContent = msg;
    el.closest('.field')?.classList.toggle('has-error', !!msg);
  }
}

function usageKb() {
  let n = 0;
  try { for (const k of Object.values(KEYS)) n += (localStorage.getItem(k) || '').length; } catch { /* ignore */ }
  return Math.max(1, Math.round(n / 1024));
}

// ---------- sections ----------
const ownerBox = (s) => html`<div class="owner-box" id="owner-box" data-ok="${String(ownerVerified(s))}">
  ${ownerVerified(s)
    ? html`<p>${icon('check')}<span>${t('owner.verified', { addr: shortAddr(s.owner.address), date: fmtDay(s.owner.verifiedAt) })}</span></p>
      <button type="button" class="btn quiet small" data-act="owner-verify">${t('owner.reverify')}</button>`
    : html`<p>${icon('lock')}<span>${t('owner.notYet')} ${t('owner.why')}</span></p>
      <button type="button" class="btn primary small" data-act="owner-verify">${t('owner.verify')}</button>`}
</div>`;

const storeSec = (s) => html`<section class="set-sec" id="sec-store">
  <h2>${t('set.sec.store')}</h2>
  <div class="ob-reopen"${attr('data-manual', !s.address)}>
    <button type="button" class="btn ${s.address ? 'ghost' : 'primary'}" data-act="onboard">${icon('check')}<span>${t('ob.reopen')}</span></button>
    <small class="hint">${t(s.address ? 'ob.reopenHint' : 'ob.manualNotice')}</small>
  </div>
  <label class="field"><span class="label">${t('set.storeName')}</span>
    <input name="storeName" value="${s.storeName}" maxlength="40" required>
    <small class="field-error" data-err="storeName"></small></label>
  <label class="field"><span class="label">${t('set.address')}</span>
    <input name="address" class="addr-input" value="${s.address}" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="0x…" required>
    <small class="hint">${t('set.addressHint')}</small>
    <small class="field-error" data-err="address"></small></label>
  ${ownerBox(s)}
  <fieldset class="field"><legend class="label">${t('set.network')}</legend>
    <div class="seg">${radio('network', 'mainnet', s.network, t('net.mainnet'))}${radio('network', 'testnet', s.network, t('net.testnet'))}</div>
    <small class="hint">${t('set.networkHint')}</small></fieldset>
  <fieldset class="field"><legend class="label">${t('set.chains')}</legend>
    <div class="chain-grid">${MAINNET_IDS.map((id) => html`<div class="chain-opt">
      <label class="check"><input type="checkbox" name="chains" value="${id}"${attr('checked', s.chains.includes(id))}><span>${chainName(id)} <small class="chain-test">${t('set.testPair', { name: chainName(CHAINS[id].testPair) })}</small></span></label>
      <label class="radio-inline"><input type="radio" name="defaultChain" value="${id}"${attr('checked', s.defaultChain === id)}><span>${t('set.default')}</span></label>
    </div>`)}</div>
    <small class="hint">${t('set.chainsHint')}</small>
    <small class="field-error" data-err="chains"></small></fieldset>
</section>`;

const brandSync = (s) => {
  if (!hasBrand(s)) return '';
  const sent = brandSent();
  return sent ? t('brand.synced', { when: fmtWhen(sent.at) }) : t('brand.notSynced');
};
const brandSec = (s) => html`<section class="set-sec" id="sec-brand">
  <h2>${t('set.sec.brand')}</h2>
  <p class="sec-lead">${t('brand.lead')}</p>
  <div class="brand-grid">${brandFields(s, { link: false })}${brandPreview()}</div>
  <p class="hint">${t('brand.msgHint', { field: t('set.footer') })}</p>
  <p class="brand-sync" id="brand-sync">${brandSync(s)}</p>
</section>`;

const BACKUP_AT = 'reji:backupat:v1';
const backupText = () => { const at = store.get(BACKUP_AT, 0); return at ? fmtWhen(at) : t('info.backupNever'); };
const pageUrlOf = (s) => (hasBrand(s) && brandPub() ? storePageUrl(brandPub()) : '');
const infoSec = (s) => {
  const page = pageUrlOf(s);
  const pid = brandPub();
  const chain = resolveChain(s.defaultChain, s.network);
  const links = [...s.links, '', '', '', ''].slice(0, 4);
  return html`<section class="set-sec" id="sec-info">
  <h2>${t('set.sec.info')}</h2>
  <p class="sec-lead">${t('info.lead')}</p>
  <div class="info-grid">
    <div class="info-edit">
      <label class="field"><span class="label">${t('info.tagline')}</span><input name="tagline" value="${s.tagline}" maxlength="40" placeholder="${t('info.taglinePh')}"><small class="hint">${t('info.taglineHint')}</small></label>
      <label class="field"><span class="label">${t('info.people')}</span><input name="people" value="${s.people}" maxlength="40" placeholder="${t('info.peoplePh')}"><small class="hint">${t('info.peopleHint')}</small></label>
      <label class="field"><span class="label">${t('info.about')}</span><textarea name="about" rows="4" maxlength="300" placeholder="${t('info.aboutPh')}">${s.about}</textarea><small class="hint">${t('info.aboutHint')}</small></label>
      <fieldset class="field"><legend class="label">${t('info.links')}</legend>
        <div class="link-list">${links.map((v, i) => html`<input name="link${i + 1}" type="url" inputmode="url" value="${v}" placeholder="${['https://www.instagram.com/…', 'https://x.com/…', 'https://….booth.pm/', 'https://…'][i]}" autocomplete="off" spellcheck="false" autocapitalize="off" aria-label="${t('info.linkN', { n: i + 1 })}">`)}</div>
        <small class="hint">${t('info.linksHint')}</small><small class="field-error" data-err="links"></small></fieldset>
      <fieldset class="field"><legend class="label">${t('info.event')}</legend>
        <div class="field-row ev-row">
          <label class="field"><span class="label sub">${t('info.eventName')}</span><input name="eventName" value="${s.eventName}" maxlength="40" placeholder="${t('info.eventNamePh')}"></label>
          <label class="field"><span class="label sub">${t('info.eventSpace')}</span><input name="eventSpace" value="${s.eventSpace}" maxlength="20" placeholder="${t('info.eventSpacePh')}"></label>
        </div>
        <small class="hint">${t('info.eventHint')}</small></fieldset>
    </div>
    <div class="info-preview">
      <p class="bp-label">${t('info.preview')}</p>
      <div data-info-preview>${storeCard(brandProfile(s), { name: s.storeName })}</div>
    </div>
  </div>
  <div class="info-box">
    <h3>${t('info.shareTitle')}</h3>
    <p class="hint">${t('info.previewNote')}</p>
    ${page ? html`<div class="share-row">
      <div class="qr-frame small share-qr">${raw(qrSvg(forQr(page), { ecl: 'M', title: t('info.pageQr') }))}</div>
      <div class="share-actions">
        <div class="btn-row">
          <a class="btn ghost" href="${page}" target="_blank" rel="noopener">${icon('store')}<span>${t('info.open')}</span></a>
          <button type="button" class="btn ghost" data-act="info-copy">${icon('copy')}<span>${t('info.copy')}</span></button>
          ${navigator.share ? html`<button type="button" class="btn ghost" data-act="info-share">${icon('share')}<span>${t('info.share')}</span></button>` : ''}
          <button type="button" class="btn ghost" data-act="info-pop">${icon('print')}<span>${t('info.pop')}</span></button>
        </div>
        <small class="hint">${t('info.popHint')}</small>
      </div>
    </div>` : html`<p class="hint">${t('info.noPage')}</p>`}
  </div>
  <div class="info-box tip-box">
    <h3>${icon('pochi')}<span>${t('tips.title')}</span><small class="opt">${t('tips.optional')}</small></h3>
    <p class="hint">${t('tips.lead')}</p>
    ${!s.address ? html`<p class="hint">${t('tips.needAddr')}</p>`
      : tipOffer(s) ? html`<p class="tip-state">${icon('check')}<span>${t('tips.onState', { when: fmtWhen(s.tipAtt.at) })}</span></p>
        <button type="button" class="btn quiet" data-act="tips-off">${t('tips.off')}</button>`
      : s.tips ? html`<p class="notice warn">${t('tips.resign')}</p><button type="button" class="btn ghost" data-act="tips-on">${icon('lock')}<span>${t('tips.resignBtn')}</span></button>`
      : html`<button type="button" class="btn ghost" data-act="tips-on">${icon('lock')}<span>${t('tips.on')}</span></button>`}
    <small class="hint">${t('tips.notes')}</small>
  </div>
  <div class="info-box">
    <h3>${t('info.idsTitle')}</h3>
    <dl class="kv id-list">
      <div><dt>${t('info.addr')}</dt><dd>${s.address ? html`<code class="mono">${s.address}</code><span class="id-acts"><button type="button" class="btn quiet small" data-act="info-copy-addr">${icon('copy')}<span>${t('info.copyShort')}</span></button><a class="btn quiet small" href="${explorerToken(chain, s.address)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${t('info.addrRecord')}</span></a></span>` : '—'}</dd></div>
      <div><dt>${t('info.owner')}</dt><dd>${s.owner ? t('info.ownerYes', { when: fmtWhen(s.owner.verifiedAt) }) : t('info.ownerNo')}</dd></div>
      <div><dt>${t('info.pid')}</dt><dd>${pid ? html`<code class="mono">${pid.slice(0, 8)}…${pid.slice(-8)}</code><span class="id-acts"><button type="button" class="btn quiet small" data-act="info-copy-pid">${icon('copy')}<span>${t('info.copyShort')}</span></button></span>` : t('info.pidNone')}</dd></div>
      <div><dt>${t('info.terminal')}</dt><dd>${s.terminal || t('info.terminalNone')}</dd></div>
      <div><dt>${t('info.storage')}</dt><dd>${t('info.storageText', { host: location.host })}</dd></div>
      <div><dt>${t('info.backup')}</dt><dd><span id="info-backup">${backupText()}</span><span class="id-acts"><button type="button" class="btn quiet small" data-act="backup">${icon('download')}<span>${t('info.backupNow')}</span></button></span></dd></div>
      <div><dt>${t('info.app')}</dt><dd>Reji ${APP.version}</dd></div>
    </dl>
    <p class="hint">${t('info.idsHint')}</p>
  </div>
</section>`;
};

const receiptSec = (s) => html`<section class="set-sec" id="sec-receipt">
  <h2>${t('set.sec.receipt')}</h2>
  <fieldset class="field"><legend class="label">${t('set.taxMode')}</legend>
    <div class="seg">${radio('taxMode', 'incl', s.taxMode, t('set.taxIncl'))}${radio('taxMode', 'excl', s.taxMode, t('set.taxExcl'))}</div>
    <small class="hint">${t('set.taxModeHint')}</small></fieldset>
  <label class="field"><span class="label">${t('set.regNo')}</span>
    <input name="regNo" value="${s.regNo}" placeholder="T1234567890123" maxlength="24" autocomplete="off">
    <small class="hint">${t('set.regNoHint')}</small>
    <small class="field-error" data-err="regNo"></small></label>
  <div class="field-row">
    <label class="field"><span class="label">${t('set.storeAddr')}</span><input name="storeAddr" value="${s.storeAddr}" maxlength="100"></label>
    <label class="field"><span class="label">${t('set.storeTel')}</span><input name="storeTel" value="${s.storeTel}" maxlength="30" inputmode="tel"></label>
  </div>
  <label class="field"><span class="label">${t('set.footer')}</span><input name="footer" value="${s.footer}" maxlength="120" placeholder="${t('set.footerPh')}"></label>
  <div class="field-row">
    <label class="field"><span class="label">${t('set.terminal')}</span>
      <input name="terminal" value="${s.terminal}" maxlength="4" placeholder="A" autocomplete="off">
      <small class="hint">${t('set.terminalHint')}</small>
      <small class="field-error" data-err="terminal"></small></label>
    <fieldset class="field"><legend class="label">${t('set.receiptWidth')}</legend>
      <div class="seg">${radio('receiptWidth', '58', s.receiptWidth, '58 mm')}${radio('receiptWidth', '80', s.receiptWidth, '80 mm')}</div></fieldset>
  </div>
</section>`;

const registerSec = (s) => html`<section class="set-sec" id="sec-register">
  <h2>${t('set.sec.register')}</h2>
  <fieldset class="field"><legend class="label">${t('set.qrKind')}</legend>
    <div class="seg">${radio('qrKind', 'web', s.qrKind, t('charge.qrWeb'))}${radio('qrKind', 'wallet', s.qrKind, t('charge.qrWallet'))}</div>
    <small class="hint">${t('set.qrKindHint')}</small></fieldset>
  <label class="field narrow"><span class="label">${t('set.expiry')}</span>
    <input name="expiryMin" type="number" min="2" max="120" step="1" value="${s.expiryMin}" inputmode="numeric">
    <small class="hint">${t('set.expiryHint')}</small></label>
  <label class="check"><input type="checkbox" name="sound"${attr('checked', s.sound)}><span>${t('set.sound')}</span></label>
  <fieldset class="field"><legend class="label">${t('set.language')}</legend>
    <div class="seg">${radio('lang', 'ja', getLang(), '日本語')}${radio('lang', 'en', getLang(), 'English')}</div></fieldset>
</section>`;

const prodRow = (p = { id: 'p' + uid(8), name: '', price: '', tax: 10, cat: '' }) => html`<li class="prod-row" data-id="${p.id}">
  <input class="p-name" value="${p.name}" maxlength="40" placeholder="${t('set.pNamePh')}" aria-label="${t('set.pName')}">
  <input class="p-price" type="number" min="0" max="10000000" step="1" inputmode="numeric" value="${p.price}" placeholder="0" aria-label="${t('set.pPrice')}">
  <select class="p-tax" aria-label="${t('set.pTax')}">${[10, 8, 0].map((r) => html`<option value="${r}"${attr('selected', Number(p.tax) === r)}>${t('tax.r' + r)}</option>`)}</select>
  <input class="p-cat" value="${p.cat}" maxlength="20" list="cat-list" placeholder="${t('set.pCatPh')}" aria-label="${t('set.pCat')}">
  <span class="p-tools">
    <button type="button" class="icon-btn" data-act="p-up" aria-label="${t('set.pUp')}">${icon('up')}</button>
    <button type="button" class="icon-btn" data-act="p-down" aria-label="${t('set.pDown')}">${icon('down')}</button>
    <button type="button" class="icon-btn danger" data-act="p-del" aria-label="${t('set.pDel')}">${icon('trash')}</button>
  </span>
</li>`;

const menuSec = () => {
  const cats = [...new Set(state.products.map((p) => p.cat).filter(Boolean))];
  return html`<section class="set-sec" id="sec-menu">
    <h2>${t('set.sec.menu')}</h2>
    <p class="hint">${t('set.menuHint')}</p>
    <div class="prod-head" aria-hidden="true"><span>${t('set.pName')}</span><span>${t('set.pPrice')}</span><span>${t('set.pTax')}</span><span>${t('set.pCat')}</span><span></span></div>
    <ol class="prod-list" id="prod-list">${state.products.map(prodRow)}</ol>
    <datalist id="cat-list">${cats.map((c) => html`<option value="${c}">`)}</datalist>
    <p class="field-error" data-err="products"></p>
    <div class="prod-actions">
      <button type="button" class="btn ghost" data-act="p-add">${icon('plus')}<span>${t('set.pAdd')}</span></button>
      <button type="button" class="btn quiet" data-act="p-sample">${t('reg.loadSample')}</button>
    </div>
  </section>`;
};

const securitySec = (s) => html`<section class="set-sec" id="sec-security">
  <h2>${t('set.sec.security')}</h2>
  <p class="hint">${t('set.pinHint')}</p>
  <div class="btn-row">
    ${s.pinHash
      ? html`<button type="button" class="btn ghost" data-act="pin-set">${t('set.pinChange')}</button>
        <button type="button" class="btn ghost" data-act="pin-remove">${t('set.pinRemove')}</button>
        <button type="button" class="btn ghost" data-act="pin-lock">${icon('lock')}<span>${t('set.pinLock')}</span></button>`
      : html`<button type="button" class="btn ghost" data-act="pin-set">${icon('lock')}<span>${t('set.pinSet')}</span></button>`}
  </div>
  <p class="hint">${t('set.keyNote')}</p>
</section>`;

const dataSec = () => html`<section class="set-sec" id="sec-data">
  <h2>${t('set.sec.data')}</h2>
  <p class="hint">${t('set.dataHint', { sales: fmtInt(state.sales.length), products: fmtInt(state.products.length), kb: fmtInt(usageKb()) })}</p>
  <div class="btn-row">
    <button type="button" class="btn ghost" data-act="backup">${icon('download')}<span>${t('set.backup')}</span></button>
    <label class="btn ghost file-btn">${icon('upload')}<span>${t('set.restore')}</span><input type="file" accept="application/json,.json" data-act="restore" hidden></label>
    <button type="button" class="btn danger-ghost" data-act="erase">${icon('trash')}<span>${t('set.erase')}</span></button>
  </div>
</section>`;

// Connections: status of the node pool, and the owner's own endpoints (optional).
const rpcStatusHtml = () => html`${activeChains().map((id) => {
  const list = rpcStatus(id);
  const good = list.filter((e) => e.state === 'ok');
  const best = good.length ? Math.min(...good.map((e) => e.lat)) : 0;
  const st = good.length >= 2 ? 'ok' : good.length === 1 ? 'thin' : list.some((e) => e.state === 'idle') ? 'idle' : 'bad';
  return html`<details class="rpc-chain" data-st="${st}">
    <summary><span class="dot" aria-hidden="true"></span><b>${chainName(id)}</b><span class="rpc-sum">${t('rpc.sum.' + st, { n: good.length, total: list.length, ms: best })}</span></summary>
    <ul class="rpc-eps">${list.map((e) => html`<li data-st="${e.state}"><span class="dot" aria-hidden="true"></span><code>${maskUrl(e.url)}</code>${e.custom ? html`<em>${t('rpc.mine')}</em>` : ''}<small>${e.state === 'ok' ? `${e.lat} ms` : t('rpc.st.' + e.state, { s: Math.ceil(e.restFor / 1000) })}</small></li>`)}</ul>
  </details>`;
})}`;

const provNoteHtml = (p) => (p.tpl
  ? html`<a href="${p.site}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${t('rpc.prov.open', { name: p.name })}</span></a><span>${t('rpc.prov.key')}</span>`
  : html`<span>${t('rpc.prov.other')}</span>`);

const nodesSec = (s) => {
  const mine = Object.entries(s.rpc || {}).flatMap(([id, urls]) => urls.map((u) => [Number(id), u]));
  return html`<section class="set-sec" id="sec-nodes">
  <h2>${t('set.sec.nodes')}</h2>
  <p class="hint">${t('rpc.hint')}</p>
  <div class="rpc-status" id="rpc-status">${rpcStatusHtml()}</div>
  <div class="btn-row"><button type="button" class="btn ghost" data-act="rpc-probe">${icon('refresh')}<span>${t('rpc.probe')}</span></button></div>
  <details class="rpc-own" data-nodirty${attr('open', mine.length > 0)}>
    <summary>${t('rpc.ownTitle')}</summary>
    <p class="hint">${t('rpc.ownHint')}</p>
    <ol class="rpc-steps">
      <li><span>${t('rpc.step1')}</span>
        <div class="seg rpc-prov">${PROVIDERS.map((p, i) => html`<label class="seg-opt"><input type="radio" name="rpcProvider" value="${p.id}"${attr('checked', i === 0)}><span>${p.name || t('rpc.otherName')}</span></label>`)}</div></li>
      <li class="rpc-note" id="rpc-prov-note">${provNoteHtml(PROVIDERS[0])}</li>
      <li><span>${t('rpc.step3')}</span>
        <div class="rpc-add-row"><input name="rpcPaste" class="addr-input" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="${t('rpc.pastePh')}"><button type="button" class="btn primary" data-act="rpc-add">${t('rpc.add')}</button></div>
        <p class="field-msg" data-res="rpc-add" role="status"></p></li>
    </ol>
    ${mine.length ? html`<ul class="rpc-mine">${mine.map(([id, u]) => html`<li><b>${chainName(id)}</b><code>${maskUrl(u)}</code><button type="button" class="btn danger-ghost small" data-act="rpc-remove" data-id="${id}" data-url="${u}">${t('rpc.remove')}</button></li>`)}</ul>` : ''}
    <p class="hint">${t('rpc.keyTip')}</p>
  </details>
</section>`;
};

async function fillRpc() {
  await Promise.all(activeChains().map((id) => probe(id)));
  const box = $('#rpc-status');
  if (box) box.innerHTML = String(rpcStatusHtml());
}

async function addRpc(btn) {
  const input = $('[name="rpcPaste"]');
  const say = (text, kind = '') => {
    const res = $('[data-res="rpc-add"]');
    if (res) { res.textContent = text; res.dataset.kind = kind; }
  };
  const value = String(input?.value || '').trim();
  const provider = $('[name="rpcProvider"]:checked')?.value || 'other';
  let tries;
  if (/^https:\/\//i.test(value)) tries = [[0, value]];
  else if (provider !== 'other' && isApiKey(value)) tries = candidates(provider, value);
  else return say(t(provider === 'other' ? 'rpc.err.url' : 'rpc.err.input'), 'error');
  btn.disabled = true;
  say(t('rpc.testing'));
  const results = await Promise.all(tries.map(([expect, url]) => testEndpoint(url, expect || undefined).then((r) => ({ ...r, url }))));
  btn.disabled = false;
  const good = results.filter((r) => r.ok);
  if (!good.length) {
    const r = results.find((x) => x.reason !== 'chain') || results[0];
    return say(t('rpc.err.' + (r?.reason || 'unreachable'), { chain: r?.chainId ?? '' }), 'error');
  }
  const rpc = { ...(state.settings.rpc || {}) };
  for (const r of good) rpc[r.chainId] = [...new Set([r.url, ...(rpc[r.chainId] || [])])].slice(0, 3);
  saveSettings({ ...state.settings, rpc });
  rerenderSection('nodes');
  say(t('rpc.added', { chains: [...new Set(good.map((r) => chainName(r.chainId)))].join(t('common.sep')) }), 'ok');
  fillRpc();
}

const aboutSec = () => html`<section class="set-sec" id="sec-about">
  <h2>${t('set.sec.about')}</h2>
  <p>${t('about.what')}</p>
  <p>${t('about.how')}</p>
  <dl class="kv">
    <div><dt>${t('about.token')}</dt><dd><a href="${explorerToken(activeChains()[0])}" target="_blank" rel="noopener noreferrer" title="${JPYC.address}">${shortAddr(JPYC.address)}</a></dd></div>
    <div><dt>${t('about.version')}</dt><dd>${APP.name} ${APP.version} (MIT)</dd></div>
  </dl>
  <div class="btn-row">
    <a class="btn quiet" href="${JPYC.site}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${t('about.jpycSite')}</span></a>
    <a class="btn quiet" href="${JPYC.faucet}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${t('about.faucet')}</span></a>
    <a class="btn quiet" href="receipt.html" target="_blank" rel="noopener">${icon('receipt')}<span>${t('about.receipts')}</span></a>
    <a class="btn quiet" href="terms.html" target="_blank" rel="noopener">${icon('external')}<span>${t('about.terms')}</span></a>
    <a class="btn quiet" href="privacy.html" target="_blank" rel="noopener">${icon('external')}<span>${t('about.privacy')}</span></a>
  </div>
  <p class="hint">${t('about.disclaimer')}</p>
</section>`;

const gaslessSec = (s) => {
  const st = gaslessStatus();
  const w = gasWallet();
  const chain = chainName(gasChainId());
  return html`<section class="set-sec" id="sec-gasless">
    <h2>${t('set.sec.gasless')}</h2>
    <p class="hint">${t('set.gaslessHint')}</p>
    ${st === 'owner' ? html`<p class="notice warn">${t('gas.needOwner')}</p>
      <div class="btn-row"><button type="button" class="btn primary" data-act="owner-verify">${icon('lock')}<span>${t('owner.verify')}</span></button></div>` : ''}
    ${st !== 'owner' && !w ? html`<p class="hint">${t('gas.createHint')}</p>
      <div class="btn-row"><button type="button" class="btn primary" data-act="gas-create">${icon('plus')}<span>${t('gas.create')}</span></button></div>` : ''}
    ${w ? html`<div class="gas-wallet">
        <div class="qr-frame gas-qr">${raw(qrSvg(`ethereum:${w.address}@${gasChainId()}`, { ecl: 'M', title: t('gas.address') }))}</div>
        <div class="gas-info">
          <dl class="kv">
            <div><dt>${t('gas.address')}</dt><dd><code class="addr">${w.address}</code><button type="button" class="icon-btn" data-act="copy-gas" aria-label="${t('common.copy')}">${icon('copy')}</button></dd></div>
            <div><dt>${t('gas.balance', { chain })}</dt><dd id="gas-bal">…</dd></div>
          </dl>
          <p class="gas-status" id="gas-status" data-st="${st}">${t('gas.st.' + st, { min: '0.02' })}</p>
          <p class="hint">${t('gas.topup', { chain })}</p>
          <label class="check"><input type="checkbox" name="gasless"${attr('checked', s.gasless)}><span>${t('set.gasless')}</span></label>
          <div class="btn-row">
            <button type="button" class="btn ghost" data-act="gas-refresh">${icon('refresh')}<span>${t('gas.refresh')}</span></button>
            <button type="button" class="btn ghost" data-act="gas-withdraw">${icon('download')}<span>${t('gas.withdraw')}</span></button>
            <button type="button" class="btn quiet" data-act="gas-key">${icon('lock')}<span>${t('gas.showKey')}</span></button>
          </div>
          <p class="hint">${t('gas.keyNote')}</p>
        </div>
      </div>` : ''}
  </section>`;
};

async function fillGas() {
  const el = $('#gas-bal');
  if (!el) return;
  try {
    const v = await refreshGasBalance();
    el.textContent = v == null ? '—' : `${formatUnits(v, 18, 4)} POL`;
  } catch {
    el.textContent = t('gas.balanceError');
  }
  const st = $('#gas-status');
  if (st) {
    const s = gaslessStatus();
    st.dataset.st = s;
    st.textContent = t('gas.st.' + s, { min: '0.02' });
  }
}

// ---------- settings view ----------
export function renderSettings(main, onRefresh) {
  refresh = onRefresh || refresh;
  dirty = false;
  const s = state.settings;
  main.innerHTML = String(html`<form class="settings" id="settings-form" novalidate autocomplete="off">
    <nav class="set-nav" aria-label="${t('set.navLabel')}">
      ${SECTIONS.map((id) => html`<a href="#/settings?s=${id}" data-jump="${id}">${t('set.sec.' + id)}</a>`)}
    </nav>
    <div class="set-body">
      ${storeSec(s)}${brandSec(s)}${infoSec(s)}${receiptSec(s)}${registerSec(s)}${gaslessSec(s)}${menuSec()}${securitySec(s)}${dataSec()}${nodesSec(s)}${aboutSec()}
    </div>
    <div class="save-bar" id="save-bar" data-dirty="false">
      <span class="save-note">${t('set.unsaved')}</span>
      <button type="button" class="btn ghost" data-act="discard">${t('set.discard')}</button>
      <button type="submit" class="btn primary">${t('set.save')}</button>
    </div>
  </form>`);
  const form = $('#settings-form', main);
  form.addEventListener('input', (e) => { if (!e.target.matches('[data-act="restore"]') && !e.target.closest('[data-nodirty]')) markDirty(); });
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'rpcProvider') return;
    const p = PROVIDERS.find((x) => x.id === e.target.value) || PROVIDERS[0];
    const note = $('#rpc-prov-note');
    if (note) note.innerHTML = String(provNoteHtml(p));
    const inp = $('[name="rpcPaste"]');
    if (inp) inp.placeholder = t(p.tpl ? 'rpc.pastePh' : 'rpc.pastePhUrl');
  });
  form.addEventListener('change', (e) => {
    if (e.target.matches('[data-act="restore"]')) restore(e.target);
    else if (!e.target.closest('[data-nodirty]')) markDirty();
  });
  form.addEventListener('click', onClick);
  const updateInfo = () => {
    const box = form.querySelector('[data-info-preview]');
    if (!box) return;
    const { next } = readForm(form);
    box.innerHTML = String(storeCard(brandProfile(next), { name: next.storeName }));
  };
  const updateBrand = bindBrandFields(form, {
    onChange: () => { markDirty(); updateInfo(); },
    name: () => form.querySelector('[name="storeName"]')?.value.trim() || '',
    msg: () => form.querySelector('[name="footer"]')?.value.trim() || '',
  });
  const PROFILE = /^(storeName|footer|tagline|people|about|eventName|eventSpace|link[1-4]|brandColor|brandColorPick)$/;
  form.addEventListener('input', (e) => {
    if (['storeName', 'footer'].includes(e.target.name)) updateBrand?.();
    if (PROFILE.test(e.target.name || '')) updateInfo();
  });
  form.addEventListener('change', (e) => { if (PROFILE.test(e.target.name || '')) updateInfo(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save(form);
  });
  const m = /[?&]s=(\w+)/.exec(location.hash);
  if (m) requestAnimationFrame(() => $('#sec-' + m[1])?.scrollIntoView({ block: 'start' }));
  fillGas();
  fillRpc();
}

function markDirty() {
  dirty = true;
  const bar = $('#save-bar');
  if (bar) bar.dataset.dirty = 'true';
}

function readProducts(form, errors) {
  const out = [];
  for (const row of $$('.prod-row', form)) {
    const name = row.querySelector('.p-name').value.trim();
    const priceRaw = toHalfWidth(row.querySelector('.p-price').value).trim();
    row.classList.remove('invalid');
    if (!name && !priceRaw) continue;
    const price = Number(priceRaw);
    if (!name || !Number.isInteger(price) || price < 0 || price > 10_000_000) {
      row.classList.add('invalid');
      errors.products = t('err.products');
      continue;
    }
    out.push({ id: row.dataset.id, name: name.slice(0, 40), price, tax: Number(row.querySelector('.p-tax').value), cat: row.querySelector('.p-cat').value.trim().slice(0, 20) });
  }
  return out;
}

function readForm(form) {
  const fd = new FormData(form);
  const get = (k) => String(fd.get(k) ?? '').trim();
  const errors = {};
  const next = { ...state.settings };
  next.storeName = get('storeName').slice(0, 40);
  if (!next.storeName) errors.storeName = t('err.required');
  const addr = cleanAddress(get('address'));
  const st = addressStatus(addr);
  if (st !== 'ok') errors.address = t('err.addr.' + st);
  else next.address = checksum(addr);
  next.network = get('network') === 'testnet' ? 'testnet' : 'mainnet';
  next.chains = fd.getAll('chains').map(Number).filter((id) => MAINNET_IDS.includes(id));
  if (!next.chains.length) errors.chains = t('err.chains');
  const def = Number(get('defaultChain'));
  next.defaultChain = next.chains.includes(def) ? def : next.chains[0];
  next.taxMode = get('taxMode') === 'excl' ? 'excl' : 'incl';
  const reg = normalizeRegNo(get('regNo'));
  if (reg === null) errors.regNo = t('err.regNo');
  else next.regNo = reg;
  next.storeAddr = get('storeAddr').slice(0, 100);
  next.storeTel = get('storeTel').slice(0, 30);
  next.footer = get('footer').slice(0, 120);
  const brand = readBrand(form);
  next.logo = brand.logo;
  next.brandColor = brand.brandColor;
  if (form.querySelector('[name="link1"]')) {
    const raw = [1, 2, 3, 4].map((i) => get('link' + i));
    const ok = raw.map(validLinkOf);
    if (raw.some((v, i) => v && !ok[i])) errors.links = t('err.link');
    next.links = [...new Set(ok.filter(Boolean))].slice(0, 4);
    next.storeLink = next.links[0] || '';
  }
  for (const [k, n] of [['tagline', 40], ['people', 40], ['eventName', 40], ['eventSpace', 20]]) if (form.querySelector(`[name="${k}"]`)) next[k] = get(k).replace(/[\u0000-\u001f]/g, '').slice(0, n);
  if (form.querySelector('[name="about"]')) next.about = String(fd.get('about') ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 300);
  const term = toHalfWidth(get('terminal'));
  if (!/^[A-Za-z0-9]{0,4}$/.test(term)) errors.terminal = t('err.terminal');
  else next.terminal = term.toUpperCase();
  next.receiptWidth = get('receiptWidth') === '80' ? 80 : 58;
  next.qrKind = get('qrKind') === 'wallet' ? 'wallet' : 'web';
  next.expiryMin = clamp(parseInt(toHalfWidth(get('expiryMin')), 10) || 15, 2, 120);
  next.sound = fd.get('sound') === 'on';
  if (form.querySelector('[name="gasless"]')) next.gasless = fd.get('gasless') === 'on';
  const lang = get('lang') === 'en' ? 'en' : 'ja';
  const products = readProducts(form, errors);
  return { next, lang, products, errors };
}

async function save(form) {
  const { next, lang, products, errors } = readForm(form);
  showErrors(form, errors);
  if (Object.keys(errors).length) {
    toast(t('err.checkFields'), 'error');
    form.querySelector('.has-error, .prod-row.invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  let addressChanged = false;
  if (ownerVerified() && !sameAddress(next.address, state.settings.address)) {
    if (!(await requireOwner('change-address'))) return;
    next.owner = null;
    addressChanged = true;
  }
  const brandChanged = ['logo', 'brandColor', 'storeLink', 'footer', 'storeName', 'address', 'tagline', 'people', 'about', 'eventName', 'eventSpace'].some((k) => next[k] !== state.settings[k])
    || JSON.stringify(next.links) !== JSON.stringify(state.settings.links);
  saveSettings(next);
  if (hasBrand(next) && (brandChanged || !brandSent())) {
    publishBrand(next, { force: brandChanged }).then((r) => {
      const el = document.getElementById('brand-sync');
      if (el) el.textContent = r === 'failed' ? t('brand.notSynced') : brandSync(state.settings);
      if (r === 'failed') toast(t('brand.syncFailed'), 'warn');
    }).catch(() => {});
  }
  state.products = normalizeProducts(products);
  saveProducts();
  if (lang !== getLang()) setLang(lang);
  dirty = false;
  toast(addressChanged ? t('owner.newAddress') : t('set.saved'));
  refresh();
}

async function onClick(e) {
  const j = e.target.closest('[data-jump]');
  if (j) {
    e.preventDefault();
    $('#sec-' + j.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', '#/settings?s=' + j.dataset.jump);
    return;
  }
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const list = $('#prod-list');
  switch (b.dataset.act) {
    case 'p-add': {
      list.insertAdjacentHTML('beforeend', String(prodRow()));
      list.lastElementChild.querySelector('.p-name').focus();
      markDirty();
      break;
    }
    case 'p-up': {
      const row = b.closest('.prod-row');
      if (row.previousElementSibling) row.previousElementSibling.before(row);
      b.focus();
      markDirty();
      break;
    }
    case 'p-down': {
      const row = b.closest('.prod-row');
      if (row.nextElementSibling) row.nextElementSibling.after(row);
      b.focus();
      markDirty();
      break;
    }
    case 'p-del':
      b.closest('.prod-row').remove();
      markDirty();
      break;
    case 'p-sample':
      if (!$$('.prod-row', list).length || (await confirmDialog({ title: t('set.sampleTitle'), body: t('set.sampleBody'), ok: t('set.sampleOk') }))) {
        list.innerHTML = String(html`${sampleProducts(getLang()).map(prodRow)}`);
        markDirty();
      }
      break;
    case 'pin-set':
      setPin();
      break;
    case 'pin-remove':
      if (await confirmDialog({ title: t('set.pinRemoveTitle'), body: t('set.pinRemoveBody'), ok: t('set.pinRemove'), danger: true })) {
        saveSettings({ ...state.settings, pinHash: '', pinSalt: '' });
        toast(t('set.pinRemoved'));
        rerenderSection('security');
      }
      break;
    case 'pin-lock':
      lockNow();
      toast(t('set.locked'));
      location.hash = '#/';
      break;
    case 'backup':
      backup();
      break;
    case 'info-copy':
    case 'info-copy-addr':
    case 'info-copy-pid': {
      const v = { 'info-copy': pageUrlOf(state.settings), 'info-copy-addr': state.settings.address, 'info-copy-pid': brandPub() }[b.dataset.act];
      const ok = !!v && (await copyText(v));
      toast(ok ? t('common.copied') : t('common.copyFailed'), ok ? 'info' : 'error');
      break;
    }
    case 'tips-on': {
      if (dirty) { toast(t('info.saveFirstShort'), 'warn'); break; }
      const s = state.settings;
      if (!s.address) break;
      const key = await ensureBrandKey();
      const r = await ownerSign('accept-tips', s.address, { code: tipCode(key.pub) });
      if (!r) break;
      saveSettings({ ...state.settings, tips: true, tipAtt: { wallet: s.address, code: tipCode(key.pub), message: r.message, signature: r.signature, at: Date.now() } });
      publishBrand(state.settings, { force: true }).catch(() => {});
      toast(t('tips.onToast'));
      rerenderSection('info');
      break;
    }
    case 'tips-off':
      if (!(await confirmDialog({ title: t('tips.offTitle'), body: t('tips.offBody'), ok: t('tips.off') }))) break;
      saveSettings({ ...state.settings, tips: false, tipAtt: null });
      publishBrand(state.settings, { force: true }).catch(() => {});
      toast(t('tips.offToast'));
      rerenderSection('info');
      break;
    case 'info-share':
      try { await navigator.share({ title: state.settings.storeName, text: state.settings.tagline || t('sp.shareText', { name: state.settings.storeName }), url: pageUrlOf(state.settings) }); } catch { /* closed */ }
      break;
    case 'info-pop': {
      if (dirty) { toast(t('info.saveFirst'), 'warn'); break; }
      const { popHtml } = await import('./pop.js');
      const s = state.settings;
      printHtml(popHtml(s, { pageUrl: pageUrlOf(s), free: s.gasless && gaslessReady(activeChains()) }), { width: '96mm', kind: 'pop' });
      break;
    }
    case 'erase':
      if (await confirmDialog({ title: t('set.eraseTitle'), body: t('set.eraseBody'), ok: t('set.eraseOk'), danger: true })) {
        Object.values(KEYS).forEach((k) => store.del(k));
        store.del(GAS_KEY_STORE);
        location.hash = '#/';
        location.reload();
      }
      break;
    case 'owner-verify': {
      if (dirty) {
        toast(t('owner.saveFirst'), 'error');
        break;
      }
      const rec = await verifyOwner(state.settings.address);
      if (rec) {
        saveSettings({ ...state.settings, owner: rec });
        toast(t('owner.done'));
        refresh();
      }
      break;
    }
    case 'gas-create':
      createGasWallet();
      rerenderSection('gasless');
      break;
    case 'gas-refresh':
      fillGas();
      break;
    case 'copy-gas': {
      const ok = await copyText(gasWallet()?.address || '');
      toast(ok ? t('common.copied') : t('common.copyFailed'), ok ? 'info' : 'error');
      break;
    }
    case 'gas-withdraw': {
      if (!(await requireOwner('withdraw-gas'))) break;
      b.disabled = true;
      try {
        await withdrawGas(state.settings.owner?.address || state.settings.address);
        toast(t('gas.withdrawn'));
      } catch (e) {
        toast(e.code === 'relayer-empty' ? t('gas.nothing') : t('gas.failed', { err: e.code || e.message }), 'error');
      } finally {
        b.disabled = false;
        fillGas();
      }
      break;
    }
    case 'gas-key': {
      if (!(await requireOwner('show-gas-key'))) break;
      const key = gasKeyHex();
      const km = modal(html`<h2 class="modal-title">${icon('lock')} ${t('gas.keyTitle')}</h2>
        <p class="notice warn">${t('gas.keyWarn')}</p>
        <p><code class="addr key">${key}</code></p>
        <div class="modal-actions"><button type="button" class="btn ghost" data-copy>${icon('copy')}<span>${t('common.copy')}</span></button><button type="button" class="btn primary" data-close>${t('common.close')}</button></div>`, { label: t('gas.keyTitle') });
      km.el.querySelector('[data-copy]').addEventListener('click', async () => toast((await copyText(key)) ? t('common.copied') : t('common.copyFailed')));
      break;
    }
    case 'onboard':
      location.hash = '#/setup';
      break;
    case 'rpc-probe':
      b.disabled = true;
      await fillRpc();
      b.disabled = false;
      break;
    case 'rpc-add':
      await addRpc(b);
      break;
    case 'rpc-remove': {
      const id = Number(b.dataset.id);
      const rpc = { ...(state.settings.rpc || {}) };
      rpc[id] = (rpc[id] || []).filter((u) => u !== b.dataset.url);
      if (!rpc[id].length) delete rpc[id];
      saveSettings({ ...state.settings, rpc });
      rerenderSection('nodes');
      break;
    }
    case 'discard':
      dirty = false;
      refresh();
      break;
    default:
  }
}

function rerenderSection(id) {
  const el = $('#sec-' + id);
  if (el && id === 'security') el.outerHTML = String(securitySec(state.settings));
  if (el && id === 'nodes') el.outerHTML = String(nodesSec(state.settings));
  if (el && id === 'info') el.outerHTML = String(infoSec(state.settings));
  if (el && id === 'gasless') {
    el.outerHTML = String(gaslessSec(state.settings));
    fillGas();
  }
}

function setPin() {
  const m = modal(html`<form class="pin-form" novalidate>
    <h2 class="modal-title">${icon('lock')} ${t('set.pinSetTitle')}</h2>
    <p class="modal-text">${t('set.pinSetBody')}</p>
    <label class="field"><span class="label">${t('set.pinNew')}</span><input name="p1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password" autofocus></label>
    <label class="field"><span class="label">${t('set.pinAgain')}</span><input name="p2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password"></label>
    <p class="field-error" data-e role="alert"></p>
    <div class="modal-actions">
      <button type="button" class="btn ghost" data-close>${t('common.cancel')}</button>
      <button type="submit" class="btn primary">${t('set.pinSave')}</button>
    </div>
  </form>`, { label: t('set.pinSetTitle'), size: 'small' });
  const f = m.el.querySelector('form');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const p1 = toHalfWidth(f.elements.namedItem('p1').value);
    const p2 = toHalfWidth(f.elements.namedItem('p2').value);
    const err = f.querySelector('[data-e]');
    if (!/^\d{4,8}$/.test(p1)) { err.textContent = t('set.pinRule'); return; }
    if (p1 !== p2) { err.textContent = t('set.pinMismatch'); return; }
    const salt = uid(16);
    saveSettings({ ...state.settings, pinSalt: salt, pinHash: hashPin(salt, p1) });
    markUnlocked();
    m.close();
    toast(t('set.pinSaved'));
    rerenderSection('security');
  });
}

function backup() {
  const data = {
    app: 'reji',
    format: 1,
    version: APP.version,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    products: state.products,
    sales: state.sales,
    unpaid: state.unpaid,
    counter: store.get(KEYS.counter, null),
    brandKey: brandKeyForBackup(), // the store's public profile ID (logo etc.); not a money key
  };
  download(`reji-backup-${ymd()}.json`, JSON.stringify(data, null, 1), 'application/json');
  store.set(BACKUP_AT, Date.now());
  const when = document.getElementById('info-backup');
  if (when) when.textContent = backupText();
  toast(t('set.backupDone'));
}

const validSale = (s) => s && typeof s === 'object' && typeof s.id === 'string' && Number.isInteger(s.amountYen)
  && CHAINS[s.chainId] && Array.isArray(s.items) && /^\d*$/.test(String(s.valueWei ?? ''));

async function restore(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { data = null; }
  if (!data || data.app !== 'reji' || !data.settings || typeof data.settings !== 'object') {
    toast(t('err.backupRead'), 'error');
    return;
  }
  const when = Date.parse(data.exportedAt) ? fmtDateTime(Date.parse(data.exportedAt)) : '?';
  const sales = Array.isArray(data.sales) ? data.sales.filter(validSale) : [];
  const ok = await confirmDialog({ title: t('set.restoreTitle'), body: t('set.restoreBody', { when, n: fmtInt(sales.length) }), ok: t('set.restoreOk'), danger: true });
  if (!ok) return;
  store.set(KEYS.settings, normalizeSettings(data.settings));
  store.set(KEYS.products, normalizeProducts(data.products));
  store.set(KEYS.sales, sales);
  store.set(KEYS.unpaid, Array.isArray(data.unpaid) ? data.unpaid.filter((u) => u && Array.isArray(u.chains) && Number.isInteger(u.amountYen)) : []);
  if (data.counter && typeof data.counter === 'object') store.set(KEYS.counter, data.counter);
  if (data.brandKey) await restoreBrandKey(data.brandKey);
  store.del(KEYS.pending);
  store.del(KEYS.cart);
  location.hash = '#/';
  location.reload();
}


// ---------- first run ----------
