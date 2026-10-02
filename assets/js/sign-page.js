// Owner's phone: sign the register's confirmation request with the store wallet
// and send the signature back to the register over Nostr.
import { html, $, b64urlDecode, shortAddr, attr, copyText, toast } from './util.js';
import { t, getLang, setLang } from './i18n.js';
import { checksum, isAddress, sameAddress } from './evm.js';
import { discoverWallets, connect, walletDeepLinks, isUserRejection, pageLinkForWallet, watchDeepLinks } from './wallet.js';
import { recoverPersonal, randomPrivateKey } from './secp256k1.js';
import { Pool, makeEvent, KIND } from './nostr.js';
import { icon } from './ui.js';
import { utf8Hex } from './owner.js';
import { parseOwnerMessage } from './ownermsg.js';

const app = $('#sign');
const q = new URLSearchParams(location.search);
const channel = /^[0-9a-f]{32}$/.test(q.get('n') || '') ? q.get('n') : '';
const want = isAddress(q.get('a') || '') ? checksum(q.get('a')) : '';
let message = '';
try { message = new TextDecoder().decode(b64urlDecode(q.get('m') || '')); } catch { message = ''; }
const parsed = parseOwnerMessage(message);
const valid = !!(channel && want && parsed && sameAddress(parsed.wallet, want));
const S = { phase: valid ? 'loading' : 'invalid', wallets: [], error: '', sig: '' };
const pool = valid ? new Pool().connect() : null;

const working = (text) => html`<p class="working"><span class="spinner" aria-hidden="true"></span>${text}</p>`;

function panel() {
  switch (S.phase) {
    case 'invalid': return html`<div class="notice error"><p>${t('sign.invalid')}</p></div>`;
    case 'loading': return working(t('pay.looking'));
    case 'ready':
      return html`<p class="panel-text">${t('sign.wallet', { addr: shortAddr(want) })}</p>
        ${S.error ? html`<p class="notice error">${S.error}</p>` : ''}
        ${S.wallets.length
          ? html`<div class="wallet-list">${S.wallets.map((w, i) => html`<button type="button" class="btn wallet-btn" data-act="pick" data-i="${i}">${w.icon ? html`<img src="${w.icon}" alt="" width="28" height="28">` : icon('wallet')}<span>${t('sign.with', { name: w.name })}</span></button>`)}</div>`
          : html`<h2 class="panel-title">${t('pay.openIn')}</h2><p class="panel-text">${t('pay.openInText')}</p>
            <div class="deep-links">${walletDeepLinks().map((l) => html`<a class="btn wallet-btn" data-deep="${l.id}" href="${l.href}" rel="noopener noreferrer">${icon('wallet')}<span>${l.name}</span></a>`)}</div>
            ${S.openFailed ? html`<p class="notice warn open-failed" role="status">${t('pay.openFailed', { name: walletDeepLinks().find((l) => l.id === S.openFailed)?.name || '' })}</p>` : ''}
            <details class="other-ways"${attr('open', !!S.openFailed)}><summary>${t('pay.otherWays')}</summary>
              <ol class="ways"><li><span>${t('pay.wayCopy')}</span><button type="button" class="btn ghost" data-act="copy-page">${icon('copy')}<span>${t('pay.copyPage')}</span></button></li></ol>
            </details>`}`;
    case 'signing': return working(t('sign.signing'));
    case 'sending': return working(t('sign.sending'));
    case 'done': return html`<h2 class="panel-title done-title">${icon('check')}<span>${t('sign.done')}</span></h2><p class="panel-text">${t('sign.doneText')}</p>`;
    case 'failed': return html`<div class="notice error"><p>${t('sign.failed')}</p></div><button type="button" class="btn primary" data-act="resend">${t('sign.retry')}</button>`;
    default: return '';
  }
}

function render() {
  document.title = t('sign.title');
  app.innerHTML = String(html`<header class="noren pay-top">
      <span class="brand-name">${t('sign.title')}</span>
      <button type="button" class="lang-btn" data-act="lang" lang="${getLang() === 'ja' ? 'en' : 'ja'}">${getLang() === 'ja' ? 'EN' : '日本語'}</button>
    </header>
    <main class="pay-main">
      ${valid ? html`<div class="bill sign-paper"><p class="bill-label">${t('sign.lead')}</p><pre class="sign-msg">${message}</pre></div>` : ''}
      <section class="pay-panel" aria-live="polite">${panel()}</section>
    </main>`);
}

async function send() {
  S.phase = 'sending';
  render();
  const ev = await makeEvent(randomPrivateKey(), KIND.ownerSign, [['t', 'reji-sign-' + channel]], JSON.stringify({ signature: S.sig }));
  S.phase = (await pool.publish(ev, 10000)) ? 'done' : 'failed';
  render();
}

async function pick(w) {
  S.phase = 'signing';
  S.error = '';
  render();
  try {
    const account = checksum(await connect(w.provider));
    if (!sameAddress(account, want)) throw Object.assign(new Error('wrong'), { wrong: account });
    const sig = await w.provider.request({ method: 'personal_sign', params: [utf8Hex(message), account] });
    if (!sameAddress(recoverPersonal(message, sig), want)) throw new Error('bad');
    S.sig = sig;
    await send();
  } catch (e) {
    S.phase = 'ready';
    S.error = e.wrong ? t('sign.wrong', { addr: shortAddr(e.wrong) }) : isUserRejection(e) ? t('pay.rejected') : t('owner.badSig');
    render();
  }
}

app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  if (b.dataset.act === 'lang') {
    setLang(getLang() === 'ja' ? 'en' : 'ja');
    render();
  } else if (b.dataset.act === 'pick') pick(S.wallets[Number(b.dataset.i)]);
  else if (b.dataset.act === 'copy-page') copyText(pageLinkForWallet()).then((ok) => toast(ok ? t('pay.pageCopied') : t('common.copyFailed'), ok ? 'info' : 'error'));
  else if (b.dataset.act === 'resend') send();
});

watchDeepLinks(app, (id) => { S.openFailed = id; render(); });
render();
if (valid) {
  discoverWallets().then((ws) => {
    S.wallets = ws;
    S.phase = 'ready';
    render();
  });
}
