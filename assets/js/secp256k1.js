// secp256k1 without dependencies: ECDSA (RFC 6979) with public-key recovery,
// personal_sign checks, BIP-340 Schnorr (for Nostr), RLP, EIP-1559 transactions
// and the EIP-712 digest for EIP-3009 TransferWithAuthorization.
// Runs in browsers and Node 18+ (uses crypto.subtle for HMAC-SHA256 / SHA-256).
import { keccak256, bytesToHex } from './keccak.js';

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [
  0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
];

const mod = (a, m = P) => {
  const r = a % m;
  return r >= 0n ? r : r + m;
};

function inv(a, m = P) {
  let [r0, r1] = [mod(a, m), m];
  let [s0, s1] = [1n, 0n];
  while (r1) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error('not invertible');
  return mod(s0, m);
}

function dbl(p) {
  if (!p || p[1] === 0n) return null;
  const l = mod(3n * p[0] * p[0] * inv(2n * p[1]));
  const x = mod(l * l - 2n * p[0]);
  return [x, mod(l * (p[0] - x) - p[1])];
}

function add(p, q) {
  if (!p) return q;
  if (!q) return p;
  if (p[0] === q[0]) return mod(p[1] + q[1]) === 0n ? null : dbl(p);
  const l = mod((q[1] - p[1]) * inv(q[0] - p[0]));
  const x = mod(l * l - p[0] - q[0]);
  return [x, mod(l * (p[0] - x) - p[1])];
}

// Jacobian coordinates: one field inversion per scalar multiplication, which
// keeps a signature well inside a serverless CPU budget.
function jDbl([X, Y, Z]) {
  if (Z === 0n || Y === 0n) return [0n, 1n, 0n];
  const A = mod(X * X);
  const B = mod(Y * Y);
  const C = mod(B * B);
  const D = mod(2n * (mod((X + B) * (X + B)) - A - C));
  const E = mod(3n * A);
  const X3 = mod(E * E - 2n * D);
  return [X3, mod(E * (D - X3) - 8n * C), mod(2n * Y * Z)];
}

function jAddAffine([X1, Y1, Z1], [x2, y2]) {
  if (Z1 === 0n) return [x2, y2, 1n];
  const Z1Z1 = mod(Z1 * Z1);
  const H = mod(x2 * Z1Z1 - X1);
  const r = mod(y2 * Z1 * Z1Z1 - Y1);
  if (H === 0n) return r === 0n ? jDbl([X1, Y1, Z1]) : [0n, 1n, 0n];
  const HH = mod(H * H);
  const HHH = mod(H * HH);
  const V = mod(X1 * HH);
  const X3 = mod(r * r - HHH - 2n * V);
  return [X3, mod(r * (V - X3) - Y1 * HHH), mod(Z1 * H)];
}

function mul(k, p = G) {
  const n = mod(k, N);
  let R = [0n, 1n, 0n];
  for (let i = BigInt(n.toString(2).length) - 1n; i >= 0n; i--) {
    R = jDbl(R);
    if ((n >> i) & 1n) R = jAddAffine(R, p);
  }
  if (R[2] === 0n) return null;
  const zi = inv(R[2]);
  const zi2 = mod(zi * zi);
  return [mod(R[0] * zi2), mod(R[1] * zi2 * zi)];
}

// Fixed-base table: TABLE[i][j] = j * 16^i * G (affine), built once when the
// module loads, so k*G needs only 64 additions and no doublings.
const TABLE = (() => {
  const rows = [];
  let base = G;
  for (let i = 0; i < 64; i++) {
    const row = [null, base];
    for (let j = 2; j < 16; j++) row.push(add(row[j - 1], base));
    rows.push(row);
    base = dbl(dbl(dbl(dbl(base))));
  }
  return rows;
})();

