// The branding editor (logo, colour, link) with a live preview. Used by Settings
// and by the guided setup.
import { html, attr } from './util.js';
import { t } from './i18n.js';
import { icon } from './ui.js';
import { PRESETS, DEFAULT_COLOR, validLogo, validColor, safeColor, validLink, linkLabel, logoFromFile } from './brand.js';

export function brandFields(s, { link = true } = {}) {
  const color = validColor(s.brandColor);
  const preset = PRESETS.some(([c]) => c === color) ? color : color ? 'custom' : '';
  const logo = validLogo(s.logo);
  return html`<div class="brand-fields" data-brand-root>
    <div class="field">
      <span class="label">${t('brand.logo')}</span>
      <div class="logo-pick">
        <div class="logo-tile" data-logo-tile>${logo ? html`<img src="${logo}" alt="${t('brand.logoAlt')}">` : html`<span class="logo-empty">${icon('image')}</span>`}</div>
        <div class="logo-actions">
          <div class="btn-row">
            <label class="btn ghost small file-btn">${icon('image')}<span data-logo-pick-label>${t(logo ? 'brand.change' : 'brand.pick')}</span><input type="file" accept="image/*" data-logo-file data-nodirty></label>
            <button type="button" class="btn quiet small" data-logo-remove${attr('hidden', !logo)}>${t('brand.remove')}</button>
          </div>
          <small class="hint">${t('brand.logoHint')}</small>
          <small class="hint logo-note" data-logo-note></small>
          <small class="field-error" data-err="logo"></small>
        </div>
      </div>
      <input type="hidden" name="logo" value="${logo}">
    </div>
    <fieldset class="field">
      <legend class="label">${t('brand.color')}</legend>
      <div class="swatches">
        ${PRESETS.map(([c, n]) => html`<label class="swatch" title="${t('brand.c.' + n)}"><input type="radio" name="brandColor" value="${c}"${attr('checked', preset === c)}><span class="sw" style="--c:${c || DEFAULT_COLOR}"></span><span class="sr-only">${t('brand.c.' + n)}</span></label>`)}
        <label class="swatch custom" title="${t('brand.custom')}"><input type="radio" name="brandColor" value="custom"${attr('checked', preset === 'custom')}><span class="sw sw-custom" style="--c:${safeColor(color) || '#8A8F9C'}"></span><input type="color" class="color-pick" name="brandColorPick" value="${(color || DEFAULT_COLOR).toLowerCase()}" aria-label="${t('brand.custom')}" data-nodirty></label>
      </div>
      <small class="hint" data-color-note>${t('brand.colorHint')}</small>
    </fieldset>
    ${link ? html`<label class="field"><span class="label">${t('brand.link')}</span>
      <input name="storeLink" type="url" inputmode="url" value="${s.storeLink || ''}" placeholder="https://www.instagram.com/…" autocomplete="off" spellcheck="false" autocapitalize="off">
      <small class="hint">${t('brand.linkHint')}</small><small class="field-error" data-err="storeLink"></small></label>` : ''}
  </div>`;
}

export const brandPreview = () => html`<div class="brand-preview" data-brand-preview aria-hidden="true">
  <p class="bp-label">${t('brand.preview')}</p>
  <div class="bp-phone">
    <div class="bp-top"><span class="bp-logo" data-bp-logo></span><b data-bp-name></b></div>
    <div class="bp-bill"><small>${t('pay.billLabel')}</small><b>¥1,200</b></div>
  </div>
  <div class="bp-receipt">
    <span class="bp-logo bp-logo-lg" data-bp-logo></span>
    <b class="bp-store" data-bp-name></b>
    <small class="bp-msg" data-bp-msg></small>
    <span class="bp-link" data-bp-link></span>
  </div>
</div>`;

/** Reads the editor: { logo, brandColor, storeLink, errors }. */
export function readBrand(root) {
  const v = (sel) => root.querySelector(sel)?.value ?? '';
  const pick = root.querySelector('[name="brandColor"]:checked')?.value || '';
  const brandColor = pick === 'custom' ? safeColor(v('[name="brandColorPick"]')) : validColor(pick);
  const raw = String(v('[name="storeLink"]')).trim();
  const storeLink = validLink(raw);
  const errors = raw && !storeLink ? { storeLink: t('err.link') } : {};
  return { logo: validLogo(v('[name="logo"]')), brandColor, storeLink, errors };
}

