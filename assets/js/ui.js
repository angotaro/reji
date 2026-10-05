// Shared UI pieces: icons, modal dialogs, PIN gate, printing and the paid stamp.
import { html, raw, $, uid, esc } from './util.js';
import { keccakText } from './keccak.js';
import { t, getLang } from './i18n.js';

// ---- icons (24px stroke icons, drawn for this app) ----
const P = {
  register: '<path d="M4 20h16M6 20V9h12v11M9 9V5h6v4"/><path d="M9 13h2M13 13h2M9 16h2M13 16h2"/>',
  sales: '<path d="M6 3h12v18l-2-1.4L14 21l-2-1.4L10 21l-2-1.4L6 21z"/><path d="M9 8h6M9 11.5h6M9 15h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  back: '<path d="M20 12H6M11 6l-6 6 6 6"/>',
  backspace: '<path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/><path d="m12 9 6 6M18 9l-6 6"/>',
  qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  wallet: '<path d="M4 7a2 2 0 0 1 2-2h11v4"/><rect x="4" y="9" width="17" height="11" rx="2"/><circle cx="16.5" cy="14.5" r="1.2"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  store: '<path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3M10 20v-5h4v5"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  pochi: '<path d="M7.5 3h9A1.5 1.5 0 0 1 18 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3z"/><path d="M6 8.5l6 3.5 6-3.5"/><circle cx="12" cy="12" r="1.7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
export const icon = (name, cls = '') =>
  raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`);

// ---- paid stamp: a vermilion dater stamp (日付印) ----
export function stampSvg(ms = Date.now(), { label, bottom: text } = {}) {
  const d = new Date(ms);
  const date = `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
  const bottom = text || (getLang() === 'ja' ? '入金済' : 'PAID');
  const id = 'ink' + uid(6);
  const r = 54;
  const chord = (y) => Math.sqrt(r * r - (y - 60) ** 2);
  const band = (y) => `<line x1="${(60 - chord(y) + 1.5).toFixed(1)}" y1="${y}" x2="${(60 + chord(y) - 1.5).toFixed(1)}" y2="${y}"/>`;
  return raw(`<svg class="hanko" viewBox="0 0 120 120" role="img" aria-label="${esc(label || t('charge.paidStamp'))}">
    <defs><filter id="${id}" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feComponentTransfer in="n" result="speck"><feFuncA type="discrete" tableValues="1 1 1 1 1 1 0.35 1 1"/></feComponentTransfer>
      <feComposite in="d" in2="speck" operator="in"/>
    </filter></defs>
    <g filter="url(#${id})">
      <g fill="none" stroke="currentColor"><circle cx="60" cy="60" r="${r}" stroke-width="4.2"/><g stroke-width="2.4">${band(44)}${band(77)}</g></g>
      <g fill="currentColor" text-anchor="middle" font-family="'Hiragino Mincho ProN','Yu Mincho','YuMincho','BIZ UDPMincho','MS PMincho',serif" font-weight="800">
        <text x="60" y="37" font-size="19" letter-spacing="1.5">JPYC</text>
        <text x="60" y="68.5" font-size="20">${esc(date)}</text>
        <text x="60" y="101" font-size="${bottom.length > 3 ? 17 : 19}" letter-spacing="1">${esc(bottom)}</text>
      </g>
    </g>
  </svg>`);
}

