// Store owner confirmation. The owner signs a short text with the store's
// receiving wallet, either on this device (browser wallet) or on their phone
// (scan a QR; the signature comes back over Nostr). It proves the address is
// theirs and guards owner-only actions. Nothing goes to a server of ours.
import { html, raw, uid, b64urlEncode, shortAddr } from './util.js';
import { t } from './i18n.js';
import { checksum, sameAddress } from './evm.js';
import { discoverWallets, connect, isUserRejection } from './wallet.js';
import { recoverPersonal } from './secp256k1.js';
import { Pool, KIND, newChannel } from './nostr.js';
import { qrSvg } from './qr.js';
import { state } from './state.js';
import { modal, icon } from './ui.js';
import { ownerVerified } from './gas.js';
import { ownerMessage } from './ownermsg.js';

export const utf8Hex = (s) => '0x' + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');

/** Ask wallet `address` to sign for `action`. Resolves { message, signature } once valid, else null. */
export function ownerSign(action, address, { storeName, code } = {}) {
  const want = checksum(address);
  const message = ownerMessage(action, want, code || uid(10), storeName ?? state.settings.storeName);
  const channel = newChannel();
  const link = new URL('sign.html', location.href);
  link.hash = '';
  link.search = new URLSearchParams({ n: channel, a: want, m: b64urlEncode(new TextEncoder().encode(message)) }).toString();
  const pool = new Pool().connect();
  const m = modal(html`<div class="owner-sign" data-link="${link.href}">
      <h2 class="modal-title">${icon('lock')} ${t('owner.signTitle')}</h2>
      <p class="modal-text">${t('owner.body.' + action)}</p>
      <p class="owner-wallet">${t('owner.wallet')} <b title="${want}">${shortAddr(want)}</b></p>
      <button type="button" class="btn primary owner-local" data-o="local">${icon('wallet')}<span>${t('owner.local')}</span></button>
      <div class="owner-qr">
        <div class="qr-frame small">${raw(qrSvg(link.href, { ecl: 'L', title: t('owner.phone') }))}</div>
        <p class="hint">${t('owner.phone')}</p>
      </div>
      <p class="field-msg" data-msg role="status"></p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button></div>
    </div>`, { label: t('owner.signTitle') });
  const msgEl = m.el.querySelector('[data-msg]');
  const say = (text, kind = '') => {
    msgEl.textContent = text;
    msgEl.dataset.kind = kind;
  };
  let finished = false;
  let remoteTries = 0;
  const accept = (sig, remote = false) => {
    let ok = false;
    try { ok = sameAddress(recoverPersonal(message, sig), want); } catch { ok = false; }
    if (!ok) return remote ? undefined : say(t('owner.badSig'), 'error'); // forged remote replies are just ignored
    finished = true;
    m.close({ message, signature: sig });
  };
  pool.subscribe({ kinds: [KIND.ownerSign], '#t': ['reji-sign-' + channel] }, (ev) => {
    let body = null;
    try { body = JSON.parse(ev.content); } catch { return; }
    if (body?.signature && !finished && ++remoteTries <= 20) accept(body.signature, true);
  });
  m.el.querySelector('[data-o="local"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    say('');
    try {
      const wallets = await discoverWallets();
      if (!wallets.length) return say(t('owner.noWallet'), 'error');
      const account = checksum(await connect(wallets[0].provider));
      if (!sameAddress(account, want)) return say(t('owner.wrongWallet', { addr: shortAddr(account) }), 'error');
      accept(await wallets[0].provider.request({ method: 'personal_sign', params: [utf8Hex(message), account] }));
    } catch (err) {
      say(isUserRejection(err) ? t('pay.rejected') : t('owner.badSig'), 'error');
    } finally {
      btn.disabled = false;
    }
  });
  return m.result.then((v) => {
    pool.close();
    return v?.signature ? v : null;
  });
}

/** Confirm that `address` belongs to the owner. Returns the owner record, or null. */
export async function verifyOwner(address, storeName) {
  const r = await ownerSign('verify-owner', address, { storeName });
  return r ? { address: checksum(address), verifiedAt: Date.now(), message: r.message, signature: r.signature } : null;
}

/** Owner-only action: needs a fresh signature once an owner is confirmed. */
export function requireOwner(action) {
  if (!ownerVerified()) return Promise.resolve(true);
  return ownerSign(action, state.settings.owner.address).then(Boolean);
}
