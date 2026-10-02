// Submits a customer's signed EIP-3009 authorization on-chain and pays the gas.
// Used by the store's register (its own gas wallet). `call(method, params)` is any
// JSON-RPC function bound to the chain.
import { JPYC } from './config.js';
import { keccakText } from './keccak.js';
import { splitSignature, signTx1559, encodeTransferWithAuthorization, domainSeparator, toHex } from './secp256k1.js';

const GWEI = 10n ** 9n;
const MIN_TIP = 30n * GWEI; // Polygon validators reject tips below ~25 gwei

/** Failures that happen before anything is broadcast: the customer can safely pay another way. */
export const PRE_BROADCAST = ['bad-request', 'charge-mismatch', 'time-window', 'bad-signature', 'unsupported-token', 'rejected', 'gas-limit', 'gas-too-high', 'relayer-empty', 'disabled', 'rpc'];

export class RelayError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}
const msgOf = (e) => String(e?.message || e).slice(0, 200);
const sel = (sig) => keccakText(sig).slice(0, 10);
const SEL = { domain: sel('DOMAIN_SEPARATOR()'), name: sel('name()'), used: sel('authorizationState(address,bytes32)') };

function decodeAbiString(hex) {
  try {
    const h = String(hex).replace(/^0x/, '');
    const len = parseInt(h.slice(64, 128), 16);
    const bytes = h.slice(128, 128 + len * 2).match(/../g) || [];
    return new TextDecoder().decode(Uint8Array.from(bytes.map((b) => parseInt(b, 16))));
  } catch {
    return '';
  }
}

const domainCache = new Map();
/** The token's EIP-712 domain, confirmed against its on-chain DOMAIN_SEPARATOR. */
export async function findDomain(call, chainId) {
  if (domainCache.has(chainId)) return domainCache.get(chainId);
  const [onchain, nameHex] = await Promise.all([
    call('eth_call', [{ to: JPYC.address, data: SEL.domain }, 'latest']),
    call('eth_call', [{ to: JPYC.address, data: SEL.name }, 'latest']).catch(() => '0x'),
  ]);
  for (const name of [...new Set([decodeAbiString(nameHex), 'JPY Coin', 'JPYC'].filter(Boolean))]) {
    for (const version of ['1', '2']) {
      const sep = domainSeparator({ name, version, chainId, verifyingContract: JPYC.address });
      if (toHex(sep).toLowerCase() === String(onchain).toLowerCase()) {
        const found = { name, version };
        domainCache.set(chainId, found);
        return found;
      }
    }
  }
  return null;
}

/** Has this authorization been used (or cancelled) on-chain? */
export async function authorizationUsed(call, authorizer, nonce) {
  const data = SEL.used + authorizer.toLowerCase().replace(/^0x/, '').padStart(64, '0') + nonce.replace(/^0x/, '').toLowerCase();
  return BigInt((await call('eth_call', [{ to: JPYC.address, data }, 'latest'])) || '0x0') !== 0n;
}

async function fees(call, maxGwei) {
  const [block, tipHex] = await Promise.all([
    call('eth_getBlockByNumber', ['latest', false]),
    call('eth_maxPriorityFeePerGas', []).catch(() => '0x0'),
  ]);
  let tip = BigInt(tipHex || '0x0');
  if (tip < MIN_TIP) tip = MIN_TIP;
  const maxFee = BigInt(block?.baseFeePerGas || '0x0') * 2n + tip;
  if (maxFee > maxGwei * GWEI) throw new RelayError('gas-too-high');
  return { tip, maxFee };
}

async function broadcast(call, build) {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const signed = await build(BigInt(await call('eth_getTransactionCount', [build.from, 'pending'])));
    try {
      await call('eth_sendRawTransaction', [signed.raw]);
      return signed.txHash;
    } catch (e) {
      last = msgOf(e);
      if (/already known/i.test(last)) return signed.txHash;
      if (!/nonce too low|replacement|underpriced/i.test(last)) break;
    }
  }
  throw new RelayError('send-failed', last);
}

/** Relay `auth` (signed by the customer) from the gas wallet `key`/`relayer`. Returns { hash }. */
export async function relayAuthorization({ call, chainId, auth, signature, key, relayer, maxGwei = 500n }) {
  let sig;
  try { sig = splitSignature(signature); } catch { throw new RelayError('bad-signature'); }
  const data = encodeTransferWithAuthorization(auth, sig);
  const tx = { from: relayer, to: JPYC.address, data };
  try {
    await call('eth_call', [tx, 'latest']); // dry run: a bad authorization never costs gas
  } catch (e) {
    throw new RelayError(e?.fromNode === false || /timeout|HTTP|fetch|network|abort/i.test(msgOf(e)) ? 'rpc' : 'rejected', msgOf(e));
  }
  let gas;
  let fee;
  try {
    const [gasHex, balHex] = await Promise.all([call('eth_estimateGas', [tx]), call('eth_getBalance', [relayer, 'latest'])]);
    gas = (BigInt(gasHex) * 125n) / 100n;
    if (gas > 300_000n) throw new RelayError('gas-limit');
    fee = await fees(call, maxGwei);
    if (BigInt(balHex) < gas * fee.maxFee) throw new RelayError('relayer-empty');
  } catch (e) {
    throw e instanceof RelayError ? e : new RelayError('rpc', msgOf(e));
  }
  const build = (nonce) => signTx1559({ chainId, nonce, maxPriorityFeePerGas: fee.tip, maxFeePerGas: fee.maxFee, gas, to: JPYC.address, value: 0n, data }, key);
  build.from = relayer;
  return { hash: await broadcast(call, build) };
}

/** Send everything left in the gas wallet (minus the fee) to `to`. Returns { hash, value }. */
export async function sweepNative({ call, chainId, key, from, to, maxGwei = 500n }) {
  const fee = await fees(call, maxGwei);
  const gas = 21_000n;
  const bal = BigInt(await call('eth_getBalance', [from, 'latest']));
  const value = bal - gas * fee.maxFee;
  if (value <= 0n) throw new RelayError('relayer-empty');
  const build = (nonce) => signTx1559({ chainId, nonce, maxPriorityFeePerGas: fee.tip, maxFeePerGas: fee.maxFee, gas, to, value, data: '0x' }, key);
  build.from = from;
  return { hash: await broadcast(call, build), value };
}
