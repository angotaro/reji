// Reji register: boot, header, routing.
import { $, html, raw } from './util.js';
import { t, getLang, setLang } from './i18n.js';
import { chainName } from './config.js';
import { blockNumber } from './rpc.js';
import { state, activeChains, isTestnet, pruneUnpaid, on } from './state.js';
import { icon, requirePin, confirmDialog, modalOpen } from './ui.js';
import { renderRegister, registerKey } from './register.js';
import { renderSales } from './sales.js';
import { renderSettings, settingsDirty } from './settings.js';
import { renderOnboarding, needsOnboarding, reopenOnboarding, restartOnboarding, onboardState, endRerun } from './onboard.js';
import { validLogo, applyBrandColor, hasBrand, publishBrand } from './brand.js';
import { resumeCharge, trackConfirmations, chargeOpen, rerenderCharge } from './charge.js';
import { gasWallet, refreshGasBalance, ownerState } from './gas.js';
import { probe } from './rpc.js';

const gasTick = () => { if (state.settings.gasless && gasWallet()) refreshGasBalance().catch(() => {}); };

const top = $('#top');
const main = $('#main');
let view = '';
let health = { state: 'start', label: '' };

const MARK = raw(`<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <path d="M8 3.5h16v23l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" fill="#fff"/>
  <path d="M11.5 9.5h9M11.5 13.5h9M11.5 17.5h5" stroke="#9AA6C4" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="22.8" cy="22.8" r="5.7" fill="#22305A" stroke="#FF6A4D" stroke-width="1.8"/>
  <path d="M17.6 21.2h10.4M17.6 24.4h10.4" stroke="#FF6A4D" stroke-width="1.1"/>
</svg>`);

function renderHeader() {
  const s = state.settings;
  applyBrandColor(document.documentElement, s.brandColor);
  const ready = !!s.address && view !== 'setup';
  const tab = (href, v, ic, label) =>
    html`<a class="tab" href="${href}"${raw(view === v ? ' aria-current="page"' : '')}>${icon(ic)}<span>${label}</span></a>`;
  top.innerHTML = String(html`<div class="noren">
      <a class="brand" href="#/">${validLogo(s.logo) ? html`<img class="brand-logo" src="${s.logo}" alt="">` : MARK}<span class="brand-name">${s.storeName || 'Reji'}</span></a>
      ${ready ? html`<nav class="tabs" aria-label="${t('nav.label')}">
        ${tab('#/', 'register', 'register', t('nav.register'))}
        ${tab('#/sales', 'sales', 'sales', t('nav.sales'))}
        ${tab('#/settings', 'settings', 'settings', t('nav.settings'))}
      </nav>` : ''}
      <div class="top-tools">
        ${ready ? html`<span class="net" id="net" data-state="${health.state}" title="${health.label}"><span class="dot" aria-hidden="true"></span><span class="net-label">${health.label || chainName(activeChains()[0])}</span></span>` : ''}
        <button type="button" class="lang-btn" data-act="lang" lang="${getLang() === 'ja' ? 'en' : 'ja'}" aria-label="${t('nav.langLabel')}">${getLang() === 'ja' ? 'EN' : '日本語'}</button>
      </div>
    </div>
    ${ready && isTestnet() ? html`<p class="test-strip">${t('net.testStrip')}</p>` : ''}
    ${ready && !isTestnet() && ownerState() !== 'ok' ? html`<p class="owner-strip" data-st="${ownerState()}"><a href="#/settings">${t(ownerState() === 'invalid' ? 'owner.stripInvalid' : 'owner.stripNone')}</a></p>` : ''}`);
}

function renderView() {
  renderHeader();
  main.dataset.view = view;
  if (view === 'setup') renderOnboarding(main, { finish: afterSetup, manual: afterManual });
  else if (view === 'register') renderRegister(main);
  else if (view === 'sales') renderSales(main);
  else if (view === 'settings') renderSettings(main, refresh);
}

