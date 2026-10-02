// Consumption-tax math for Japanese receipts.
// Tax is rounded down once per rate per receipt, as the qualified-invoice
// rules expect (one rounding per tax rate, not per line).
// Prices are whole yen. JPYC is treated as ¥1 per token.

export const RATES = [10, 8, 0];

/**
 * @param {{price:number, qty:number, tax:number|null}[]} items
 * @param {'incl'|'excl'} mode  incl = prices already include tax (税込)
 */
export function computeTotals(items, mode = 'incl') {
  const groups = new Map();
  let count = 0;
  for (const it of items) {
    const qty = Math.max(0, Math.trunc(it.qty || 0));
    const amount = Math.trunc(it.price || 0) * qty;
    count += qty;
    const key = it.tax == null ? 'na' : Number(it.tax);
    groups.set(key, (groups.get(key) || 0) + amount);
  }
  const byRate = [];
  let total = 0;
  let taxTotal = 0;
  for (const key of [...RATES, 'na']) {
    if (!groups.has(key)) continue;
    const amount = groups.get(key);
    let gross;
    let tax;
    if (key === 'na' || key === 0) {
      gross = amount;
      tax = 0;
    } else if (mode === 'excl') {
      tax = Math.floor((amount * key) / 100);
      gross = amount + tax;
    } else {
      gross = amount;
      tax = Math.floor((amount * key) / (100 + key));
    }
    byRate.push({ rate: key === 'na' ? null : key, gross, tax, net: gross - tax });
    total += gross;
    taxTotal += tax;
  }
  const subtotal = mode === 'excl' ? total - taxTotal : total;
  return { total, taxTotal, subtotal, byRate, count };
}

/** "Coffee ×2, Cake" — short description used in payment links and CSVs. */
export function summarizeItems(items, max = 60, sep = ', ') {
  const s = items.map((i) => (i.qty > 1 ? `${i.name}×${i.qty}` : i.name)).join(sep);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
