// Tiny EVM toolkit: just what a JPYC register needs. No ethers/viem required.
import { keccak256, bytesToHex } from './keccak.js';
import { JPYC, LIMITS } from './config.js';

// keccak256("Transfer(address,address,uint256)")
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SEL_TRANSFER = 'a9059cbb'; // transfer(address,uint256)
const SEL_BALANCE_OF = '70a08231'; // balanceOf(address)

export const UNIT = 10n ** 18n;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

/** EIP-55 mixed-case checksum */
export function checksum(addr) {
  const lower = addr.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak256(new TextEncoder().encode(lower)));
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}

/** 'ok' | 'invalid' | 'bad-checksum' | 'zero' | 'token' */
export function addressStatus(a) {
  if (!isAddress(a)) return 'invalid';
  if (a.toLowerCase() === ZERO_ADDRESS) return 'zero';
  if (a.toLowerCase() === JPYC.address.toLowerCase()) return 'token';
  const body = a.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return 'ok';
  return checksum(a) === a ? 'ok' : 'bad-checksum';
}

export const sameAddress = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

const word = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');

export const encodeTransfer = (to, value) => '0x' + SEL_TRANSFER + word(to) + word(BigInt(value).toString(16));
export const encodeBalanceOf = (owner) => '0x' + SEL_BALANCE_OF + word(owner);
export const addressTopic = (addr) => '0x' + word(addr);
export const topicToAddress = (topic) => checksum('0x' + topic.slice(-40));

export const toQuantity = (n) => '0x' + BigInt(n).toString(16);
export const fromQuantity = (h) => (h == null || h === '0x' ? 0n : BigInt(h));

export const yenToWei = (yen) => BigInt(yen) * UNIT;
/** A supporter's tip (応援) sent from a store page: carries LIMITS.tipMark below the yen. */
export const isTipValue = (wei) => { try { return BigInt(wei) % UNIT === BigInt(LIMITS.tipMark); } catch { return false; } };

/** Human formatting with thousands separators and trimmed fraction. */
export function formatUnits(value, decimals = 18, maxFrac = 4) {
  let v = BigInt(value);
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + w + (frac ? '.' + frac : '');
}

/** Full-precision decimal string (no grouping), e.g. "1400.000000000000123456" */
export function exactUnits(value, decimals = 18) {
  const v = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return (v / base).toString() + (frac ? '.' + frac : '');
}

/** EIP-681 payment request for an ERC-20 transfer (wallet-direct QR). */
export const eip681 = (chainId, to, wei) =>
  `ethereum:${JPYC.address}@${chainId}/transfer?address=${to}&uint256=${BigInt(wei).toString()}`;
