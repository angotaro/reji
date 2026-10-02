// Keccak-256 (the pre-standard SHA-3 variant Ethereum uses), 32-bit lanes.
// Small and dependency-free; fast enough to run inside a serverless CPU budget.

const RHO = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const PI = new Array(25);
for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) PI[x + 5 * y] = y + 5 * ((2 * x + 3 * y) % 5);

// Round constants from the spec's LFSR (bits sit at positions 2^j - 1).
const RC = new Uint32Array(48);
(() => {
  let R = 1;
  const next = () => {
    const bit = R & 1;
    R <<= 1;
    if (R & 0x100) R ^= 0x171;
    return bit;
  };
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 7; j++) {
      if (!next()) continue;
      const pos = (1 << j) - 1;
      if (pos < 32) RC[2 * i] |= 1 << pos;
      else RC[2 * i + 1] |= 1 << (pos - 32);
    }
  }
})();

function f1600(s) {
  const C = new Uint32Array(10);
  const B = new Uint32Array(50);
  for (let round = 0; round < 24; round++) {
    // theta
    for (let x = 0; x < 5; x++) {
      C[2 * x] = s[2 * x] ^ s[2 * x + 10] ^ s[2 * x + 20] ^ s[2 * x + 30] ^ s[2 * x + 40];
      C[2 * x + 1] = s[2 * x + 1] ^ s[2 * x + 11] ^ s[2 * x + 21] ^ s[2 * x + 31] ^ s[2 * x + 41];
    }
    for (let x = 0; x < 5; x++) {
      const a = (x + 1) % 5;
      const b = (x + 4) % 5;
      const lo = C[2 * b] ^ ((C[2 * a] << 1) | (C[2 * a + 1] >>> 31));
      const hi = C[2 * b + 1] ^ ((C[2 * a + 1] << 1) | (C[2 * a] >>> 31));
      for (let y = 0; y < 25; y += 5) {
        s[2 * (x + y)] ^= lo;
        s[2 * (x + y) + 1] ^= hi;
      }
    }
    // rho + pi
    for (let i = 0; i < 25; i++) {
      const lo = s[2 * i];
      const hi = s[2 * i + 1];
      const n = RHO[i];
      const j = 2 * PI[i];
      if (n === 0) {
        B[j] = lo;
        B[j + 1] = hi;
      } else if (n < 32) {
        B[j] = (lo << n) | (hi >>> (32 - n));
        B[j + 1] = (hi << n) | (lo >>> (32 - n));
      } else if (n === 32) {
        B[j] = hi;
        B[j + 1] = lo;
      } else {
        const m = n - 32;
        B[j] = (hi << m) | (lo >>> (32 - m));
        B[j + 1] = (lo << m) | (hi >>> (32 - m));
      }
    }
    // chi
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const i = 2 * (x + y);
        const i1 = 2 * (((x + 1) % 5) + y);
        const i2 = 2 * (((x + 2) % 5) + y);
        s[i] = B[i] ^ (~B[i1] & B[i2]);
        s[i + 1] = B[i + 1] ^ (~B[i1 + 1] & B[i2 + 1]);
      }
    }
    // iota
    s[0] ^= RC[2 * round];
    s[1] ^= RC[2 * round + 1];
  }
}

/** Keccak-256 of a byte array. Returns 32 bytes. */
export function keccak256(bytes) {
  const rate = 136;
  const s = new Uint32Array(50);
  const len = bytes.length;
  const blocks = Math.floor(len / rate) + 1;
  for (let blk = 0; blk < blocks; blk++) {
    const start = blk * rate;
    const last = blk === blocks - 1;
    for (let k = 0; k < rate; k++) {
      let v;
      const idx = start + k;
      if (idx < len) v = bytes[idx];
      else if (!last) v = 0;
      else {
        v = 0;
        if (idx === len) v |= 0x01;
        if (k === rate - 1) v |= 0x80;
      }
      if (v) s[k >> 2] ^= v << (8 * (k & 3));
    }
    f1600(s);
  }
  const out = new Uint8Array(32);
  for (let k = 0; k < 32; k++) out[k] = (s[k >> 2] >>> (8 * (k & 3))) & 0xff;
  return out;
}

export const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const keccakText = (str) => '0x' + bytesToHex(keccak256(new TextEncoder().encode(str)));
