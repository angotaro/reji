// The text an owner signs, and a strict parser for it (used by the register,
// the owner's phone page and the tamper check at start-up).
export const OWNER_PREFIX = 'Reji: store owner confirmation';
export const OWNER_ACTIONS = ['verify-owner', 'change-address', 'withdraw-gas', 'show-gas-key', 'accept-tips'];

export function ownerMessage(action, address, code, storeName) {
  const store = String(storeName || '-').replace(/[\r\n]+/g, ' ').trim().slice(0, 80) || '-';
  return [OWNER_PREFIX, `Action: ${action}`, `Store: ${store}`, `Wallet: ${address}`, `Code: ${code}`, `Time: ${new Date().toISOString()}`].join('\n');
}

const RE = /^Reji: store owner confirmation\nAction: ([a-z-]+)\nStore: ([^\n]{1,80})\nWallet: (0x[0-9a-fA-F]{40})\nCode: ([0-9a-z]{6,32})\nTime: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)$/;

export function parseOwnerMessage(m) {
  const x = RE.exec(String(m ?? ''));
  if (!x || !OWNER_ACTIONS.includes(x[1])) return null;
  return { action: x[1], store: x[2], wallet: x[3], code: x[4], time: x[5] };
}
