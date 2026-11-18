// 売り切れと在庫: a menu item is sold out when the store says so, or when its counted stock reaches 0.
// The count is optional (null = not counted) and lives on this register only.
export const STOCK_MAX = 9999;
export const cleanStock = (v) => (v === null || v === undefined || v === '' ? null : (Number.isInteger(Number(v)) && Number(v) >= 0 ? Math.min(Number(v), STOCK_MAX) : null));
export const soldOut = (p) => !!p && (p.out === true || p.stock === 0);
/** May one more go into the cart, which already holds `qtyInCart` of it? */
export const canAdd = (p, qtyInCart = 0) => !!p && !soldOut(p) && (p.stock == null || qtyInCart < p.stock);
/** What left the store with one charge: [{ pid, qty }] from the cart lines that came from the menu. */
export function stockLines(cart) {
  const m = new Map();
  for (const l of Array.isArray(cart) ? cart : []) if (l && l.pid && l.qty > 0) m.set(l.pid, (m.get(l.pid) || 0) + l.qty);
  return [...m].map(([pid, qty]) => ({ pid, qty }));
}
/** The menu after those goods left: each counted item loses what was sold, never below 0. Uncounted items are untouched. */
export function afterSale(products, lines) {
  const q = new Map((Array.isArray(lines) ? lines : []).map((l) => [l.pid, Number(l.qty) || 0]));
  return products.map((p) => (p.stock != null && q.get(p.id) > 0 ? { ...p, stock: Math.max(0, p.stock - q.get(p.id)) } : p));
}
/** Which items the public page should show as sold out, as a string to compare before and after. */
export const outKey = (products) => products.filter(soldOut).map((p) => p.id).sort().join(',');
