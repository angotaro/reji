// 置きQR (a standing QR for unattended sales): how an incoming transfer is read. Free of screens and storage.
import { UNIT, isStandValue, isTipValue } from './evm.js';

/**
 * 'mark'  : paid from the store page's "pay here" (it carries the standing-QR mark): booked as a sale on its own.
 * 'plain' : a whole-yen amount typed by hand in a copy-and-send wallet: shown for the store to confirm.
 * null    : a gift, a register charge (those carry their own fraction), or outside the limits.
 */
export function standKind(value, maxYen) {
  let v;
  try { v = BigInt(value); } catch { return null; }
  if (isTipValue(v)) return null;
  const yen = v / UNIT;
  if (yen < 1n || yen > BigInt(maxYen)) return null;
  if (isStandValue(v)) return 'mark';
  return v % UNIT === 0n ? 'plain' : null;
}
