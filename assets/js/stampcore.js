// スタンプカード: counted on the customer's own phone from the receipts saved there. No accounts, no server:
// the store publishes the rule (how many stamps, the reward) in its signed profile, and each stamp is one
// payment to that store which the phone has checked on the blockchain.
export const STAMP = { min: 2, max: 30, def: 10, giftMax: 40, yenMax: 1_000_000, key: 'reji:stamps:v1' };

const int = (v) => Math.trunc(Number(v));
/** A card rule from settings or from a profile off a relay (untrusted): { n, gift, min, since } or null. */
export function cleanStamp(o) {
  if (!o || typeof o !== 'object') return null;
  const n = int(o.n);
  const gift = String(o.gift ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, STAMP.giftMax);
  if (!(n >= STAMP.min && n <= STAMP.max) || !gift) return null;
  const min = Number.isFinite(Number(o.min)) ? Math.min(STAMP.yenMax, Math.max(0, int(o.min))) : 0;
  const since = Number.isFinite(Number(o.since)) && Number(o.since) > 0 ? int(o.since) : 0;
  return { n, gift, min, since };
}
/** What the register publishes, or null while the card is off or has no reward written. */
export const stampOffer = (s) => (s?.stampOn ? cleanStamp({ n: s.stampN, gift: s.stampGift, min: s.stampMin, since: s.stampSince }) : null);

/** Receipts that can be stamps for this store's card: paid on-chain, since the card began, at least the minimum. Oldest first, one per payment. */
export function stampable(receipts, pub, card) {
  if (!card || !pub) return [];
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(receipts) ? receipts : []) {
    if (!r || r.b !== pub || !/^0x[0-9a-fA-F]{64}$/.test(r.tx || '') || !r.c) continue;
    const id = r.tx.toLowerCase();
    if (seen.has(id) || !(Number(r.a) >= Math.max(1, card.min)) || Number(r.t) < Math.floor(card.since / 1000)) continue;
    seen.add(id);
    out.push({ id, tx: r.tx, c: Number(r.c), a: Number(r.a), t: Number(r.t), no: String(r.n || '') });
  }
  return out.sort((a, b) => a.t - b.t);
}
/** Where the card stands: stamps checked and not yet used, ones still being checked, and the stamps a reward would use. */
export function cardState(list, { ok = [], bad = [], used = [] } = {}, n) {
  const okS = new Set(ok);
  const badS = new Set(bad);
  const usedS = new Set(used);
  const fresh = list.filter((x) => !usedS.has(x.id));
  const have = fresh.filter((x) => okS.has(x.id));
  return { have: have.length, pending: fresh.filter((x) => !okS.has(x.id) && !badS.has(x.id)).length, full: have.length >= n, next: have.slice(0, n) };
}
/** This phone's record for one store, read defensively. */
export function stampRec(all, pub) {
  const x = all && typeof all === 'object' ? all[pub] : null;
  const ids = (l) => (Array.isArray(l) ? l.filter((v) => /^0x[0-9a-f]{64}$/.test(v)).slice(-600) : []);
  return { ok: ids(x?.ok), bad: ids(x?.bad), used: ids(x?.used), log: (Array.isArray(x?.log) ? x.log : []).filter((e) => e && Number(e.t) > 0).slice(-50) };
}