/** Wires the editor; onChange runs after any change (to mark the form dirty). */
export function bindBrandFields(root, { onChange = () => {}, name = () => '', msg = () => '' } = {}) {
  const box = root.querySelector('[data-brand-root]');
  if (!box) return;
  const preview = root.querySelector('[data-brand-preview]');
  const update = () => {
    const { logo, brandColor, storeLink } = readBrand(root);
    const custom = root.querySelector('[name="brandColor"]:checked')?.value === 'custom';
    const picked = validColor(root.querySelector('[name="brandColorPick"]')?.value || '');
    const note = root.querySelector('[data-color-note]');
    if (note) note.textContent = t(custom && picked && picked !== brandColor ? 'brand.colorAdjusted' : 'brand.colorHint');
    const sw = root.querySelector('.sw-custom');
    if (sw && picked) sw.style.setProperty('--c', safeColor(picked));
    if (!preview) return;
    preview.style.setProperty('--bp', brandColor || DEFAULT_COLOR);
    for (const el of preview.querySelectorAll('[data-bp-logo]')) {
      el.innerHTML = logo ? String(html`<img src="${logo}" alt="">`) : '';
      el.hidden = !logo;
    }
    for (const el of preview.querySelectorAll('[data-bp-name]')) el.textContent = name() || t('brand.sampleName');
    const m = preview.querySelector('[data-bp-msg]');
    m.textContent = msg() || '';
    m.hidden = !msg();
    const l = preview.querySelector('[data-bp-link]');
    l.textContent = storeLink ? t('pay.storeLink', { label: linkLabel(storeLink) }) : '';
    l.hidden = !storeLink;
  };
  const setLogo = (data) => {
    root.querySelector('[name="logo"]').value = data;
    root.querySelector('[data-logo-tile]').innerHTML = data
      ? String(html`<img src="${data}" alt="${t('brand.logoAlt')}">`)
      : String(html`<span class="logo-empty">${icon('image')}</span>`);
    root.querySelector('[data-logo-remove]').hidden = !data;
    root.querySelector('[data-logo-pick-label]').textContent = t(data ? 'brand.change' : 'brand.pick');
  };
  box.addEventListener('change', async (e) => {
    const err = root.querySelector('[data-err="logo"]');
    if (e.target.matches('[data-logo-file]')) {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      err.textContent = '';
      try {
        const r = await logoFromFile(file);
        setLogo(r.data);
        const note = root.querySelector('[data-logo-note]');
        const kb = (((r.data.length - r.data.indexOf(',') - 1) * 0.75) / 1024).toFixed(1);
        if (note) note.textContent = t(r.format === 'avif' ? 'brand.savedAvif' : 'brand.savedOther', { kb, fmt: r.format.toUpperCase() });
      } catch (x) {
        err.textContent = t('err.logo.' + (['type', 'size', 'decode', 'big'].includes(x.message) ? x.message : 'decode'));
        return;
      }
    } else if (e.target.matches('.color-pick')) {
      const custom = root.querySelector('[name="brandColor"][value="custom"]');
      if (custom) custom.checked = true;
    }
    update();
    onChange();
  });
  box.addEventListener('input', (e) => {
    if (e.target.matches('.color-pick')) {
      const custom = root.querySelector('[name="brandColor"][value="custom"]');
      if (custom) custom.checked = true;
    }
    if (e.target.matches('.color-pick, [name="storeLink"]')) {
      if (e.target.name === 'storeLink') {
        const f = e.target.closest('.field');
        f?.classList.remove('has-error');
        const er = f?.querySelector('[data-err]');
        if (er) er.textContent = '';
      }
      update();
    }
  });
  box.addEventListener('click', (e) => {
    if (!e.target.closest('[data-logo-remove]')) return;
    setLogo('');
    const note = root.querySelector('[data-logo-note]');
    if (note) note.textContent = '';
    update();
    onChange();
  });
  update();
  return update;
}
