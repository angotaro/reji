// The RPC pool: rate limits, hedging, stale nodes, broadcasts, one-endpoint
// sequences, second-source confirmation, endpoint checks. fetch is mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpc, withEndpoint, blockNumber, confirmElsewhere, testEndpoint, maskUrl, setRpcOverrides, ranked, _rpcTest } from '../assets/js/rpc.js';
import { parseOwnerMessage, ownerMessage } from '../assets/js/ownermsg.js';
import { candidates } from '../assets/js/providers.js';
import { csv } from '../assets/js/util.js';

const A = 'https://a.example/rpc';
const B = 'https://b.other/rpc';
const C = 'https://c.third/rpc';
const hits = [];
let behave = {};
const reply = (id, body, status = 200) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const req = JSON.parse(init.body);
  hits.push({ url, method: req.method });
  const b = behave[url] || (() => ({ result: '0x1' }));
  const out = await b(req, init);
  if (out instanceof Response) return out;
  if (out.delay) await new Promise((r, j) => { const t = setTimeout(r, out.delay); init.signal?.addEventListener('abort', () => { clearTimeout(t); j(new Error('aborted')); }); });
  return reply(req.id, out.body || out, out.status || 200);
};
const random = Math.random;
function setup(map) {
  _rpcTest.reset();
  hits.length = 0;
  behave = map;
  Math.random = () => 0.5;
  setRpcOverrides({ 1001: [A, B, C] }); // Kairos: one public endpoint + our three
}
test.after(() => { Math.random = random; });

test('a rate-limited endpoint rests and the next one answers', async () => {
  setup({ [A]: () => new Response('slow down', { status: 429 }), [B]: () => ({ result: '0x2a' }) });
  assert.equal(await rpc(1001, 'eth_chainId', [], { hedge: 0 }), '0x2a');
  assert.equal(_rpcTest.states.get(A).reason, 'limit');
  hits.length = 0;
  await rpc(1001, 'eth_chainId', [], { hedge: 0 });
  assert.notEqual(hits[0].url, A, 'resting endpoint is not asked first');
});

test('a slow endpoint is hedged by the next one', async () => {
  setup({ [A]: () => ({ result: '0x1', delay: 3000 }), [B]: () => ({ result: '0x2' }) });
  const t0 = Date.now();
  assert.equal(await rpc(1001, 'eth_chainId', [], { hedge: 150 }), '0x2');
  assert.ok(Date.now() - t0 < 1500);
});

test('a node behind the chain is skipped', async () => {
  setup({ [A]: () => ({ result: '0x64' }), [B]: () => ({ result: '0xc8' }), [C]: () => ({ result: '0xc8' }) });
  _rpcTest.heads[1001] = 200;
  assert.equal(await blockNumber(1001), 200);
  assert.equal(_rpcTest.states.get(A).reason, 'stale');
});

test('a revert is final: no failover', async () => {
  setup({ [A]: () => ({ error: { code: 3, message: 'execution reverted: nope' } }) });
  await assert.rejects(rpc(1001, 'eth_call', [{}], { hedge: 0 }), /reverted/);
  assert.equal(hits.length, 1);
});

test('broadcast goes to several endpoints; one success is enough', async () => {
  setup({ [A]: () => ({ error: { code: -32000, message: 'nonce too low' } }), [B]: () => ({ result: '0xhash' }), [C]: () => ({ result: '0xhash' }) });
  assert.equal(await rpc(1001, 'eth_sendRawTransaction', ['0x'], { fanout: 3 }), '0xhash');
  assert.ok(hits.length >= 2);
});

test('a sequence stays on one endpoint', async () => {
  setup({});
  const urls = await withEndpoint(1001, async (call, ep) => { await call('eth_blockNumber'); await call('eth_getLogs', [{}]); return ep.url; });
  const used = hits.map((h) => h.url);
  assert.ok(used.every((u) => u === urls));
});

test('second source: ok, mismatch, pending', async () => {
  const log = { address: '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29', topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x' + '11'.padStart(64, '0'), '0x' + '22'.padStart(64, '0')], data: '0x' + (5n).toString(16).padStart(64, '0'), logIndex: '0x0', blockNumber: '0x5', transactionHash: '0xab' };
  const t = { key: '0xab:0', txHash: '0xab', value: 5n, from: '0x' + '11'.padStart(40, '0'), to: '0x' + '22'.padStart(40, '0'), source: A };
  setup({ [B]: () => ({ result: { status: '0x1', logs: [log] } }) });
  assert.equal(await confirmElsewhere(1001, t), 'ok');
  setup({ [B]: () => ({ result: { status: '0x1', logs: [] } }) });
  assert.equal(await confirmElsewhere(1001, t), 'mismatch');
  setup({ [B]: () => ({ result: null }), [C]: () => ({ result: null }), 'https://public-en-kairos.node.kaia.io': () => ({ result: null }) });
  assert.equal(await confirmElsewhere(1001, t), 'pending');
});

test('pasted endpoints are checked for chain and logs', async () => {
  setup({ [A]: (req) => ({ result: req.method === 'eth_chainId' ? '0x89' : req.method === 'eth_blockNumber' ? '0x10' : [] }), [B]: (req) => (req.method === 'eth_getLogs' ? { error: { code: -32601, message: 'method not found' } } : { result: req.method === 'eth_chainId' ? '0x89' : '0x10' }) });
  assert.deepEqual((await testEndpoint(A)).chainId, 137);
  assert.equal((await testEndpoint(A, 1)).reason, 'chain');
  assert.equal((await testEndpoint(B)).reason, 'logs');
  assert.equal((await testEndpoint('http://x')).reason, 'url');
  assert.equal(maskUrl('https://polygon-mainnet.g.alchemy.com/v2/abcdefghijklmnopqrstuvwxyz'), 'polygon-mainnet.g.alchemy.com/v2/abc…xyz');
  assert.ok(candidates('alchemy', 'abcdefghijklmnopqrstuvwx').some(([id, u]) => id === 137 && u.endsWith('/v2/abcdefghijklmnopqrstuvwx')));
  assert.equal(candidates('alchemy', 'short').length, 0);
});

test('owner messages are parsed strictly', () => {
  const m = ownerMessage('verify-owner', '0x' + 'a'.repeat(40), 'abc123xyz0', '喫茶たまご');
  assert.equal(parseOwnerMessage(m).action, 'verify-owner');
  assert.equal(parseOwnerMessage(m.replace('verify-owner', 'send-funds')), null);
  assert.equal(parseOwnerMessage(m + '\nextra'), null);
  assert.equal(parseOwnerMessage('Sign in to example.com'), null);
});

test('CSV cells cannot start formulas', () => {
  const out = csv([['=HYPERLINK("x")', '-5', '@SUM(A1)', 'ok']]);
  assert.ok(out.includes(`"'=HYPERLINK(""x"")"`) && out.includes(',-5,') && out.includes("'@SUM(A1)"));
});
