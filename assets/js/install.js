// Help store owners use Reji like an app: add it to the Home Screen or desktop, and ask the browser
// to keep Reji's data (settings, sales) out of automatic cleanup.
import { html, store, inAppBrowser } from './util.js';
import { t } from './i18n.js';

const PERSIST_KEY = 'reji:persist:v1';
let deferred = null; // the browser's install prompt (Chrome, Edge, Android), kept until a button uses it

/** installed | inapp | prompt | ios | other */
export function installStateFor({ isStandalone, inApp, hasPrompt, isIos }) {
  if (isStandalone) return 'installed';
  if (inApp) return 'inapp';
  if (hasPrompt) return 'prompt';
  if (isIos) return 'ios';
  return 'other';
}

const nav = globalThis.navigator;
const isIos = () => /iPad|iPhone|iPod/.test(nav?.userAgent || '') || (nav?.platform === 'MacIntel' && nav?.maxTouchPoints > 1);
const isStandalone = () => !!(globalThis.matchMedia?.('(display-mode: standalone)').matches || nav?.standalone === true);
export const installState = () => installStateFor({ isStandalone: isStandalone(), inApp: !!inAppBrowser(), hasPrompt: !!deferred, isIos: isIos() });
const mark = () => { document.documentElement.dataset.install = installState(); };

/** Call once at start-up, before anything renders: the browser may offer its prompt at any time. */
export function initInstall() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own button instead of the browser's mini bar
    deferred = e;
    mark();
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    mark();
  });
  document.addEventListener('click', async (e) => {
    if (e.target.closest?.('[data-install-backup]')) {
      const { saveBackup } = await import('./backup.js');
      saveBackup();
      return;
    }
    if (!e.target.closest?.('[data-install]') || !deferred) return;
    const prompt = deferred;
    deferred = null;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch { /* the user closed it */ }
    mark();
  });
  mark();
}

/** Asks the browser to keep Reji's data out of automatic cleanup. Asks at most once a month. */
export async function keepData() {
  try {
    if (!nav?.storage?.persist) return false;
    if (await nav.storage.persisted()) return true;
    const asked = store.get(PERSIST_KEY, 0);
    if (asked && Date.now() - asked < 30 * 86_400_000) return false;
    store.set(PERSIST_KEY, Date.now());
    return await nav.storage.persist();
  } catch {
    return false;
  }
}

/** The help card. CSS shows the part that fits this browser (see html[data-install]). */
export const installCard = () => html`<div class="install-card">
  <p class="ic-title">${t('inst.title')}</p>
  <div data-for="prompt"><p>${t('inst.prompt')}</p><button type="button" class="btn primary" data-install>${t('inst.add')}</button></div>
  <div data-for="ios"><ol><li>${t('inst.ios1')}</li><li>${t('inst.ios2')}</li><li>${t('inst.ios3')}</li></ol>
    <p class="hint">${t('inst.iosNote')}</p><button type="button" class="btn ghost small" data-install-backup>${t('inst.backup')}</button></div>
  <div data-for="inapp"><p>${t('inst.inapp')}</p></div>
  <div data-for="other"><p>${t('inst.other')}</p></div>
  <div data-for="installed"><p>${t('inst.installed')}</p></div>
</div>`;
