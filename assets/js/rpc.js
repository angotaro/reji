// JSON-RPC straight from this device to blockchain nodes; no server of ours in between.
//
// Each chain has a pool of endpoints: the store's own (added in Settings) first,
// then free public ones. Endpoints are scored as they are used:
// - speed (moving average) and recent errors decide who is asked first, with a
//   little randomness so traffic spreads over several healthy endpoints;
// - rate limits (HTTP 429 and friends) and failures make an endpoint rest for a
//   while, longer with repeated trouble; nodes lagging behind the chain rest too;
// - slow answers are hedged: after a short wait the next endpoint is asked as
//   well and the first answer wins.
// A payment seen on one endpoint is confirmed on a second, independent one
// before the register marks it paid (see confirmElsewhere).
import { CHAINS, JPYC } from './config.js';
import {
  TRANSFER_TOPIC, addressTopic, toQuantity, fromQuantity, topicToAddress, encodeBalanceOf, sameAddress,
} from './evm.js';

const RANGE_RE = /block range|range (is )?too (large|wide|big)|max(imum)? (block )?range|more than \d+ (results|logs|blocks)|query returned more|too many (blocks|results|logs)|exceed(s|ed)?[^.]{0,30}range|response (size|is too large)|limited to \d+/i;
const LIMIT_RE = /rate.?limit|too many requests|request limit|exceeded[^.]{0,30}(quota|limit|capacity|credits)|capacity|throttl|daily|monthly|compute units|429/i;
const NODE_RE = /revert|nonce|already known|underpriced|insufficient funds|invalid (sender|signature)|intrinsic gas|gas too low/i;
const HEDGE = { eth_getLogs: 2500, eth_getTransactionReceipt: 1500, eth_sendRawTransaction: 0 };

let custom = {};
const states = new Map(); // url -> endpoint state
const heads = {}; // chainId -> highest block seen on any endpoint
let seq = 0;

/** The store's own endpoints: { [chainId]: [url, ...] } (older builds stored one url per chain). */
export function setRpcOverrides(map) {
  const next = {};
  for (const [id, v] of Object.entries(map || {})) {
    const list = (Array.isArray(v) ? v : [v]).map((u) => String(u || '').trim()).filter((u) => /^https:\/\/\S+$/i.test(u) && u.length < 400);
    if (list.length) next[id] = [...new Set(list)].slice(0, 3);
  }
  custom = next;
}

function stateFor(url, chainId, mine, order) {
  let s = states.get(url);
  if (!s) {
    s = { url, chainId, lat: 600 + order * 80, ok: 0, fail: 0, streak: 0, restUntil: 0, reason: '', inflight: 0, lastOk: 0, head: 0, maxRange: 2000 };
    states.set(url, s);
  }
  s.custom = mine;
  return s;
}

export function endpoints(chainId) {
  const mine = (custom[chainId] || []).map((u, i) => stateFor(u, chainId, true, i));
  const pub = (CHAINS[chainId]?.rpc || []).filter((u) => !mine.some((m) => m.url === u)).map((u, i) => stateFor(u, chainId, false, i));
  return [...mine, ...pub];
}
export const rpcUrls = (chainId) => endpoints(chainId).map((e) => e.url);

function cost(e, now) {
  const resting = e.restUntil > now ? 1e7 + (e.restUntil - now) : 0;
  return resting + (e.custom ? 0 : 250) + e.lat * (1 + e.streak) * (0.85 + Math.random() * 0.5) + e.inflight * 250;
}
export function ranked(chainId) {
  const now = Date.now();
  return endpoints(chainId).map((e) => [cost(e, now), e]).sort((a, b) => a[0] - b[0]).map(([, e]) => e);
}

const rest = (e, ms, reason) => { e.restUntil = Date.now() + ms; e.reason = reason; };
function answered(e, t0) {
  e.lat = e.lat * 0.7 + (performance.now() - t0) * 0.3;
  e.ok++;
  e.streak = 0;
  e.lastOk = Date.now();
  e.restUntil = 0;
  e.reason = '';
}
function trouble(e, why) {
  e.fail++;
  e.streak++;
  if (e.streak >= 2) rest(e, Math.min(120_000, 4000 * 2 ** (e.streak - 2)), 'down');
  return Object.assign(new Error(why), { transport: true });
}
function limited(e, err) {
  e.fail++;
  e.streak++;
  rest(e, Math.min(300_000, 15_000 * 2 ** Math.min(e.streak - 1, 4)), 'limit');
  return Object.assign(err, { transport: true });
}

