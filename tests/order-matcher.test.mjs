// Tests for docs/examples/order-matcher.mjs against a stand-in chain with two public nodes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { OrderMatcher } from '../docs/examples/order-matcher.mjs';

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const UNIT = 10n ** 18n;
const hex = (n) => '0x' + BigInt(n).toString(16);
const pad = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
let txn = 0;

/** A chain shared by two nodes; a node can "lag" by hiding transactions. */
async function makeChain() {
  const chain = { head: 1000, logs: [] };
  const node = async () => {
    const n = { hide: new Set() };
    const srv = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        const { id, method, params } = JSON.parse(b);
        let result = null;
        if (method === 'eth_blockNumber') result = hex(chain.head);
        if (method === 'eth_getLogs') {
          const f = params[0], lo = parseInt(f.fromBlock, 16), hi = parseInt(f.toBlock, 16);
          result = chain.logs.filter((l) => l.block >= lo && l.block <= hi && pad(l.to) === f.topics[2] && !n.hide.has(l.tx))
            .map((l) => ({ removed: false, data: hex(l.value), blockNumber: hex(l.block), transactionHash: l.tx, logIndex: hex(l.i), topics: [TRANSFER, pad(l.from), pad(l.to)] }));
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    n.url = `http://127.0.0.1:${srv.address().port}`;
    n.close = () => srv.close();
    return n;
  };
  const a = await node(), b = await node();
  /** A transfer mined in the next block (or `at`). */
  const pay = (to, value, at = chain.head + 1) => {
    const tx = '0x' + (++txn).toString(16).padStart(64, '0');
    chain.logs.push({ to, from: '0x' + '22'.repeat(20), value, block: at, tx, i: 0 });
    chain.head = Math.max(chain.head, at + 1);
    return tx;
  };
  return { chain, a, b, pay, close: () => { a.close(); b.close(); } };
}
const store = (n) => '0x' + String(n).repeat(40).slice(0, 40);
const soon = () => Date.now() + 15 * 60_000;

test('order matcher: an exact payment pays its order once; the same transfer never pays a second order', async () => {
  const c = await makeChain();
  try {
    const m = new OrderMatcher({ chainId: 137, rpcs: [c.a.url, c.b.url] });
    const o1 = await m.open({ id: 'A-1', to: store(1), yen: 500, expiresAt: soon() });
    c.pay(store(1), 500n * UNIT + BigInt(o1.suffix));
    await m.poll();
    assert.equal(o1.status, 'paid');
    const o2 = await m.open({ id: 'A-2', to: store(1), yen: 500, expiresAt: soon() });
    await m.poll();
    assert.equal(o2.status, 'open'); // the transfer was used, and it predates this order anyway
  } finally { c.close(); }
});

test('order matcher: a payment without the fraction is taken only when exactly one open order has that amount', async () => {
  const c = await makeChain();
  try {
    const unmatched = [];
    const m = new OrderMatcher({ chainId: 137, rpcs: [c.a.url, c.b.url], onUnmatched: (t) => unmatched.push(t) });
    const o3 = await m.open({ id: 'B-1', to: store(2), yen: 700, expiresAt: soon() });
    c.pay(store(2), 700n * UNIT);
    await m.poll();
    assert.equal(o3.status, 'paid');
    const o4 = await m.open({ id: 'B-2', to: store(2), yen: 900, expiresAt: soon() });
    const o5 = await m.open({ id: 'B-3', to: store(2), yen: 900, expiresAt: soon() });
    c.pay(store(2), 900n * UNIT);
    await m.poll();
    assert.equal(o4.status, 'open');
    assert.equal(o5.status, 'open');
    assert.equal(unmatched.length, 1);
    assert.equal(unmatched[0].value, 900n * UNIT);
  } finally { c.close(); }
});

test('order matcher: a payment mined before the order was opened is never taken', async () => {
  const c = await makeChain();
  try {
    c.pay(store(3), 1200n * UNIT); // the previous customer's payment
    c.chain.head += 20;
    const m = new OrderMatcher({ chainId: 137, rpcs: [c.a.url, c.b.url] });
    const o6 = await m.open({ id: 'C-1', to: store(3), yen: 1200, expiresAt: soon() });
    await m.poll();
    assert.equal(o6.status, 'open');
  } finally { c.close(); }
});

test('order matcher: when the second node lags, the order waits and is confirmed on a later pass', async () => {
  const c = await makeChain();
  try {
    const m = new OrderMatcher({ chainId: 137, rpcs: [c.a.url, c.b.url] });
    const o7 = await m.open({ id: 'D-1', to: store(4), yen: 300, expiresAt: soon() });
    const tx = c.pay(store(4), 300n * UNIT + BigInt(o7.suffix));
    c.b.hide.add(tx);
    await m.poll();
    assert.equal(o7.status, 'confirming');
    c.b.hide.delete(tx);
    await m.poll();
    assert.equal(o7.status, 'paid');
    assert.equal(o7.payment.txHash, tx);
  } finally { c.close(); }
});

test('order matcher: unpaid orders expire after the grace period; a later payment goes to review', async () => {
  const c = await makeChain();
  try {
    const unmatched = [];
    const m = new OrderMatcher({ chainId: 137, rpcs: [c.a.url, c.b.url], onUnmatched: (t) => unmatched.push(t) });
    const o8 = await m.open({ id: 'E-1', to: store(5), yen: 800, expiresAt: Date.now() - 10 * 60_000 });
    const keep = await m.open({ id: 'E-2', to: store(5), yen: 50, expiresAt: soon() }); // keeps the store being scanned
    await m.poll();
    assert.equal(o8.status, 'expired');
    c.pay(store(5), 800n * UNIT + BigInt(o8.suffix));
    await m.poll();
    assert.equal(o8.status, 'expired');
    assert.equal(unmatched.length, 1);
    assert.equal(keep.status, 'open');
  } finally { c.close(); }
});

test('order matcher: open orders of the same store and amount always get different fractions', async () => {
  const c = await makeChain();
  try {
    const m = new OrderMatcher({ chainId: 137, rpcs: [c.a.url, c.b.url] });
    const orders = [];
    for (let i = 0; i < 50; i++) orders.push(await m.open({ id: `F-${i}`, to: store(6), yen: 100, expiresAt: soon() }));
    assert.equal(new Set(orders.map((o) => o.suffix)).size, 50);
    assert.ok(orders.every((o) => o.suffix >= 1 && o.suffix <= 999_999));
  } finally { c.close(); }
});