// ---- modal ----
let current = null;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Opens a dialog. Returns { el, close(result), result: Promise }. */
export function modal(content, { label = '', size = '', onClose, dismissable = true } = {}) {
  current?.close(undefined);
  const root = $('#modal');
  const prev = document.activeElement;
  root.innerHTML = String(html`<div class="modal-backdrop" data-dismiss></div>
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${label}" tabindex="-1">${content}</div>`);
  root.hidden = false;
  document.body.classList.add('modal-open');
  const el = root.querySelector('.modal');
  let resolve;
  const result = new Promise((r) => { resolve = r; });
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable) { e.preventDefault(); api.close(undefined); }
    if (e.key === 'Tab') {
      const f = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  const onClick = (e) => {
    if ((e.target.closest('[data-dismiss]') && dismissable) || e.target.closest('[data-close]')) api.close(undefined);
  };
  const api = {
    el,
    result,
    close(value) {
      if (current !== api) return;
      current = null;
      document.removeEventListener('keydown', onKey, true);
      root.removeEventListener('click', onClick);
      root.hidden = true;
      root.innerHTML = '';
      document.body.classList.remove('modal-open');
      onClose?.(value);
      resolve(value);
      try { prev?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
    },
  };
  current = api;
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('click', onClick);
  requestAnimationFrame(() => (el.querySelector('[autofocus]') || el.querySelector(FOCUSABLE) || el).focus());
  return api;
}

export const closeModal = () => current?.close(undefined);
export const modalOpen = () => !!current;

export function confirmDialog({ title, body = '', ok = t('common.ok'), cancel = t('common.cancel'), danger = false }) {
  const m = modal(html`<h2 class="modal-title">${title}</h2>
    ${body ? html`<p class="modal-text">${body}</p>` : ''}
    <div class="modal-actions">
      <button type="button" class="btn ghost" data-close>${cancel}</button>
      <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-ok autofocus>${ok}</button>
    </div>`, { label: title, size: 'small' });
  m.el.querySelector('[data-ok]').addEventListener('click', () => m.close(true));
  return m.result.then((v) => v === true);
}

// ---- PIN gate: a light lock for settings and data tools on a shared device ----
let unlockedUntil = 0;
let failures = 0;
let lockedUntil = 0;
let lockStreak = 0;
export const hashPin = (salt, pin) => keccakText(`reji-pin:${salt}:${pin}`);
export const lockNow = () => { unlockedUntil = 0; };
export const markUnlocked = () => { unlockedUntil = Date.now() + 10 * 60 * 1000; };

export function requirePin(settings) {
  if (!settings.pinHash || Date.now() < unlockedUntil) return Promise.resolve(true);
  const m = modal(html`<form class="pin-form" novalidate>
      <h2 class="modal-title">${icon('lock')} ${t('pin.title')}</h2>
      <p class="modal-text">${t('pin.body')}</p>
      <input class="pin-input" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]*" maxlength="8" aria-label="${t('pin.title')}" autofocus>
      <p class="field-error" data-err role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-close>${t('common.cancel')}</button>
        <button type="submit" class="btn primary">${t('pin.unlock')}</button>
      </div>
    </form>`, { label: t('pin.title'), size: 'small' });
  const form = m.el.querySelector('form');
  const input = form.querySelector('input');
  const err = form.querySelector('[data-err]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (Date.now() < lockedUntil) {
      err.textContent = t('pin.wait', { s: Math.ceil((lockedUntil - Date.now()) / 1000) });
      return;
    }
    if (hashPin(settings.pinSalt, input.value) === settings.pinHash) {
      failures = 0;
      lockStreak = 0;
      markUnlocked();
      m.close(true);
    } else {
      failures++;
      if (failures >= 5) { lockStreak++; lockedUntil = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (lockStreak - 1)); failures = 0; }
      err.textContent = t('pin.wrong');
      input.value = '';
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
    }
  });
  return m.result.then((v) => v === true);
}

// ---- printing: content goes into #print-root, CSS prints only that ----
export function printHtml(content, { width = 58, kind = 'receipt' } = {}) {
  const root = $('#print-root');
  if (!root) return;
  root.innerHTML = String(content);
  root.style.setProperty('--print-w', typeof width === 'string' ? width : width === 80 ? '72mm' : '48mm');
  document.body.dataset.print = kind;
  const done = () => {
    delete document.body.dataset.print;
    root.innerHTML = '';
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 60);
}

/** Small chain badge. Testnets get a distinct style so test money never looks real. */
export const chainBadge = (name, testnet) => html`<span class="chain-badge${testnet ? ' test' : ''}">${name}</span>`;
