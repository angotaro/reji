// order-matcher.mjs: a reference for matching many orders, across many stores, against JPYC transfers.
// 多数の注文を、複数のお店あてのJPYC送金とまとめて照合する参考実装です。
// State lives in memory here. In production, keep orders, used transfers, scan cursors and pending
// checks in your database. No dependencies: Node 18+ or a modern browser.
const JPYC = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29'; // the same address on every supported chain
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // Transfer(address,address,uint256)
const UNIT = 10n ** 18n; // JPYC has 18 decimals
const hex = (n) => '0x' + n.toString(16);
const lower = (a) => String(a).toLowerCase();

async function rpc(url, method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

export const latestBlock = async (url) => Number(await rpc(url, 'eth_blockNumber', []));

/** Every JPYC transfer to `to` in [fromBlock, toBlock], 500 blocks per query (public nodes limit ranges). */
export async function scanTransfers({ url, to, fromBlock, toBlock }) {
  const topicTo = '0x' + lower(to).replace(/^0x/, '').padStart(64, '0');
  const out = [];
  for (let start = fromBlock; start <= toBlock; start += 500) {
    const end = Math.min(start + 499, toBlock);
    const logs = await rpc(url, 'eth_getLogs', [{ address: JPYC, topics: [TRANSFER, null, topicTo], fromBlock: hex(start), toBlock: hex(end) }]);
    for (const l of logs) {
      if (!l.removed) out.push({ txHash: lower(l.transactionHash), logIndex: Number(l.logIndex), from: '0x' + l.topics[1].slice(26), value: BigInt(l.data), block: Number(l.blockNumber) });
    }
  }
  return out;
}

export class OrderMatcher {
  /** rpcs: two different public nodes for the same chain.
   *  onUnmatched(transfer, store): a transfer no open order can take (wrong amount, too late, ambiguous): review it by hand. */
  constructor({ chainId, rpcs, graceMs = 5 * 60_000, onUnmatched = () => {} }) {
    Object.assign(this, { chainId, rpcs, graceMs, onUnmatched });
    this.orders = new Map(); // order id → order
    this.used = new Set(); // `${chainId}:${txHash}:${logIndex}`: each transfer pays one order, once
    this.cursor = new Map(); // store address → next block to scan
    this.pending = []; // matched transfers the second node hasn't confirmed yet
  }

  /** Opens an order. Its fraction differs from every other open order of the same store and amount. */
  async open({ id, to, yen, expiresAt }) {
    if (this.orders.has(id)) throw new Error(`order ${id} already exists`);
    const store = lower(to);
    const taken = new Set([...this.orders.values()].filter((o) => o.status === 'open' && o.store === store && o.yen === yen).map((o) => o.suffix));
    let suffix;
    do suffix = 1 + Math.floor(Math.random() * 999_999); while (taken.has(suffix));
    const fromBlock = (await latestBlock(this.rpcs[0])) - 5; // a little before now
    if (!this.cursor.has(store)) this.cursor.set(store, fromBlock);
    const order = { id, store, to, yen, suffix, expiresAt, fromBlock, status: 'open', payment: null };
    this.orders.set(id, order);
    return order; // build the payment link from order.to, order.yen and order.suffix
  }

  /** One pass (every 10 seconds or so): retry pending confirmations, scan new blocks for each store with
   *  open orders, then expire orders whose time and grace period have passed. */
  async poll(now = Date.now()) {
    const still = [];
    for (const p of this.pending) if (!(await this.#confirm(p))) still.push(p);
    this.pending = still;
    const head = await latestBlock(this.rpcs[0]);
    for (const [store, from] of [...this.cursor]) {
      if (![...this.orders.values()].some((o) => o.status === 'open' && o.store === store)) {
        this.cursor.delete(store); // nothing open for this store: stop scanning it
        continue;
      }
      if (from > head) continue;
      const transfers = await scanTransfers({ url: this.rpcs[0], to: store, fromBlock: from, toBlock: head });
      this.cursor.set(store, head + 1);
      for (const t of transfers) await this.#match(store, t);
    }
    for (const o of this.orders.values()) if (o.status === 'open' && now > o.expiresAt + this.graceMs) o.status = 'expired';
  }

  async #match(store, t) {
    if (this.used.has(this.#key(t))) return;
    const open = [...this.orders.values()].filter((o) => o.status === 'open' && o.store === store && t.block >= o.fromBlock);
    let order = open.find((o) => t.value === BigInt(o.yen) * UNIT + BigInt(o.suffix));
    if (!order && t.value % UNIT === 0n) { // copy-and-send payments arrive without the fraction:
      const same = open.filter((o) => BigInt(o.yen) * UNIT === t.value);
      if (same.length === 1) order = same[0]; // take them only when exactly one open order has that amount
    }
    if (!order) return this.onUnmatched(t, store);
    order.status = 'confirming'; // reserved: no other transfer can take it, and it won't expire while being checked
    this.used.add(this.#key(t));
    const p = { order, t, tries: 0 };
    if (!(await this.#confirm(p))) this.pending.push(p);
  }

  async #confirm(p) {
    const seen = await scanTransfers({ url: this.rpcs[1], to: p.order.store, fromBlock: p.t.block, toBlock: p.t.block }).catch(() => []);
    if (seen.some((x) => x.txHash === p.t.txHash && x.logIndex === p.t.logIndex && x.value === p.t.value)) {
      p.order.status = 'paid';
      p.order.payment = p.t;
      return true;
    }
    if (++p.tries >= 30) { // the second node never saw it: put the order back and check by hand
      p.order.status = 'open';
      this.used.delete(this.#key(p.t));
      this.onUnmatched(p.t, p.order.store);
      return true;
    }
    return false;
  }

  #key(t) {
    return `${this.chainId}:${t.txHash}:${t.logIndex}`;
  }
}
