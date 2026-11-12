// The 恩送り board: stores that welcome support right now, read straight from the public relays.
// No server and no approval: every listing is checked here (the store's key, and its wallet's signature).
import { html, $ } from './util.js';
import { t, fmtDay } from './i18n.js';
import { fetchOkuriBoard, storePageUrl, validLogo } from './brand.js';

const test = new URLSearchParams(location.search).get('test') === '1';
const root = $('#board');

const card = ({ pub, b }) => html`<li class="ok-card" data-cat="${b.okuri.cat}">
  <div class="ok-head">${validLogo(b.logo) ? html`<img class="ok-logo" src="${b.logo}" alt="" width="44" height="44">` : html`<span class="ok-logo ok-nologo" aria-hidden="true"></span>`}
    <div><p class="ok-name">${b.name || t('okuri.noName')}</p>${b.tagline ? html`<p class="ok-tagline">${b.tagline}</p>` : ''}</div></div>
  <p class="okuri-tags"><span class="okuri-cat" data-cat="${b.okuri.cat}">${t(b.okuri.cat === 'disaster' ? 'okuri.catDisaster' : 'okuri.catOther')}</span>${b.okuri.area ? html`<span class="okuri-area">${b.okuri.area}</span>` : ''}<span class="okuri-until">${t('okuri.until', { date: fmtDay(b.okuri.until) })}</span></p>
  ${b.okuri.msg ? html`<p class="okuri-msg">${b.okuri.msg}</p>` : ''}
  <a class="btn primary" href="${storePageUrl(pub)}">${t('okuri.view')}</a>
</li>`;

async function load() {
  const list = await fetchOkuriBoard({ test }).catch(() => null);
  root.innerHTML = String(html`${test ? html`<p class="lg-warn">${t('okuri.testBanner')}</p>` : ''}
    ${list == null ? html`<p class="lg-note">${t('okuri.failed')}</p><button type="button" class="btn ghost" id="ok-retry">${t('okuri.retry')}</button>`
      : list.length ? html`<ul class="ok-list">${list.map(card)}</ul>`
      : html`<p class="ok-empty">${t('okuri.empty')}</p>`}`);
  root.dataset.count = String(list ? list.length : -1);
  $('#ok-retry')?.addEventListener('click', load);
}
load();
