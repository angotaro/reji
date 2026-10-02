// Signing and relaying: known-answer vectors, personal_sign, BIP-340 and the
// relay flow against a mocked Polygon node. Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addressOf, privateKeyFromHex, signLegacyTx, sign, recoverAddress, domainSeparator, authorizationDigest, toHex, hexToBytes,
  TWA_SELECTOR, personalMessageDigest, recoverPersonal, signatureHex, schnorrSign, schnorrVerify, schnorrPublicKey, randomPrivateKey,
} from '../assets/js/secp256k1.js';
import { relayAuthorization, sweepNative, findDomain, authorizationUsed, RelayError } from '../assets/js/relayer.js';
import { makeEvent, KIND } from '../assets/js/nostr.js';
import { keccak256, bytesToHex } from '../assets/js/keccak.js';

const JPYC = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29';
const STORE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const GAS_KEY = privateKeyFromHex('0x' + '11'.repeat(32));
const CUSTOMER = privateKeyFromHex('0x' + '22'.repeat(32));

test('address from private key 1', () => {
  assert.equal(addressOf(1n), '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
});

test('EIP-155 known-answer vector (RFC 6979)', async () => {
  const tx = await signLegacyTx({ nonce: 9, gasPrice: 20000000000n, gas: 21000, to: '0x3535353535353535353535353535353535353535', value: 10n ** 18n, data: '0x', chainId: 1 }, privateKeyFromHex('0x' + '46'.repeat(32)));
  assert.equal(tx.raw, '0xf86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83');
});

test('personal_sign round trip', async () => {
  const msg = 'Reji: store owner confirmation\nCode: abc';
  const sig = signatureHex(await sign(personalMessageDigest(msg), CUSTOMER));
  assert.equal(recoverPersonal(msg, sig), addressOf(CUSTOMER));
  assert.notEqual(recoverPersonal(msg + '!', sig), addressOf(CUSTOMER));
});

test('BIP-340 test vector 0 and round trip', async () => {
  assert.equal(schnorrPublicKey(3n).toUpperCase(), 'F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9');
  const sig = await schnorrSign(new Uint8Array(32), 3n, new Uint8Array(32));
  assert.equal(sig.toUpperCase(), 'E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0');
  const d = randomPrivateKey();
  const m = keccak256(new Uint8Array([1, 2, 3]));
  const s2 = await schnorrSign(m, d);
  assert.ok(await schnorrVerify(schnorrPublicKey(d), m, s2));
  assert.ok(!(await schnorrVerify(schnorrPublicKey(d), keccak256(new Uint8Array([9])), s2)));
});

test('Nostr events carry a valid id and signature', async () => {
  const ev = await makeEvent(randomPrivateKey(), KIND.payRequest, [['t', 'reji-x']], '{"a":1}');
  const id = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content])))));
  assert.equal(ev.id, id);
  assert.ok(await schnorrVerify(ev.pubkey, hexToBytes(ev.id), ev.sig));
});

// ---- relay flow against a mocked node ----
const DOMAIN = toHex(domainSeparator({ name: 'JPY Coin', version: '1', chainId: 137, verifyingContract: JPYC }));
function node(overrides = {}) {
  const sent = [];
  const call = async (method, params) => {
    if (overrides[method]) return overrides[method](params);
    switch (method) {
      case 'eth_call':
        if (params[0].data === '0x3644e515') return DOMAIN;
        if (params[0].data === '0x06fdde03') return '0x' + '20'.padStart(64, '0') + '8'.padStart(64, '0') + Buffer.from('JPY Coin').toString('hex').padEnd(64, '0');
        return '0x' + '0'.repeat(64);
      case 'eth_estimateGas': return '0x15f90';
      case 'eth_getBlockByNumber': return { baseFeePerGas: '0x' + (40n * 10n ** 9n).toString(16) };
      case 'eth_maxPriorityFeePerGas': return '0x' + (31n * 10n ** 9n).toString(16);
      case 'eth_getBalance': return '0x' + (10n ** 18n).toString(16);
      case 'eth_getTransactionCount': return '0x5';
      case 'eth_sendRawTransaction': sent.push(params[0]); return '0x' + 'aa'.repeat(32);
      default: throw new Error('unsupported ' + method);
    }
  };
  return { call, sent };
}
async function authorization(value = 1400n * 10n ** 18n + 123n) {
  const a = { from: addressOf(CUSTOMER), to: STORE, value, validAfter: 0n, validBefore: BigInt(Math.floor(Date.now() / 1000) + 150), nonce: '0x' + '07'.repeat(32) };
  const sep = domainSeparator({ name: 'JPY Coin', version: '1', chainId: 137, verifyingContract: JPYC });
  return { auth: a, signature: signatureHex(await sign(authorizationDigest(sep, a), CUSTOMER)) };
}

