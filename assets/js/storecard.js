// A store's public profile as a card: logo, name, a short tagline, who runs it,
// where it is today (an event booth) and where to follow it. Used on the store
// page, on the payment-complete screen and as the live preview in Settings.
import { html } from './util.js';
import { t } from './i18n.js';
import { icon } from './ui.js';
import { linkLabel, validLogo, eventLine } from './brand.js';

export function storeCard(p, { name = '', compact = false } = {}) {
  const title = name || p.name || '';
  const logo = validLogo(p.logo);
  const ev = eventLine(p.event);
  const links = (p.links || []).filter(Boolean);
  return html`<section class="store-card${compact ? ' compact' : ''}" style="${p.color ? `--sc:${p.color}` : ''}">
    <div class="sc-head">
      ${logo ? html`<img class="sc-logo" src="${logo}" alt="">` : html`<span class="sc-logo sc-mono" aria-hidden="true">${[...title][0] || '・'}</span>`}
      <div class="sc-id">
        <p class="sc-name">${title}</p>
        ${p.tagline ? html`<p class="sc-tag">${p.tagline}</p>` : ''}
        ${p.people ? html`<p class="sc-people">${icon('person')}<span>${p.people}</span></p>` : ''}
      </div>
    </div>
    ${ev ? html`<p class="sc-event">${icon('pin')}<span><b>${t('sc.event')}</b>${ev}</span></p>` : ''}
    ${!compact && p.about ? html`<p class="sc-about">${p.about}</p>` : ''}
    ${links.length ? html`<div class="sc-links">${links.map((l) => html`<a class="sc-link" href="${l}" target="_blank" rel="noopener noreferrer">${icon('link')}<span>${linkLabel(l)}</span></a>`)}</div>` : ''}
  </section>`;
}
