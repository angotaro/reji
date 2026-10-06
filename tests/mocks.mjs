// Shared test doubles: a mocked blockchain (JSON-RPC), a mocked Nostr relay
// network and wallets that really sign with test keys. No network, no funds.
import { addressOf, privateKeyFromHex, domainSeparator, toHex, hexToBytes, TWA_SELECTOR, schnorrVerify, sha256, randomPrivateKey } from '../assets/js/secp256k1.js';
import { makeEvent } from '../assets/js/nostr.js';
import { checksum } from '../assets/js/evm.js';
import { keccak256, bytesToHex } from '../assets/js/keccak.js';

export const JPYC = '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29';
export const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const MERCHANT_KEY = '0x' + '5a'.repeat(32);
export const CUSTOMER_KEY = '0x' + 'c0'.repeat(32);
export const MERCHANT = checksum(addressOf(privateKeyFromHex(MERCHANT_KEY)));
export const CUSTOMER = checksum(addressOf(privateKeyFromHex(CUSTOMER_KEY)));
export const PAYER = '0x1111111111111111111111111111111111111111';
export const UNIT = 10n ** 18n;
export const pad = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
export const hex = (n) => '0x' + BigInt(n).toString(16);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const chain = { block: 5_000_000, logs: [], receipts: {}, sent: [] };
const DOMAIN = toHex(domainSeparator({ name: 'JPY Coin', version: '1', chainId: 137, verifyingContract: JPYC }));
const NAME = '0x' + '20'.padStart(64, '0') + '8'.padStart(64, '0') + Buffer.from('JPY Coin').toString('hex').padEnd(64, '0');

export function addTransfer({ from = PAYER, to = MERCHANT, value, tx, ahead = 2 }) {
  const block = chain.block + ahead;
  const log = {
    address: JPYC, topics: [TOPIC, pad(from), pad(to)], data: '0x' + BigInt(value).toString(16).padStart(64, '0'),
    blockNumber: hex(block), transactionHash: tx, logIndex: '0x0', removed: false,
  };
  chain.logs.push(log);
  chain.receipts[tx] = { status: '0x1', blockNumber: hex(block), transactionHash: tx, logs: [log] };
}

/** A relayed transaction "mines": a TWA call becomes a Transfer log. */
function onRawTx(raw) {
  const hash = toHex(keccak256(hexToBytes(raw)));
  const h = raw.slice(2);
  const at = h.indexOf(TWA_SELECTOR.slice(2));
  const word = (i) => h.slice(at + 8 + 64 * i, at + 8 + 64 * (i + 1));
  const twa = at > 0 ? { from: '0x' + word(0).slice(24), to: '0x' + word(1).slice(24), value: BigInt('0x' + word(2)) } : null;
  chain.sent.push({ raw, hash, twa });
  if (twa) addTransfer({ ...twa, tx: hash, ahead: 1 });
  else chain.receipts[hash] = { status: '0x1', blockNumber: hex(chain.block + 1), transactionHash: hash, logs: [] };
  return hash;
}

export async function mockRpc(ctx) {
  await ctx.route(/^https:\/\/fonts\./, (r) => r.abort());
  await ctx.route(/^https:\/\/(?!fonts\.)/, async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() !== 'POST') return route.abort();
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch { return route.abort(); }
    const polygon = /polygon|matic/.test(req.url());
    let result = null;
    let error = null;
    switch (body.method) {
      case 'eth_blockNumber': chain.block += 1; result = hex(chain.block); break;
      case 'eth_chainId': result = '0x89'; break;
      case 'eth_getLogs': {
        const f = body.params[0];
        const a = parseInt(f.fromBlock, 16);
        const b = parseInt(f.toBlock, 16);
        result = polygon ? chain.logs.filter((l) => { const n = parseInt(l.blockNumber, 16); return n >= a && n <= b && l.topics[2] === f.topics[2]; }) : [];
        break;
      }
      case 'eth_getTransactionReceipt': result = chain.receipts[body.params[0]] || null; break;
      case 'eth_call': {
        const data = String(body.params[0].data || '');
        if (data === '0x3644e515') result = DOMAIN;
        else if (data === '0x06fdde03') result = NAME;
        else if (data.startsWith(TWA_SELECTOR)) result = '0x';
        else if (data.startsWith('0xe94a0102')) result = '0x' + '0'.repeat(64); // authorizationState
        else result = '0x' + (5000n * UNIT).toString(16).padStart(64, '0');
        break;
      }
      case 'eth_getBalance': result = hex(UNIT); break;
      case 'eth_getBlockByNumber': result = { number: hex(chain.block), timestamp: hex(Math.floor(Date.now() / 1000)), baseFeePerGas: hex(40n * 10n ** 9n) }; break;
      case 'eth_estimateGas': result = '0x15f90'; break;
      case 'eth_maxPriorityFeePerGas': result = hex(31n * 10n ** 9n); break;
      case 'eth_getTransactionCount': result = '0x0'; break;
      case 'eth_sendRawTransaction': result = onRawTx(body.params[0]); break;
      default: result = null;
    }
    const payload = error ? { jsonrpc: '2.0', id: body.id, error } : { jsonrpc: '2.0', id: body.id, result };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(payload) });
  });
}