test('domain lookup and authorization state', async () => {
  const { call } = node();
  assert.deepEqual(await findDomain(call, 137), { name: 'JPY Coin', version: '1' });
  assert.equal(await authorizationUsed(call, addressOf(CUSTOMER), '0x' + '07'.repeat(32)), false);
});

test('relays a signed authorization as an EIP-1559 transaction from the gas wallet', async () => {
  const { call, sent } = node();
  const { auth, signature } = await authorization();
  const relayer = addressOf(GAS_KEY);
  const t0 = performance.now();
  const { hash } = await relayAuthorization({ call, chainId: 137, auth, signature, key: GAS_KEY, relayer });
  console.log(`  relay: ${(performance.now() - t0).toFixed(1)} ms`);
  assert.equal(sent.length, 1);
  const raw = hexToBytes(sent[0]);
  assert.equal(raw[0], 2);
  assert.equal(hash, toHex(keccak256(raw)));
  const hex = sent[0].slice(2);
  const at = hex.indexOf(TWA_SELECTOR.slice(2));
  assert.ok(at > 0);
  assert.equal(BigInt('0x' + hex.slice(at + 8 + 128, at + 8 + 192)), auth.value);
});

test('refuses without spending gas when the dry run fails, fees spike or the wallet is empty', async () => {
  const { auth, signature } = await authorization();
  const base = { chainId: 137, auth, signature, key: GAS_KEY, relayer: addressOf(GAS_KEY) };
  const code = async (overrides) => {
    const { call, sent } = node(overrides);
    try { await relayAuthorization({ ...base, call }); return 'ok'; } catch (e) { assert.equal(sent.length, 0); return e instanceof RelayError ? e.code : 'other'; }
  };
  const revert = () => { const e = new Error('execution reverted: FiatTokenV2: invalid signature'); e.fromNode = true; throw e; };
  assert.equal(await code({ eth_call: revert }), 'rejected');
  assert.equal(await code({ eth_getBlockByNumber: () => ({ baseFeePerGas: '0x' + (400n * 10n ** 9n).toString(16) }) }), 'gas-too-high');
  assert.equal(await code({ eth_getBalance: () => '0x0' }), 'relayer-empty');
  const bad = await (async () => { const { call } = node(); try { await relayAuthorization({ ...base, call, signature: '0x' + '00'.repeat(65) }); } catch (e) { return e.code; } })();
  assert.equal(bad, 'bad-signature');
});

test('sweep returns the balance minus the fee', async () => {
  const { call, sent } = node();
  const { value } = await sweepNative({ call, chainId: 137, key: GAS_KEY, from: addressOf(GAS_KEY), to: STORE });
  assert.equal(value, 10n ** 18n - 21000n * 111n * 10n ** 9n);
  assert.equal(sent.length, 1);
  assert.equal(recoverAddress(keccak256(new Uint8Array([1])), ...Object.values(await sign(keccak256(new Uint8Array([1])), GAS_KEY))), addressOf(GAS_KEY));
});
