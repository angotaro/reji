// Customer-side wallet plumbing. Plain EIP-1193 + EIP-6963 — works with any
// injected wallet (MetaMask, Rabby, Coinbase, Trust, OKX, Brave…). No
// WalletConnect project id or SDK needed.
import { CHAINS, JPYC, addChainParams } from './config.js';
import { encodeTransfer } from './evm.js';

function guessName(p) {
  if (!p) return 'Wallet';
  if (p.isRabby) return 'Rabby';
  if (p.isCoinbaseWallet) return 'Coinbase Wallet';
  if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
  if (p.isOkxWallet || p.isOKExWallet) return 'OKX Wallet';
  if (p.isBraveWallet) return 'Brave Wallet';
  if (p.isMetaMask) return 'MetaMask';
  return 'Browser wallet';
}

const safeIcon = (icon) => (typeof icon === 'string' && /^data:image\/(png|svg\+xml|avif|jpeg|gif)[;,]/i.test(icon) ? icon : '');

/** Collect wallets announced via EIP-6963, falling back to window.ethereum. */
export function discoverWallets(wait = 450) {
  return new Promise((resolve) => {
    const found = new Map();
    const onAnnounce = (e) => {
      const d = e.detail;
      if (!d?.provider || !d.info) return;
      const key = d.info.rdns || d.info.uuid || d.info.name;
      if (!found.has(key)) found.set(key, { id: key, name: String(d.info.name || 'Wallet').slice(0, 40), icon: safeIcon(d.info.icon), provider: d.provider });
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      const list = [...found.values()];
      if (!list.length && window.ethereum) {
        list.push({ id: 'injected', name: guessName(window.ethereum), icon: '', provider: window.ethereum });
      }
      resolve(list);
    }, wait);
  });
}

export async function connect(provider) {
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!accounts?.length) throw new Error('No account');
  return accounts[0];
}

const isUnknownChain = (e) =>
  e?.code === 4902 || e?.data?.originalError?.code === 4902 || /unrecognized|not been added|unknown chain|not added/i.test(e?.message || '');

export async function ensureChain(provider, chainId) {
  const hex = '0x' + chainId.toString(16);
  const current = await provider.request({ method: 'eth_chainId' }).catch(() => null);
  if (current && Number(current) === chainId) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e) {
    if (!isUnknownChain(e)) throw e;
    await provider.request({ method: 'wallet_addEthereumChain', params: [addChainParams(chainId)] });
    const now = await provider.request({ method: 'eth_chainId' }).catch(() => null);
    if (now && Number(now) !== chainId) {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
    }
  }
}

/** Sends JPYC.transfer(to, value). Returns the tx hash. */
export async function sendTransfer(provider, from, to, value) {
  return provider.request({
    method: 'eth_sendTransaction',
    params: [{ from, to: JPYC.address, data: encodeTransfer(to, value), value: '0x0' }],
  });
}

export async function watchAsset(provider) {
  return provider.request({
    method: 'wallet_watchAsset',
    params: { type: 'ERC20', options: { address: JPYC.address, symbol: JPYC.symbol, decimals: JPYC.decimals } },
  });
}

/** Links that reopen this exact page inside a mobile wallet's built-in browser. */
/** This page's link for pasting into a wallet app's browser (without the LINE-only parameter). */
export function pageLinkForWallet(href = location.href) {
  try {
    const u = new URL(href);
    u.searchParams.delete('openExternalBrowser');
    return u.toString();
  } catch { return href; }
}

/** A wallet button leaves the page when its app opens. If the page is still on screen a moment
 *  later (app not installed, link blocked, or the OS opened the link in the browser), call onFail. */
export function watchDeepLinks(root, onFail, ms = 3000) {
  let timer = 0;
  root.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-deep]');
    if (!a) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (document.visibilityState === 'visible') onFail(a.dataset.deep); }, ms);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); });
  window.addEventListener('pagehide', () => clearTimeout(timer));
}

/** MetaMask's documented link that opens a page inside the MetaMask app's browser (it works as a QR code too).
 *  Used instead of payment-request links (EIP-681): MetaMask Mobile can answer those with "chain ID 137
 *  not found" even when Polygon is in the wallet, while a page opened in its browser adds or switches
 *  the network itself. */
export const metamaskLink = (url) => `https://link.metamask.io/dapp/${String(url).replace(/^https?:\/\//, '')}`;

export function walletDeepLinks(url = pageLinkForWallet()) {
  const noProto = url.replace(/^https?:\/\//, '');
  const enc = encodeURIComponent(url);
  return [
    { id: 'metamask', name: 'MetaMask', href: metamaskLink(url) },
    { id: 'trust', name: 'Trust Wallet', href: `https://link.trustwallet.com/open_url?coin_id=60&url=${enc}` },
    { id: 'coinbase', name: 'Coinbase Wallet', href: `https://go.cb-w.com/dapp?cb_url=${enc}` },
    { id: 'okx', name: 'OKX Wallet', href: `okx://wallet/dapp/url?dappUrl=${enc}` },
  ];
}

export const isUserRejection = (e) =>
  e?.code === 4001 || e?.code === 'ACTION_REJECTED' || /reject|denied|cancel/i.test(e?.message || '');

export const nativeSymbol = (chainId) => CHAINS[chainId]?.native.symbol || 'ETH';
