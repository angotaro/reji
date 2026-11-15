// Refunds: the store sends JPYC back from its own wallet; Reji only prepares the details, recognises the
// transfer on the blockchain and records it against the sale. These are the rules, free of screens and storage.
import { yenToWei } from './evm.js';

export const refundedYen = (s) => (s?.refunds || []).reduce((a, r) => a + (r.amountYen || 0), 0);
export const refundableYen = (s) => Math.max(0, (s?.amountYen || 0) - refundedYen(s));
export const refundState = (s) => (!refundedYen(s) ? 'none' : refundableYen(s) ? 'part' : 'full');

/**
 * The store's transfer back to the payer among transfers to the payer's address: sent from the store's address,
 * the plain amount (it is typed by hand), not before the refund was started, and not already recorded.
 */
export function findRefund(transfers, { store, amountYen, startBlock = 0 }, used, keyOf) {
  const want = yenToWei(amountYen);
  const from = String(store).toLowerCase();
  return [...transfers]
    .filter((tr) => String(tr.from).toLowerCase() === from && tr.value === want && Number(tr.blockNumber) >= startBlock && !used.has(keyOf(tr)))
    .sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber))[0] || null;
}
