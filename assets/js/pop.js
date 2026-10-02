// The counter sign (店頭POP): logo, name, "JPYC払いOK" and a QR code to the store's
// page. Sized to fit a Japanese postcard (100 x 148 mm) for event tables and
// register sides. Printed from Settings → このお店の情報.
import { html, raw, forQr } from './util.js';
import { t } from './i18n.js';
import { qrSvg } from './qr.js';
import { chainName } from './config.js';
import { validLogo, safeColor, DEFAULT_COLOR, eventLine } from './brand.js';

export function popHtml(s, { pageUrl = '', free = false } = {}) {
  const logo = validLogo(s.logo);
  const ev = eventLine({ name: s.eventName, space: s.eventSpace });
  const chains = (s.chains || []).map(chainName).join('・');
  return html`<article class="pop" style="--pop:${safeColor(s.brandColor) || DEFAULT_COLOR}">
    ${logo ? html`<img class="pop-logo" src="${logo}" alt="">` : ''}
    <p class="pop-name">${s.storeName}</p>
    ${s.tagline ? html`<p class="pop-tag">${s.tagline}</p>` : ''}
    ${ev ? html`<p class="pop-event">${ev}</p>` : ''}
    <div class="pop-pay">
      <p class="pop-big">${t('pop.ok')}</p>
      <p class="pop-sub">${t(free ? 'pop.free' : 'pop.noFee')}</p>
      <p class="pop-how">${t('pop.how', { chains })}</p>
    </div>
    ${pageUrl ? html`<div class="pop-qr">${raw(qrSvg(forQr(pageUrl), { ecl: 'M', margin: 1 }))}<p>${t('pop.qr')}</p></div>` : ''}
    <p class="pop-foot">${t('pop.foot')}</p>
  </article>`;
}
