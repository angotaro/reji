// The store's own gas wallet for no-fee payments.
// It is created on this register, funded by the store owner with a little POL,
// and only pays the network fee when a customer's signed JPYC payment for the
// charge on screen arrives over Nostr. Nobody else, including whoever hosts
// Reji, holds this key or pays for it.
import { store } from './util.js';
import { checksum, yenToWei, sameAddress, isAddress } from './evm.js';
import { rpc, nativeBalance } from './rpc.js';
import { randomPrivateKey, privateKeyFromHex, privateKeyToHex, addressOf, recoverPersonal } from './secp256k1.js';
import { parseOwnerMessage } from './ownermsg.js';
import { relayAuthorization, sweepNative, RelayError } from './relayer.js';
import { Pool, makeEvent, KIND } from './nostr.js';
import { state } from './state.js';

export const GAS_KEY_STORE = 'reji:gas:v1';
export const MIN_GAS = 2n * 10n ** 16n; // below 0.02 POL, charges fall back to normal payments
let bal = { value: null, chainId: 0, address: '' };
let addrCache = { key: '', address: '' };

export const gasChainId = () => (state.settings.network === 'testnet' ? 80002 : 137);

export function gasWallet() {
  const g = store.get(GAS_KEY_STORE, null);
  if (!g || typeof g.key !== 'string') return null;
  try {
    const key = privateKeyFromHex(g.key);
    if (addrCache.key !== g.key) addrCache = { key: g.key, address: checksum(addressOf(key)) };
    return { key, address: addrCache.address, createdAt: g.createdAt || 0 };
  } catch {
    return null;
  }
}

export function createGasWallet() {
  if (!gasWallet()) store.set(GAS_KEY_STORE, { key: privateKeyToHex(randomPrivateKey()), createdAt: Date.now() });
  return gasWallet();
}

export const gasKeyHex = () => store.get(GAS_KEY_STORE, null)?.key || '';

export async function refreshGasBalance() {
  const w = gasWallet();
  if (!w) return null;
  const chainId = gasChainId();
  const value = await nativeBalance(chainId, w.address);
  bal = { value, chainId, address: w.address };
  return value;
}

export function cachedGasBalance() {
  const w = gasWallet();
  return w && bal.address === w.address && bal.chainId === gasChainId() ? bal.value : null;
}

// The owner record carries the signed message, so a record edited on the device
// (another address, a copied record) no longer checks out.
const ownerCache = new Map();
export function ownerVerified(s = state.settings) {
  const o = s.owner;
  if (!o?.address || !o.message || !o.signature || !isAddress(s.address) || !sameAddress(o.address, s.address)) return false;
  const k = `${o.signature}|${s.address}|${o.message}`;
  if (!ownerCache.has(k)) {
    let ok = false;
    try {
      const m = parseOwnerMessage(o.message);
      ok = !!m && m.action === 'verify-owner' && sameAddress(m.wallet, s.address) && sameAddress(recoverPersonal(o.message, o.signature), s.address);
    } catch { ok = false; }
    ownerCache.set(k, ok);
  }
  return ownerCache.get(k);
}
/** 'none' (never confirmed) | 'ok' | 'invalid' (a record that does not check out) */
export const ownerState = (s = state.settings) => (!s.owner ? 'none' : ownerVerified(s) ? 'ok' : 'invalid');

/** 'owner' | 'wallet' | 'off' | 'unknown' | 'low' | 'on' */
export function gaslessStatus() {
  if (!ownerVerified()) return 'owner';
  if (!gasWallet()) return 'wallet';
  if (!state.settings.gasless) return 'off';
  const v = cachedGasBalance();
  if (v == null) return 'unknown';
  return v >= MIN_GAS ? 'on' : 'low';
}

export const gaslessReady = (chains) => gaslessStatus() === 'on' && chains.includes(gasChainId());

const callFor = (chainId) => (method, params) => rpc(chainId, method, params, method === 'eth_sendRawTransaction' ? { fanout: 3 } : {});

/** Only the exact payment for the charge on screen is relayed. */
function check(req, c) {
  const isHex = (v, n) => typeof v === 'string' && new RegExp(`^0x[0-9a-fA-F]{${n}}$`).test(v);
  const chainId = Number(req?.chainId);
  if (chainId !== gasChainId() || !c.chains.includes(chainId)) throw new RelayError('charge-mismatch');
  if (!isAddress(req.from) || !isAddress(req.to) || !sameAddress(req.to, c.to)) throw new RelayError('charge-mismatch');
  if (String(req.value) !== (yenToWei(c.amountYen) + BigInt(c.suffix)).toString()) throw new RelayError('charge-mismatch');
  if (!/^\d{1,12}$/.test(String(req.validAfter)) || !/^\d{1,12}$/.test(String(req.validBefore))) throw new RelayError('bad-request');
  const now = Math.floor(Date.now() / 1000);
  if (Number(req.validAfter) > now + 30 || Number(req.validBefore) < now + 15 || Number(req.validBefore) > now + 1200) throw new RelayError('time-window');
  if (!isHex(req.nonce, 64) || !isHex(req.signature, 130)) throw new RelayError('bad-request');
  return {
    chainId,
    auth: { from: req.from, to: req.to, value: BigInt(req.value), validAfter: BigInt(req.validAfter), validBefore: BigInt(req.validBefore), nonce: req.nonce },
  };
}

/** Listen for the customer's signed payment for charge `c`. Returns a stop function. */
export function startDeviceRelay(c, onStatus = () => {}) {
  const w = gasWallet();
  if (!w || !c.relayChannel) return () => {};
  const tag = 'reji-' + c.relayChannel;
  const pool = new Pool().connect();
  const sk = c.relayKey ? privateKeyFromHex(c.relayKey) : randomPrivateKey(); // customers only trust replies from this key
  const handled = new Set();
  const unsub = pool.subscribe({ kinds: [KIND.payRequest], '#t': [tag] }, async (ev) => {
    if (handled.size >= 3 || String(ev.content).length > 4000) return; // one charge, a few honest tries at most
    let req;
    try { req = JSON.parse(ev.content); } catch { return; }
    const reply = async (body) => pool.publish(await makeEvent(sk, KIND.payReply, [['t', tag], ['e', ev.id]], JSON.stringify(body)));
    let parsed;
    try {
      parsed = check(req, c);
    } catch (e) {
      await reply({ error: e.code || 'bad-request' });
      return;
    }
    if (handled.has(parsed.auth.nonce)) return;
    handled.add(parsed.auth.nonce);
    onStatus('relaying');
    try {
      const { hash } = await relayAuthorization({ call: callFor(parsed.chainId), chainId: parsed.chainId, auth: parsed.auth, signature: req.signature, key: w.key, relayer: w.address });
      await reply({ hash });
      onStatus('sent', hash);
      refreshGasBalance().catch(() => {});
    } catch (e) {
      const code = e instanceof RelayError ? e.code : 'send-failed';
      await reply({ error: code });
      onStatus('error', code);
    }
  });
  onStatus('listening');
  return () => {
    unsub();
    setTimeout(() => pool.close(), 4000); // let a reply in flight go out
  };
}

/** Return everything left in the gas wallet to `to` (the owner). */
export async function withdrawGas(to) {
  const w = gasWallet();
  if (!w) throw new RelayError('disabled');
  const chainId = gasChainId();
  const res = await sweepNative({ call: callFor(chainId), chainId, key: w.key, from: w.address, to });
  refreshGasBalance().catch(() => {});
  return { ...res, chainId };
}
