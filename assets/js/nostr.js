// A tiny Nostr client, used as a free message channel between phones and the
// store's register (no server of our own). Events are short-lived ("ephemeral"
// kinds 20000-29999): relays pass them to live listeners and do not store them.
import { schnorrPublicKey, schnorrSign, schnorrVerify, sha256, hexToBytes } from './secp256k1.js';
import { bytesToHex } from './keccak.js';

export const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.snort.social'];
export const KIND = { payRequest: 29385, payReply: 29386, ownerSign: 29387 };
export const newChannel = () => bytesToHex(crypto.getRandomValues(new Uint8Array(16)));

export async function makeEvent(sk, kind, tags, content) {
  const pubkey = schnorrPublicKey(sk);
  const created_at = Math.floor(Date.now() / 1000);
  const id = bytesToHex(await sha256(new TextEncoder().encode(JSON.stringify([0, pubkey, created_at, kind, tags, content]))));
  const sig = await schnorrSign(hexToBytes(id), sk);
  return { id, pubkey, created_at, kind, tags, content, sig };
}

/** Checks an event's id and signature (a relay could forward anything). */
export async function verifyEvent(ev) {
  try {
    if (!/^[0-9a-f]{64}$/.test(ev?.id) || !/^[0-9a-f]{64}$/.test(ev?.pubkey) || !/^[0-9a-f]{128}$/.test(ev?.sig)) return false;
    const id = bytesToHex(await sha256(new TextEncoder().encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))));
    return id === ev.id && (await schnorrVerify(ev.pubkey, hexToBytes(ev.id), ev.sig));
  } catch {
    return false;
  }
}

export class Pool {
  constructor(urls = RELAYS) {
    this.urls = urls;
    this.sockets = new Map();
    this.subs = new Map();
    this.outbox = [];
    this.okWaiters = new Map();
    this.seen = new Set();
    this.closed = false;
  }

  connect() {
    this.closed = false;
    for (const url of this.urls) if (!this.sockets.has(url)) this.open(url, 0);
    return this;
  }

  open(url, attempt) {
    if (this.closed) return;
    let ws;
    try { ws = new WebSocket(url); } catch { return; }
    this.sockets.set(url, ws);
    ws.onopen = () => {
      attempt = 0;
      for (const [id, s] of this.subs) ws.send(JSON.stringify(['REQ', id, s.filter]));
      for (const ev of this.outbox) ws.send(JSON.stringify(['EVENT', ev]));
    };
    ws.onmessage = (m) => this.receive(m.data);
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    ws.onclose = () => {
      if (this.sockets.get(url) === ws) this.sockets.delete(url);
      if (!this.closed) setTimeout(() => this.open(url, attempt + 1), Math.min(15000, 1000 * 2 ** attempt));
    };
  }

  receive(raw) {
    if (typeof raw !== 'string' || raw.length > 65536) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(msg)) return;
    if (msg[0] === 'EVENT') {
      const sub = this.subs.get(msg[1]);
      const ev = msg[2];
      if (!sub || !ev?.id || this.seen.has(ev.id)) return;
      this.seen.add(ev.id);
      sub.onEvent(ev);
    } else if (msg[0] === 'OK' && msg[2] === true) {
      this.okWaiters.get(msg[1])?.(true);
    }
  }

  send(frame) {
    const s = JSON.stringify(frame);
    for (const ws of this.sockets.values()) if (ws.readyState === 1) ws.send(s);
  }

  subscribe(filter, onEvent) {
    const id = 'r' + Math.random().toString(36).slice(2, 10);
    this.subs.set(id, { filter, onEvent });
    this.send(['REQ', id, filter]);
    return () => {
      if (!this.subs.delete(id)) return;
      this.send(['CLOSE', id]);
    };
  }

  /** Resolves true once any relay accepts the event, false after the timeout. */
  publish(ev, timeoutMs = 8000) {
    this.outbox.push(ev);
    setTimeout(() => { this.outbox = this.outbox.filter((e) => e !== ev); }, 60_000);
    this.send(['EVENT', ev]);
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(false), timeoutMs);
      const done = (v) => {
        clearTimeout(timer);
        this.okWaiters.delete(ev.id);
        resolve(v);
      };
      this.okWaiters.set(ev.id, done);
    });
  }

  close() {
    this.closed = true;
    for (const ws of this.sockets.values()) { try { ws.close(); } catch { /* ignore */ } }
    this.sockets.clear();
    this.subs.clear();
  }
}