function mulG(k) {
  const n = mod(k, N);
  let R = [0n, 1n, 0n];
  for (let i = 0; i < 64; i++) {
    const nib = Number((n >> BigInt(4 * i)) & 15n);
    if (nib) R = jAddAffine(R, TABLE[i][nib]);
  }
  if (R[2] === 0n) return null;
  const zi = inv(R[2]);
  const zi2 = mod(zi * zi);
  return [mod(R[0] * zi2), mod(R[1] * zi2 * zi)];
}

// ---- bytes ----
export const hexToBytes = (hex) => {
  const h = hex.replace(/^0x/, '');
  if (h.length % 2 || /[^0-9a-f]/i.test(h)) throw new Error('bad hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
};
export const toHex = (b) => '0x' + bytesToHex(b);
export const concat = (arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
const bigToBytes = (n, len) => {
  let h = n.toString(16);
  if (len) h = h.padStart(len * 2, '0');
  else if (h.length % 2) h = '0' + h;
  return hexToBytes(h);
};
const bytesToBig = (b) => (b.length ? BigInt(toHex(b)) : 0n);

// ---- keys & addresses ----
export function privateKeyFromHex(hex) {
  const d = BigInt('0x' + String(hex).trim().replace(/^0x/, ''));
  if (d <= 0n || d >= N) throw new Error('invalid private key');
  return d;
}

export function addressOfPoint(pt) {
  const pub = concat([bigToBytes(pt[0], 32), bigToBytes(pt[1], 32)]);
  return '0x' + bytesToHex(keccak256(pub)).slice(-40);
}

export const addressOf = (d) => addressOfPoint(mulG(d));

// ---- RFC 6979 ----
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

async function nonceK(d, hash) {
  const x = bigToBytes(d, 32);
  const h = bigToBytes(mod(bytesToBig(hash), N), 32);
  let V = new Uint8Array(32).fill(1);
  let K = new Uint8Array(32);
  K = await hmac(K, concat([V, Uint8Array.of(0), x, h]));
  V = await hmac(K, V);
  K = await hmac(K, concat([V, Uint8Array.of(1), x, h]));
  V = await hmac(K, V);
  for (;;) {
    V = await hmac(K, V);
    const k = bytesToBig(V);
    if (k > 0n && k < N) return k;
    K = await hmac(K, concat([V, Uint8Array.of(0)]));
    V = await hmac(K, V);
  }
}

/** Sign a 32-byte digest. Returns { r, s, recovery } with low-s (EIP-2). */
export async function sign(hash, d) {
  const z = bytesToBig(hash);
  for (;;) {
    const k = await nonceK(d, hash);
    const R = mulG(k);
    const r = mod(R[0], N);
    if (r === 0n) continue;
    let s = mod(inv(k, N) * (z + r * d), N);
    if (s === 0n) continue;
    let recovery = (R[1] & 1n ? 1 : 0) | (R[0] >= N ? 2 : 0);
    if (s > N / 2n) {
      s = N - s;
      recovery ^= 1;
    }
    return { r, s, recovery };
  }
}

/** Recover the signer address from a digest and (r, s, recovery). */
export function recoverAddress(hash, r, s, recovery) {
  if (r <= 0n || r >= N || s <= 0n || s >= N) throw new Error('bad signature');
  const x = recovery & 2 ? r + N : r;
  const ySq = mod(x * x * x + 7n);
  let y = 1n;
  let b = ySq;
  let e = (P + 1n) / 4n;
  while (e > 0n) {
    if (e & 1n) y = mod(y * b);
    b = mod(b * b);
    e >>= 1n;
  }
  if (mod(y * y) !== ySq) throw new Error('bad signature');
  if ((y & 1n) !== BigInt(recovery & 1)) y = P - y;
  const z = bytesToBig(hash);
  const rInv = inv(r, N);
  const Q = add(mul(mod(s * rInv, N), [x, y]), mulG(mod(-z * rInv, N)));
  if (!Q) throw new Error('bad signature');
  return addressOfPoint(Q);
}

/** Split a 65-byte 0x signature (r ‖ s ‖ v) into parts. */
export function splitSignature(sig) {
  const b = hexToBytes(sig);
  if (b.length !== 65) throw new Error('bad signature length');
  let v = b[64];
  if (v < 27) v += 27;
  if (v !== 27 && v !== 28) throw new Error('bad signature v');
  const r = bytesToBig(b.slice(0, 32));
  const s = bytesToBig(b.slice(32, 64));
  if (r === 0n || r >= N || s === 0n || s > N / 2n) throw new Error('bad signature values');
  return { r, s, v, recovery: v - 27 };
}

// ---- RLP ----
const rlpLen = (len, offset) => {
  if (len < 56) return Uint8Array.of(offset + len);
  const l = bigToBytes(BigInt(len));
  return concat([Uint8Array.of(offset + 55 + l.length), l]);
};
export function rlp(item) {
  if (Array.isArray(item)) {
    const body = concat(item.map(rlp));
    return concat([rlpLen(body.length, 0xc0), body]);
  }
  if (item.length === 1 && item[0] < 0x80) return item;
  return concat([rlpLen(item.length, 0x80), item]);
}
export const rlpInt = (n) => (BigInt(n) === 0n ? new Uint8Array(0) : bigToBytes(BigInt(n)));

// ---- transactions ----
/** Legacy EIP-155 transaction (used by the tests' known-answer vector). */
export async function signLegacyTx(tx, d) {
  const fields = [rlpInt(tx.nonce), rlpInt(tx.gasPrice), rlpInt(tx.gas), hexToBytes(tx.to), rlpInt(tx.value), hexToBytes(tx.data || '0x')];
  const hash = keccak256(rlp([...fields, rlpInt(tx.chainId), new Uint8Array(0), new Uint8Array(0)]));
  const { r, s, recovery } = await sign(hash, d);
  const v = BigInt(recovery) + 35n + 2n * BigInt(tx.chainId);
  return { raw: toHex(rlp([...fields, rlpInt(v), rlpInt(r), rlpInt(s)])), hash: toHex(hash), r, s, v };
}

/** EIP-1559 (type 2) transaction. Returns the raw signed tx and its hash. */
export async function signTx1559(tx, d) {
  const fields = [
    rlpInt(tx.chainId), rlpInt(tx.nonce), rlpInt(tx.maxPriorityFeePerGas), rlpInt(tx.maxFeePerGas), rlpInt(tx.gas),
    hexToBytes(tx.to), rlpInt(tx.value || 0n), hexToBytes(tx.data || '0x'), [],
  ];
  const digest = keccak256(concat([Uint8Array.of(2), rlp(fields)]));
  const { r, s, recovery } = await sign(digest, d);
  const raw = concat([Uint8Array.of(2), rlp([...fields, rlpInt(recovery), rlpInt(r), rlpInt(s)])]);
  return { raw: toHex(raw), txHash: toHex(keccak256(raw)), digest };
}

// ---- ABI + EIP-712 ----
const word = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const uint = (n) => BigInt(n).toString(16).padStart(64, '0');
const kText = (s) => keccak256(new TextEncoder().encode(s));

const DOMAIN_TYPEHASH = kText('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)');
const TWA_TYPEHASH = kText('TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)');

export function domainSeparator({ name, version, chainId, verifyingContract }) {
  return keccak256(hexToBytes(
    bytesToHex(DOMAIN_TYPEHASH) + bytesToHex(kText(name)) + bytesToHex(kText(version)) + uint(chainId) + word(verifyingContract),
  ));
}

/** EIP-712 digest a wallet signs for EIP-3009 transferWithAuthorization. */
export function authorizationDigest(domainSep, a) {
  const structHash = keccak256(hexToBytes(
    bytesToHex(TWA_TYPEHASH) + word(a.from) + word(a.to) + uint(a.value) + uint(a.validAfter) + uint(a.validBefore) + word(a.nonce),
  ));
  return keccak256(concat([Uint8Array.of(0x19, 0x01), domainSep, structHash]));
}

export const TWA_SELECTOR = '0x' + bytesToHex(kText('transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)')).slice(0, 8);

export function encodeTransferWithAuthorization(a, sig) {
  return TWA_SELECTOR + word(a.from) + word(a.to) + uint(a.value) + uint(a.validAfter) + uint(a.validBefore) + word(a.nonce)
    + uint(sig.v) + uint(sig.r) + uint(sig.s);
}

// ---- keys, personal_sign ----
export function randomPrivateKey() {
  for (;;) {
    const d = bytesToBig(crypto.getRandomValues(new Uint8Array(32)));
    if (d > 0n && d < N) return d;
  }
}
export const privateKeyToHex = (d) => '0x' + d.toString(16).padStart(64, '0');

const utf8 = (s) => new TextEncoder().encode(s);

/** EIP-191 digest used by personal_sign. */
export function personalMessageDigest(message) {
  const m = utf8(message);
  return keccak256(concat([utf8(`\x19Ethereum Signed Message:\n${m.length}`), m]));
}

export const signatureHex = ({ r, s, recovery }) => '0x' + r.toString(16).padStart(64, '0') + s.toString(16).padStart(64, '0') + (27 + recovery).toString(16);

export function recoverPersonal(message, signature) {
  const { r, s, recovery } = splitSignature(signature);
  return recoverAddress(personalMessageDigest(message), r, s, recovery);
}

// ---- BIP-340 Schnorr (Nostr events) ----
export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
async function taggedHash(tag, ...parts) {
  const th = await sha256(utf8(tag));
  return sha256(concat([th, th, ...parts]));
}
const b32 = (n) => bigToBytes(n, 32);
function powMod(b, e) {
  let r = 1n;
  let x = mod(b);
  while (e > 0n) {
    if (e & 1n) r = mod(r * x);
    x = mod(x * x);
    e >>= 1n;
  }
  return r;
}

export const schnorrPublicKey = (d) => bytesToHex(b32(mulG(d)[0]));

export async function schnorrSign(msg, d0, aux = crypto.getRandomValues(new Uint8Array(32))) {
  const Pt = mulG(d0);
  const d = Pt[1] & 1n ? N - d0 : d0;
  const ah = await taggedHash('BIP0340/aux', aux);
  const t = b32(d).map((b, i) => b ^ ah[i]);
  const k0 = mod(bytesToBig(await taggedHash('BIP0340/nonce', t, b32(Pt[0]), msg)), N);
  if (k0 === 0n) throw new Error('bad nonce');
  const R = mulG(k0);
  const k = R[1] & 1n ? N - k0 : k0;
  const e = mod(bytesToBig(await taggedHash('BIP0340/challenge', b32(R[0]), b32(Pt[0]), msg)), N);
  return bytesToHex(concat([b32(R[0]), b32(mod(k + e * d, N))]));
}

export async function schnorrVerify(pubHex, msg, sigHex) {
  const x = BigInt('0x' + pubHex);
  const sig = hexToBytes(sigHex);
  if (sig.length !== 64) return false;
  const r = bytesToBig(sig.slice(0, 32));
  const s = bytesToBig(sig.slice(32));
  if (x >= P || r >= P || s >= N) return false;
  const c = mod(x * x * x + 7n);
  let y = powMod(c, (P + 1n) / 4n);
  if (mod(y * y) !== c) return false;
  if (y & 1n) y = P - y;
  const e = mod(bytesToBig(await taggedHash('BIP0340/challenge', sig.slice(0, 32), b32(x), msg)), N);
  const R = add(mulG(s), mul(N - e, [x, y]));
  return !!R && !(R[1] & 1n) && R[0] === r;
}