async function send(e, method, params, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const t0 = performance.now();
  e.inflight++;
  try {
    let res;
    try {
      res = await fetch(e.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
        signal: ctrl.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
    } catch (err) {
      throw trouble(e, ctrl.signal.aborted ? 'timeout' : `network: ${err?.message || err}`);
    }
    if (res.status === 429 || res.status === 402) throw limited(e, new Error(`HTTP ${res.status}`));
    if (res.status === 401 || res.status === 403) {
      e.fail++;
      rest(e, 30 * 60_000, 'denied');
      throw Object.assign(new Error(`HTTP ${res.status}`), { transport: true });
    }
    if (!res.ok) throw trouble(e, `HTTP ${res.status}`);
    let body;
    try { body = await res.json(); } catch { throw trouble(e, 'bad response'); }
    if (Array.isArray(body)) body = body[0];
    if (body?.error) {
      const msg = String(body.error.message || 'RPC error');
      const err = Object.assign(new Error(msg), { code: body.error.code });
      const range = RANGE_RE.test(msg);
      if (!range && (LIMIT_RE.test(msg) || body.error.code === -32005)) throw limited(e, err);
      answered(e, t0); // the node answered; the request itself was refused
      err.range = range;
      err.fromNode = NODE_RE.test(msg);
      throw err;
    }
    if (!body || !('result' in body)) throw trouble(e, 'bad response');
    answered(e, t0);
    return body.result;
  } finally {
    clearTimeout(timer);
    e.inflight--;
  }
}

/**
 * One JSON-RPC call on `chainId`. Options: pin (a single endpoint), hedge (ms before
 * also asking the next endpoint; 0 = never), fanout (ask N endpoints at once, e.g. to
 * broadcast a transaction), check(result, endpoint) (throw to reject an answer).
 */
export function rpc(chainId, method, params = [], { timeout = 8000, hedge, pin, fanout = 1, check } = {}) {
  const list = pin ? [pin] : ranked(chainId);
  if (!list.length) return Promise.reject(new Error(`No RPC for chain ${chainId}`));
  const wait = hedge ?? HEDGE[method] ?? 1500;
  return new Promise((resolve, reject) => {
    let next = 0;
    let active = 0;
    let settled = false;
    let lastErr = null;
    const finish = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const launch = () => {
      if (settled) return;
      if (next >= list.length) {
        if (!active) finish(reject, lastErr || new Error('No RPC endpoint answered'));
        return;
      }
      const e = list[next++];
      active++;
      const h = wait > 0 && next < list.length ? setTimeout(launch, wait) : null;
      send(e, method, params, timeout)
        .then((res) => { check?.(res, e); return res; })
        .then((res) => {
          active--;
          clearTimeout(h);
          finish(resolve, res);
        }, (err) => {
          active--;
          clearTimeout(h);
          if (settled) return;
          if (err.fromNode || err.range) {
            lastErr = err; // deterministic answer; still let a parallel attempt succeed
            if (!active) finish(reject, err);
            return;
          }
          if (!lastErr?.fromNode) lastErr = err;
          launch();
        });
    };
    for (let i = 0; i < Math.max(1, Math.min(fanout, list.length)); i++) launch();
  });
}

/** Run a sequence of calls against ONE endpoint (consistent view); retries on the next endpoint. */
export async function withEndpoint(chainId, fn, tries = 3) {
  let lastErr;
  for (const e of ranked(chainId).slice(0, tries)) {
    try {
      return await fn((method, params = [], o = {}) => rpc(chainId, method, params, { ...o, pin: e, hedge: 0 }), e);
    } catch (err) {
      if (err.fromNode) throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error(`No RPC for chain ${chainId}`);
}

const lagBlocks = (chainId) => Math.max(20, Math.ceil(60 / (CHAINS[chainId]?.blockTime || 2)));
function headCheck(chainId) {
  return (res, e) => {
    const n = Number(fromQuantity(res));
    const top = heads[chainId] || 0;
    if (top && n < top - lagBlocks(chainId)) {
      rest(e, 60_000, 'stale');
      throw Object.assign(new Error('node is behind the chain'), { transport: true });
    }
    if (n > top && (!top || n < top + 1_000_000)) heads[chainId] = n;
    e.head = n;
  };
}

export async function blockNumber(chainId, call) {
  const o = { check: headCheck(chainId) };
  return Number(fromQuantity(await (call ? call('eth_blockNumber', [], o) : rpc(chainId, 'eth_blockNumber', [], o))));
}

const normalizeLog = (l) => ({
  key: `${l.transactionHash}:${Number(fromQuantity(l.logIndex))}`,
  txHash: l.transactionHash,
  logIndex: Number(fromQuantity(l.logIndex)),
  blockNumber: Number(fromQuantity(l.blockNumber)),
  from: topicToAddress(l.topics[1]),
  to: topicToAddress(l.topics[2]),
  value: fromQuantity(l.data),
});

/** JPYC Transfer logs into `to` within [fromBlock, toBlock]; splits ranges when a node refuses. */
export async function scanTransfers(chainId, to, fromBlock, toBlock, { chunk = 500, maxChunks = 200, onProgress, call, ep } = {}) {
  const ask = call || ((m, p) => rpc(chainId, m, p));
  const out = [];
  let start = fromBlock;
  let size = Math.min(chunk, ep?.maxRange || chunk);
  let chunks = 0;
  while (start <= toBlock) {
    if (++chunks > maxChunks) throw new Error('Range too large');
    const end = Math.min(toBlock, start + size - 1);
    try {
      const logs = await ask('eth_getLogs', [{
        address: JPYC.address,
        topics: [TRANSFER_TOPIC, null, addressTopic(to)],
        fromBlock: toQuantity(start),
        toBlock: toQuantity(end),
      }]);
      if (!Array.isArray(logs)) throw new Error('bad logs');
      for (const l of logs) {
        if (l.removed || !sameAddress(l.address, JPYC.address) || !l.topics || l.topics.length < 3) continue;
        if (!sameAddress(topicToAddress(l.topics[2]), to)) continue;
        out.push(normalizeLog(l));
      }
      start = end + 1;
      onProgress?.(start, toBlock);
    } catch (e) {
      if (!e.range || size <= 10) throw e;
      size = Math.max(10, Math.floor(size / 4));
      if (ep) ep.maxRange = size;
    }
  }
  return out;
}

export async function tokenBalance(chainId, owner) {
  return fromQuantity(await rpc(chainId, 'eth_call', [{ to: JPYC.address, data: encodeBalanceOf(owner) }, 'latest']));
}

export async function nativeBalance(chainId, owner) {
  return fromQuantity(await rpc(chainId, 'eth_getBalance', [owner, 'latest']));
}

export const txReceipt = (chainId, hash) => rpc(chainId, 'eth_getTransactionReceipt', [hash]);

/** JPYC transfers into `to` contained in a transaction receipt. */
export function transfersInReceipt(receipt, to) {
  if (!receipt?.logs) return [];
  return receipt.logs
    .filter((l) => sameAddress(l.address, JPYC.address) && l.topics?.[0] === TRANSFER_TOPIC && l.topics.length >= 3)
    .map(normalizeLog)
    .filter((t) => !to || sameAddress(t.to, to));
}

const site = (u) => { try { return new URL(u).hostname.split('.').slice(-2).join('.'); } catch { return u; } };

/**
 * Ask a different provider for the transaction behind transfer `t` (found via t.source).
 * 'ok' | 'mismatch' (another node disagrees) | 'pending' (others don't have it yet) |
 * 'unavailable' (nobody else answered) | 'single' (only one provider configured).
 */
export async function confirmElsewhere(chainId, t) {
  const src = t.source ? site(t.source) : '';
  const others = ranked(chainId).filter((e) => site(e.url) !== src);
  if (!others.length) return 'single';
  let pending = false;
  for (const e of others.slice(0, 3)) {
    try {
      const rc = await rpc(chainId, 'eth_getTransactionReceipt', [t.txHash], { pin: e, hedge: 0, timeout: 6000 });
      if (!rc) { pending = true; continue; }
      if (rc.status !== '0x1') return 'mismatch';
      return transfersInReceipt(rc, t.to).some((x) => x.key === t.key && x.value === t.value && sameAddress(x.from, t.from)) ? 'ok' : 'mismatch';
    } catch { /* ask the next one */ }
  }
  return pending ? 'pending' : 'unavailable';
}

/** Warm up the scores: one cheap call to every endpoint of a chain. */
export function probe(chainId) {
  return Promise.all(endpoints(chainId).map((e) => rpc(chainId, 'eth_blockNumber', [], { pin: e, hedge: 0, timeout: 5000, check: headCheck(chainId) }).catch(() => null)));
}

export function rpcStatus(chainId) {
  const now = Date.now();
  return endpoints(chainId).map((e) => ({
    url: e.url,
    custom: e.custom,
    lat: Math.round(e.lat),
    ok: e.ok,
    fail: e.fail,
    state: e.restUntil > now ? e.reason || 'down' : e.ok && e.streak === 0 ? 'ok' : e.fail ? 'down' : 'idle',
    restFor: Math.max(0, e.restUntil - now),
  }));
}

/** Check a URL the owner pasted: which chain, how fast, and whether it can read logs. */
export async function testEndpoint(url, expect) {
  if (!/^https:\/\/\S+$/i.test(url || '')) return { ok: false, reason: 'url' };
  const e = { url, lat: 0, ok: 0, fail: 0, streak: 0, restUntil: 0, reason: '', inflight: 0 };
  try {
    const t0 = performance.now();
    const chainId = Number(fromQuantity(await send(e, 'eth_chainId', [], 8000)));
    const head = Number(fromQuantity(await send(e, 'eth_blockNumber', [], 8000)));
    const ms = Math.round((performance.now() - t0) / 2);
    if (expect && chainId !== expect) return { ok: false, reason: 'chain', chainId, ms };
    if (!CHAINS[chainId]) return { ok: false, reason: 'unsupported', chainId, ms };
    try {
      await send(e, 'eth_getLogs', [{ address: JPYC.address, topics: [TRANSFER_TOPIC], fromBlock: toQuantity(Math.max(0, head - 20)), toBlock: toQuantity(head) }], 10000);
    } catch {
      return { ok: false, reason: 'logs', chainId, ms };
    }
    return { ok: true, chainId, head, ms };
  } catch (err) {
    return { ok: false, reason: /HTTP 40[13]/.test(err.message) ? 'denied' : 'unreachable' };
  }
}

/** Hide API keys when showing an endpoint. */
export function maskUrl(u) {
  try {
    const x = new URL(u);
    const hide = (s) => s.replace(/[A-Za-z0-9_-]{16,}/g, (k) => `${k.slice(0, 3)}…${k.slice(-3)}`);
    return x.hostname + hide(x.pathname === '/' ? '' : x.pathname) + hide(x.search);
  } catch {
    return '?';
  }
}

export const _rpcTest = { states, heads, reset() { states.clear(); for (const k of Object.keys(heads)) delete heads[k]; } };

/**
 * Polls one chain for JPYC transfers into `to`. Each round reads the head and the
 * logs from the SAME endpoint, re-scans a few blocks of overlap so lagging nodes and
 * tiny reorgs don't cause misses, and drops duplicates by (txHash, logIndex).
 */
export class Watcher {
  constructor({ chainId, to, startBlock = null, createdAt = Date.now(), onTransfer, onState, onStart }) {
    Object.assign(this, { chainId, to, startBlock, createdAt, onTransfer, onState, onStart });
    this.interval = CHAINS[chainId]?.poll || 3000;
    this.seen = new Set();
    this.scanned = null;
    this.fail = 0;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  async loop() {
    if (!this.running) return;
    try {
      await withEndpoint(this.chainId, async (call, ep) => {
        const latest = await blockNumber(this.chainId, call);
        if (this.startBlock == null) {
          // If the first successful call comes late (RPC outage), rewind by elapsed time.
          const bt = CHAINS[this.chainId]?.blockTime || 2;
          const elapsed = Math.ceil((Date.now() - this.createdAt) / 1000 / bt);
          this.startBlock = Math.max(0, latest - elapsed - 3);
          this.onStart?.(this.startBlock);
        }
        const OVERLAP = 8;
        const from = this.scanned == null ? this.startBlock : Math.max(this.startBlock, this.scanned - OVERLAP + 1);
        if (latest >= from) {
          const found = await scanTransfers(this.chainId, this.to, from, latest, { call, ep });
          for (const t of found) {
            if (this.seen.has(t.key)) continue;
            this.seen.add(t.key);
            if (!this.running) break;
            t.source = ep.url;
            this.onTransfer?.(t, this);
          }
          this.scanned = Math.max(this.scanned ?? 0, latest);
        }
        this.latest = latest;
      });
      this.fail = 0;
      this.onState?.('ok', this);
    } catch (e) {
      this.fail++;
      this.lastError = e;
      this.onState?.('error', this);
    }
    if (!this.running) return;
    const delay = this.fail ? Math.min(20000, this.interval * 2 ** Math.min(this.fail, 3)) : this.interval;
    this.timer = setTimeout(() => this.loop(), delay);
  }
}
