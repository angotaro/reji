// Pay later (後払い): the rules, kept free of storage and screens so they can be tested on their own.
export const OPEN = ['later', 'uncollected']; // money still owed: waiting, or past the window
export const CLOSED = ['settled', 'writtenoff']; // closed by the store: paid another way, or not collected
export const isLater = (u) => OPEN.includes(u?.status) || CLOSED.includes(u?.status);
export const isOpenLater = (u) => OPEN.includes(u?.status);
export const LATER_KEEP_MS = 30 * 86_400_000; // closed entries stay visible this long

/** May this amount be handed over now and paid later? */
export function laterCheck(amountYen, outstandingYen, s) {
  if (!s?.payLater) return { ok: false, reason: 'off' };
  if (amountYen > s.laterMax) return { ok: false, reason: 'perSale' };
  if (outstandingYen + amountYen > s.laterTotal) return { ok: false, reason: 'total' };
  return { ok: true };
}

/**
 * Which transfers pay which open pay-later entries.
 * - An exact amount (with the entry's invisible fraction, or one from an earlier link for it) can only mean that entry.
 * - A plain amount (typed by hand, as in a copy-and-send wallet) counts only when exactly one open entry could be meant.
 * - Transfers from before an entry was created never count for it; each transfer and each entry is used once.
 * transfers: [{ chainId, blockNumber, value: bigint, txHash, logIndex }], entries carry startBlocks per chain.
 */
export function matchLater(transfers, entries, usedKeys, keyOf, unit = 10n ** 18n) {
  const hits = [];
  const paid = new Set();
  const seen = new Set(usedKeys);
  const open = entries.filter(isOpenLater);
  const base = (u) => BigInt(u.amountYen) * unit;
  const fits = (u, tr) => u.chains.includes(tr.chainId) && Number(tr.blockNumber) >= Number(u.startBlocks?.[tr.chainId] ?? 0);
  const list = [...transfers].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));
  for (const tr of list) {
    const k = keyOf(tr);
    if (seen.has(k)) continue;
    const u = open.find((x) => !paid.has(x.id) && fits(x, tr) && [x.suffix, ...(x.oldSuffixes || [])].some((s) => base(x) + BigInt(s) === tr.value));
    if (!u) continue;
    hits.push({ id: u.id, tr, match: 'exact' });
    paid.add(u.id);
    seen.add(k);
  }
  for (const tr of list) {
    const k = keyOf(tr);
    if (seen.has(k)) continue;
    const cands = open.filter((x) => !paid.has(x.id) && fits(x, tr) && base(x) === tr.value);
    if (cands.length !== 1) continue;
    hits.push({ id: cands[0].id, tr, match: 'amount' });
    paid.add(cands[0].id);
    seen.add(k);
  }
  return hits;
}