// ---- Nostr: one in-process "relay" shared by every browser context ----
export const hub = { subs: [], events: [], bad: 0, forge: false, forgePub: '', forged: 0 };
function matches(filter, ev) {
  if (filter.kinds && !filter.kinds.includes(ev.kind)) return false;
  if (filter.authors && !filter.authors.includes(ev.pubkey)) return false;
  for (const [k, vals] of Object.entries(filter)) {
    if (k[0] !== '#') continue;
    if (!ev.tags.some((t) => t[0] === k.slice(1) && vals.includes(t[1]))) return false;
  }
  return true;
}
async function validEvent(ev) {
  const id = bytesToHex(await sha256(new TextEncoder().encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))));
  return id === ev.id && (await schnorrVerify(ev.pubkey, hexToBytes(ev.id), ev.sig));
}
export async function mockNostr(ctx) {
  await ctx.routeWebSocket(/^wss:\/\//, (ws) => {
    ws.onMessage(async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg[0] === 'REQ') {
        hub.subs.push({ ws, id: msg[1], filter: msg[2] });
        for (const e of hub.events.filter((x) => x.kind >= 30000 && x.kind < 40000 && matches(msg[2], x))) ws.send(JSON.stringify(['EVENT', msg[1], e]));
        ws.send(JSON.stringify(['EOSE', msg[1]]));
      } else if (msg[0] === 'CLOSE') {
        hub.subs = hub.subs.filter((s) => !(s.ws === ws && s.id === msg[1]));
      } else if (msg[0] === 'EVENT') {
        const ev = msg[1];
        if (!(await validEvent(ev))) {
          hub.bad += 1;
          ws.send(JSON.stringify(['OK', ev.id, false, 'invalid: bad signature']));
          return;
        }
        if (ev.kind >= 30000 && ev.kind < 40000) { // replaceable: keep only the newest per author and d-tag
          const d = ev.tags.find((x) => x[0] === 'd')?.[1] || '';
          hub.events = hub.events.filter((e) => !(e.kind === ev.kind && e.pubkey === ev.pubkey && (e.tags.find((x) => x[0] === 'd')?.[1] || '') === d));
        }
        if (!hub.events.some((e) => e.id === ev.id)) hub.events.push(ev);
        if (hub.forge && ev.kind === 29385) {
          // A hostile relay: answers every no-fee request with a fake "failed", ignoring filters.
          const tag = ev.tags.find((x) => x[0] === 't')?.[1];
          const fake = await makeEvent(randomPrivateKey(), 29386, [['t', tag], ['e', ev.id]], JSON.stringify({ error: 'rejected' }));
          const imposter = { ...fake, pubkey: hub.forgePub || fake.pubkey, id: 'f'.repeat(64) };
          for (const f of [fake, imposter]) {
            for (const sb of hub.subs) {
              if (sb.filter.kinds?.includes(29386) && (sb.filter['#e'] || []).includes(ev.id)) { try { sb.ws.send(JSON.stringify(['EVENT', sb.id, f])); hub.forged++; } catch { /* closed */ } }
            }
          }
        }
        ws.send(JSON.stringify(['OK', ev.id, true, '']));
        for (const s of hub.subs) if (matches(s.filter, ev)) { try { s.ws.send(JSON.stringify(['EVENT', s.id, ev])); } catch { /* closed */ } }
      }
    });
    ws.onClose(() => { hub.subs = hub.subs.filter((s) => s.ws !== ws); });
  });
}

/** Browser-side wallet that signs for real with `key` (runs inside the page). */
export function walletInit({ key, name, rdns, account }) {
  let chainId = '0x1';
  let mod = null;
  const lib = async () => (mod ||= await import('/assets/js/secp256k1.js'));
  const icon = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 10 10%22%3E%3Crect width=%2210%22 height=%2210%22 rx=%222%22 fill=%22%23f6851b%22/%3E%3C/svg%3E';
  const provider = {
    isMetaMask: true,
    request: async ({ method, params }) => {
      const m = key ? await lib() : null;
      const d = key ? m.privateKeyFromHex(key) : null;
      const me = key ? m.addressOf(d) : account;
      switch (method) {
        case 'eth_requestAccounts': case 'eth_accounts': return [me];
        case 'eth_chainId': return chainId;
        case 'wallet_switchEthereumChain': chainId = params[0].chainId; return null;
        case 'wallet_addEthereumChain': (window.__added = window.__added || []).push(params[0]); if (window.__fixOnAdd) delete window.__sendError; return null;
        case 'wallet_watchAsset': return null;
        case 'personal_sign': {
          const msg = new TextDecoder().decode(m.hexToBytes(params[0]));
          window.__personal = msg;
          return m.signatureHex(await m.sign(m.personalMessageDigest(msg), d));
        }
        case 'eth_signTypedData_v4': {
          const td = JSON.parse(params[1]);
          window.__typed = td;
          const sep = m.domainSeparator({ ...td.domain, chainId: Number(td.domain.chainId) });
          return m.signatureHex(await m.sign(m.authorizationDigest(sep, td.message), d));
        }
        case 'eth_sendTransaction': if (window.__sendError) throw Object.assign(new Error(window.__sendError), { code: -32603 }); window.__sent = params[0]; return window.__txHash;
        case 'eth_getTransactionReceipt': return null;
        default: throw new Error('unsupported ' + method);
      }
    },
    on() {},
    removeListener() {},
  };
  const info = { uuid: rdns, name, rdns, icon };
  window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) })));
}

export function watch(page, name, errors) {
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.g|ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
}