async function route() {
  const h = location.hash.replace(/^#\/?/, '');
  let next = h.startsWith('setup') ? 'setup' : h.startsWith('sales') ? 'sales' : h.startsWith('settings') ? 'settings' : 'register';
  const ob = onboardState();
  if (ob?.rerun && !ob.finished && view === 'setup' && next !== 'setup') endRerun(); // left a re-run via the address bar
  if (next === 'setup' && ob?.manual && !state.settings.address) restartOnboarding(); // back to the guide from manual setup
  if (needsOnboarding()) next = 'setup';
  else if (!state.settings.address) next = 'settings'; // manual setup chosen: nothing works without a wallet yet
  else if (next === 'setup' && view === 'setup') return;
  if (view === 'settings' && next !== 'settings' && settingsDirty()) {
    const leave = await confirmDialog({ title: t('set.leaveTitle'), body: t('set.leaveBody'), ok: t('set.leaveOk'), danger: true });
    if (!leave) {
      history.replaceState(null, '', '#/settings');
      return;
    }
  }
  if ((next === 'settings' || next === 'setup') && view !== next && !(await requirePin(state.settings))) {
    if (view && view !== 'setup') {
      history.replaceState(null, '', view === 'sales' ? '#/sales' : '#/');
      return;
    }
    history.replaceState(null, '', '#/');
    next = 'register';
  }
  if (next === 'setup' && !needsOnboarding()) reopenOnboarding();
  const changed = next !== view;
  view = next;
  renderView();
  if (changed && !/[?&]s=/.test(location.hash)) main.scrollTop = 0;
}

function afterManual() {
  history.replaceState(null, '', '#/settings');
  view = '';
  route();
}

function afterSetup() {
  history.replaceState(null, '', '#/');
  view = '';
  route();
  checkHealth();
}

function refresh() {
  const y = main.scrollTop;
  renderView();
  main.scrollTop = y;
  checkHealth();
  gasTick();
}

async function checkHealth() {
  if (!state.settings.address || document.hidden) return;
  const id = activeChains()[0];
  if (!navigator.onLine) health = { state: 'off', label: t('net.offline') };
  else {
    try {
      await blockNumber(id);
      health = { state: 'ok', label: chainName(id) };
    } catch {
      health = { state: 'bad', label: t('net.unreachable', { chain: chainName(id) }) };
    }
  }
  const el = $('#net');
  if (el) {
    el.dataset.state = health.state;
    el.title = health.label;
    el.querySelector('.net-label').textContent = health.label;
  }
}

top.addEventListener('click', (e) => {
  if (!e.target.closest('[data-act="lang"]')) return;
  setLang(getLang() === 'ja' ? 'en' : 'ja');
  health.label = '';
  renderView();
  if (chargeOpen()) rerenderCharge();
  checkHealth();
});

window.addEventListener('hashchange', route);
document.addEventListener('keydown', (e) => {
  if (!modalOpen() && !chargeOpen() && view === 'register') registerKey(e);
});
on('charge-closed', () => { if (view === 'register') renderRegister(main); });
on('external-change', () => { if (!chargeOpen() && view !== 'settings' && view !== 'setup') renderView(); });
window.addEventListener('online', checkHealth);
window.addEventListener('offline', checkHealth);

// ---- boot ----
pruneUnpaid();
if (state.pending && state.settings.address) history.replaceState(null, '', '#/');
route().then(() => { if (state.settings.address) resumeCharge(); });
checkHealth();
setInterval(checkHealth, 30_000);
gasTick();
setInterval(gasTick, 5 * 60_000);
// Warm up the node scores so the first charge already uses fast, healthy endpoints.
const warm = () => { if (state.settings.address && !document.hidden) activeChains().forEach((id) => probe(id)); };
setTimeout(warm, 1500);
setInterval(warm, 15 * 60_000);
const since = Date.now() - 24 * 3600 * 1000;
state.sales
  .filter((s) => !s.confirmed && s.flag !== 'failed' && (s.paidAt || 0) > since)
  .slice(0, 20)
  .forEach((s, i) => setTimeout(() => trackConfirmations(s), 800 + i * 500));

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Keep the store's public profile (logo, colour, link) fresh on the relays.
setTimeout(() => { if (hasBrand(state.settings)) publishBrand(state.settings).catch(() => {}); }, 4000);
