// Unit tests for the pure modules. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { keccakText } from '../assets/js/keccak.js';
import { checksum, addressStatus, encodeTransfer, yenToWei, formatUnits, exactUnits, eip681 } from '../assets/js/evm.js';
import { computeTotals, summarizeItems } from '../assets/js/tax.js';
import { packJson, unpackJson, csv } from '../assets/js/util.js';
import { qrMatrix } from '../assets/js/qr.js';
import { sanitizeReceipt, receiptFromSale } from '../assets/js/receipt.js';
import { STRINGS } from '../assets/js/i18n.js';

const MERCHANT = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

test('keccak256 vectors', () => {
  assert.equal(keccakText(''), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(keccakText('Transfer(address,address,uint256)'), '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
});

test('EIP-55 checksums and address checks', () => {
  assert.equal(checksum('0xe7c3d8c9a439fede00d2600032d5db0be71c3c29'), '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29');
  assert.equal(checksum(MERCHANT.toLowerCase()), MERCHANT);
  assert.equal(addressStatus(MERCHANT), 'ok');
  assert.equal(addressStatus(MERCHANT.toLowerCase()), 'ok');
  assert.equal(addressStatus('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'), 'bad-checksum');
  assert.equal(addressStatus('0x0000000000000000000000000000000000000000'), 'zero');
  assert.equal(addressStatus('0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29'), 'token');
  assert.equal(addressStatus('0x123'), 'invalid');
});

test('ERC-20 transfer calldata', () => {
  const data = encodeTransfer(MERCHANT, 1400n * 10n ** 18n + 123n);
  assert.equal(data.slice(0, 10), '0xa9059cbb');
  assert.equal(data.length, 2 + 8 + 128);
  assert.equal(data.slice(10, 74), MERCHANT.slice(2).toLowerCase().padStart(64, '0'));
  assert.equal(BigInt('0x' + data.slice(74)), 1400000000000000000123n);
});

test('amounts', () => {
  assert.equal(yenToWei(1400), 1400n * 10n ** 18n);
  assert.equal(exactUnits(1400n * 10n ** 18n + 123n), '1400.000000000000000123');
  assert.equal(formatUnits(1234567n * 10n ** 16n, 18, 2), '12,345.67');
  assert.equal(eip681(137, MERCHANT, 5n), `ethereum:0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29@137/transfer?address=${MERCHANT}&uint256=5`);
});

test('consumption tax, tax-inclusive (one rounding per rate)', () => {
  const r = computeTotals([{ price: 450, qty: 2, tax: 10 }, { price: 1600, qty: 1, tax: 8 }], 'incl');
  assert.equal(r.total, 2500);
  assert.deepEqual(r.byRate.map((g) => [g.rate, g.gross, g.tax]), [[10, 900, 81], [8, 1600, 118]]);
  assert.equal(r.taxTotal, 199);
  assert.equal(r.count, 3);
});

test('consumption tax, tax-exclusive', () => {
  const r = computeTotals([{ price: 455, qty: 3, tax: 10 }, { price: 99, qty: 1, tax: 8 }, { price: 300, qty: 1, tax: 0 }], 'excl');
  assert.equal(r.taxTotal, 136 + 7);
  assert.equal(r.total, 1365 + 136 + 99 + 7 + 300);
  assert.equal(r.subtotal, 1365 + 99 + 300);
});

test('item summary', () => {
  assert.equal(summarizeItems([{ name: 'Latte', qty: 2 }, { name: 'Cake', qty: 1 }]), 'Latte×2, Cake');
});

test('receipt payload round trip and sanitizing', async () => {
  const sale = { no: '20260928-0001', paidAt: 1790000000000, chainId: 137, txHash: '0x' + 'ab'.repeat(32), from: MERCHANT, to: MERCHANT, taxMode: 'incl', amountYen: 900, items: [{ name: '<b>ブレンド</b>', qty: 2, price: 450, tax: 10 }] };
  const r = receiptFromSale(sale, { storeName: '喫茶たまご', regNo: 'T1234567890123' });
  const token = await packJson(r);
  assert.ok(token[0] === 'z' || token[0] === 'j');
  const back = sanitizeReceipt(await unpackJson(token));
  assert.equal(back.s, '喫茶たまご');
  assert.equal(back.reg, 'T1234567890123');
  assert.equal(back.it[0][0], '<b>ブレンド</b>'); // kept as text; rendering escapes it
  assert.equal(sanitizeReceipt({ reg: 'T12', tx: 'nope', c: 999, a: 1e12 }).reg, '');
  assert.equal(sanitizeReceipt({ a: 1e12 }).a, 10_000_000);
});

test('CSV has BOM and quotes', () => {
  assert.equal(csv([['a', 'b,c'], ['"x"', 1]]), '\uFEFFa,"b,c"\r\n"""x""",1\r\n');
});

test('QR sizing', () => {
  assert.equal(qrMatrix('hello').size, 21);
  assert.ok(qrMatrix('https://example.com/pay.html?' + 'x'.repeat(300)).size > 41);
});

test('both languages have the same keys', () => {
  assert.deepEqual(Object.keys(STRINGS.ja).sort(), Object.keys(STRINGS.en).sort());
});

test('every key used in the code exists', () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '../assets/js');
  const keys = new Set(Object.keys(STRINGS.en));
  const missing = [];
  const re = /'((?:common|nav|net|reg|kp|tax|tape|rc|charge|match|status|err|sales|csv|set|about|setup|pin|pay|rcp|gas|owner|sign|rpc)\.[\w.-]*)'/g;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'i18n.js')) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(re)) {
      const k = m[1];
      if (/\.(html|js|css|json|png|svg)$/.test(k)) continue;
      const ok = k.endsWith('.') || /\+\s*$/.test(src.slice(m.index + m[0].length, m.index + m[0].length + 3))
        ? [...keys].some((x) => x.startsWith(k))
        : keys.has(k);
      if (!ok) missing.push(`${f}: ${k}`);
    }
  }
  assert.deepEqual(missing, []);
});

// ---- store branding ----
import { validLogo, validColor, validLink, safeColor, contrastWithWhite, parseBrand, linkLabel, hasBrand, PRESETS } from '../assets/js/brand.js';

test('brand: only small raster data URLs are accepted as logos', () => {
  assert.equal(validLogo('data:image/avif;base64,AAAAHGZ0eXBhdmlm'), 'data:image/avif;base64,AAAAHGZ0eXBhdmlm');
  for (const bad of ['data:image/webp;base64,UklGRiIAAABXRUJQ', 'data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)', 'data:image/png;base64,ab"c', 'https://x.example/logo.png', 'data:image/png;base64,' + 'A'.repeat(40000)]) assert.equal(validLogo(bad), '', bad.slice(0, 30));
});
test('brand: links must be https', () => {
  assert.equal(validLink('https://www.instagram.com/kissa'), 'https://www.instagram.com/kissa');
  for (const bad of ['http://example.com', 'javascript:alert(1)', 'https://localhost', 'https://u:p@example.com', 'example.com']) assert.equal(validLink(bad), '', bad);
  assert.equal(linkLabel('https://www.instagram.com/kissa'), 'Instagram');
  assert.equal(linkLabel('https://lin.ee/abc'), 'LINE');
  assert.equal(linkLabel('https://kissa-tamago.jp/menu'), 'kissa-tamago.jp');
});
test('brand: every colour ends up readable with white text', () => {
  for (const [c] of PRESETS) if (c) assert.equal(safeColor(c), c, `preset ${c} should not need darkening`);
  for (const c of ['#FFFF00', '#FFFFFF', '#7FFFD4', '#F2B33A']) assert.ok(contrastWithWhite(safeColor(c)) >= 4.5, c);
  assert.equal(validColor('#22305a'), '#22305A');
  assert.equal(safeColor('red'), '');
});
test('brand: relay profiles are sanitized', () => {
  const b = parseBrand(JSON.stringify({ name: 'Café\u0000', color: '#FFFF00', logo: 'data:image/svg+xml;base64,AA', msg: 'x'.repeat(500), link: 'http://evil' }));
  assert.equal(b.name, 'Café');
  assert.ok(contrastWithWhite(b.color) >= 4.5);
  assert.equal(b.logo, '');
  assert.equal(b.msg.length, 120);
  assert.equal(b.link, '');
  assert.equal(parseBrand('not json'), null);
  assert.equal(hasBrand({ storeName: 'x' }), false);
  assert.equal(hasBrand({ brandColor: '#3F7D4E' }), true);
});
test('receipts carry a brand pointer and colour, never the logo itself', () => {
  const r = sanitizeReceipt({ s: 'A', b: 'a'.repeat(64), bc: '#3f7d4e', ln: 'https://lin.ee/x', lg: 'data:image/png;base64,AAAA' });
  assert.equal(r.b, 'a'.repeat(64));
  assert.equal(r.bc, '#3F7D4E');
  assert.equal(r.ln, 'https://lin.ee/x');
  assert.equal('lg' in r, false);
  assert.equal(sanitizeReceipt({ b: 'nothex', bc: 'red', ln: 'http://x.example' }).b, '');
});

// ---- AVIF without a library, and no Google-hosted pieces ----
import { av1ToAvif, obus, sequenceHeader } from '../assets/js/avif.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';

test('avif: one AV1 key frame becomes a well-formed single-image AVIF', () => {
  const tu = new Uint8Array(readFileSync(new URL('./fixtures/logo-av1.obu', import.meta.url)));
  const seq = obus(tu).find((o) => o.type === 1);
  const s = sequenceHeader(tu, seq);
  assert.deepEqual([s.profile, s.depth, s.mono, s.sx, s.sy], [0, 8, 0, 1, 1]);
  const f = av1ToAvif(tu, 128, 128);
  const u32 = (i) => ((f[i] << 24) | (f[i + 1] << 16) | (f[i + 2] << 8) | f[i + 3]) >>> 0;
  const ascii = (i, n) => String.fromCharCode(...f.subarray(i, i + n));
  const top = [];
  for (let i = 0; i < f.length; i += u32(i)) top.push({ type: ascii(i + 4, 4), at: i, size: u32(i) });
  assert.deepEqual(top.map((b) => b.type), ['ftyp', 'meta', 'mdat']);
  assert.equal(ascii(8, 4), 'avif');
  const find = (t) => { for (let i = 0; i < f.length - 4; i++) if (ascii(i, 4) === t) return i - 4; return -1; };
  for (const t of ['hdlr', 'pitm', 'iloc', 'iinf', 'infe', 'ispe', 'pixi', 'av1C', 'ipma']) assert.ok(find(t) > 0, t);
  const il = find('iloc');
  const mdat = top[2];
  // iloc: size, type, version/flags, sizes (2), item count, item id, data ref, extent count, then offset and length
  assert.equal(u32(il + 22), mdat.at + 8, 'iloc points at the image data');
  assert.equal(u32(il + 26), mdat.size - 8);
  const kept = obus(tu).filter((o) => o.type !== 2);
  assert.equal(mdat.size - 8, kept.reduce((n, o) => n + o.end - o.start, 0), 'temporal delimiters removed, nothing else');
  const ispe = find('ispe');
  assert.deepEqual([u32(ispe + 12), u32(ispe + 16)], [128, 128]);
  const c = find('av1C');
  assert.equal(f[c + 8], 0x81);
  assert.deepEqual(Array.from(f.subarray(c + 12, c + 12 + seq.end - seq.start)), Array.from(tu.subarray(seq.start, seq.end)), 'av1C carries the sequence header');
});
test('avif: refuses input that is not an AV1 key frame', () => {
  assert.throws(() => av1ToAvif(new Uint8Array([0x12, 0x00]), 8, 8));
  assert.throws(() => obus(new Uint8Array([0x0a, 0x05, 1])));
});
test('no Google-hosted resources and no WebP images ship with the app', () => {
  const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
  const walk = (d) => readdirSync(d).flatMap((n) => {
    const p = d + '/' + n;
    if (['node_modules', '.git', 'tests', 'docs'].includes(n)) return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const files = walk(root);
  assert.deepEqual(files.filter((p) => /\.webp$/i.test(p)), []);
  for (const p of files.filter((x) => /\.(html|css|js|mjs|json|webmanifest)$|_headers$/.test(x))) {
    const s = readFileSync(p, 'utf8');
    assert.ok(!/googleapis|gstatic|googletagmanager|google-analytics/i.test(s), p);
    assert.ok(!/\bwebp\b/i.test(s), p);
  }
  assert.equal(readFileSync(root + '/assets/fonts/reji-dot.woff').subarray(0, 4).toString(), 'wOFF');
});

// ---- このお店の情報: profile fields, 宛名, store page links ----
import { storePageUrl, eventLine, mergeLinks } from '../assets/js/brand.js';

test('profile: richer fields are sanitized, links capped at four', () => {
  const b = parseBrand(JSON.stringify({ name: 'A', links: ['https://x.com/a', 'http://bad', 'https://x.com/a', 'https://b.example/1', 'https://c.example/2', 'https://d.example/3', 'https://e.example/4'],
    about: 'line1\r\n\r\n\r\n\r\nline2\u0007', tagline: 't'.repeat(80), people: 'pen\nname', event: { name: '秋のクリエイター市', space: 'A-12\u0000' } }));
  assert.deepEqual(b.links, ['https://x.com/a', 'https://b.example/1', 'https://c.example/2', 'https://d.example/3']);
  assert.equal(b.link, 'https://x.com/a');
  assert.equal(b.about, 'line1\n\nline2');
  assert.equal(b.tagline.length, 40);
  assert.equal(b.people, 'penname');
  assert.equal(eventLine(b.event), '秋のクリエイター市\u3000A-12');
  assert.equal(linkLabel('https://kissa.booth.pm/'), 'BOOTH');
  assert.equal(linkLabel('https://www.pixiv.net/users/1'), 'pixiv');
  assert.equal(linkLabel('https://bsky.app/profile/a'), 'Bluesky');
});
test('links: the receipt link comes first, at most four, https only, no repeats', () => {
  assert.deepEqual(mergeLinks('https://www.instagram.com/a', ['https://x.com/a', 'javascript:alert(1)', 'https://www.instagram.com/a', 'https://b.example', 'https://c.example', 'https://d.example']),
    ['https://www.instagram.com/a', 'https://x.com/a', 'https://b.example/', 'https://c.example/']);
  assert.deepEqual(mergeLinks('', ['http://insecure.example']), []);
});
test('receipt: 宛名, 但し書き and event are kept short and single-line', () => {
  const r = sanitizeReceipt({ an: '株式会社たまご商事\n', tg: 'お品代'.repeat(20), ev: '秋のクリエイター市\u3000A-12' });
  assert.equal(r.an, '株式会社たまご商事');
  assert.equal(r.tg.length, 30);
  assert.equal(r.ev, '秋のクリエイター市\u3000A-12');
});
test('store page links carry only the profile key', () => {
  const pub = 'ab'.repeat(32);
  const u = new URL(storePageUrl(pub, 'https://reji.example/pay.html?to=0x1&a=5'));
  assert.equal(u.pathname, '/store.html');
  assert.equal(u.search, '');
  assert.match(u.hash, /^#p=[A-Za-z0-9_-]{43}$/);
  assert.equal(storePageUrl('nothex', 'https://reji.example/'), '');
});

// ---- 応援 (tips): signed consent, a marker that never looks like a sale, LINE-friendly QR links ----
import { verifyTip, tipCode } from '../assets/js/brand.js';
import { ownerMessage } from '../assets/js/ownermsg.js';
import { privateKeyFromHex, addressOf, personalMessageDigest, sign, signatureHex } from '../assets/js/secp256k1.js';
import { isTipValue } from '../assets/js/evm.js';
import { LIMITS } from '../assets/js/config.js';
import { forQr, inAppBrowser } from '../assets/js/util.js';

test('tips: shown only with the receiving wallet\'s own signature for this profile', async () => {
  const d = privateKeyFromHex('0x' + '5a'.repeat(32));
  const to = checksum(addressOf(d));
  const pub = 'ab'.repeat(32);
  const msg = ownerMessage('accept-tips', to, tipCode(pub), '喫茶たまご');
  const sig = signatureHex(await sign(personalMessageDigest(msg), d));
  const ok = verifyTip({ to, msg, sig, chains: [137, 999] }, pub);
  assert.equal(ok.to, to);
  assert.deepEqual(ok.chains, [137]);
  assert.equal(verifyTip({ to, msg, sig }, 'cd'.repeat(32)), null, 'another profile');
  assert.equal(verifyTip({ to: '0x' + '1'.repeat(40), msg, sig }, pub), null, 'another address');
  assert.equal(verifyTip({ to, msg: msg.replace('喫茶', '茶'), sig }, pub), null, 'edited text');
  const other = privateKeyFromHex('0x' + '77'.repeat(32));
  assert.equal(verifyTip({ to, msg, sig: signatureHex(await sign(personalMessageDigest(msg), other)) }, pub), null, 'signed by someone else');
  const verify = ownerMessage('verify-owner', to, tipCode(pub), '喫茶たまご');
  assert.equal(verifyTip({ to, msg: verify, sig: signatureHex(await sign(personalMessageDigest(verify), d)) }, pub), null, 'a different action');
});
test('tips carry a marker outside every sale amount', () => {
  assert.ok(LIMITS.tipMark > LIMITS.suffixMax);
  assert.ok(isTipValue(yenToWei(500) + BigInt(LIMITS.tipMark)));
  for (const suffix of [0, 1, 123, LIMITS.suffixMax]) assert.ok(!isTipValue(yenToWei(500) + BigInt(suffix)));
  assert.ok(!isTipValue('not a number'));
});
test('QR links open in the normal browser from LINE; in-app browsers are recognised', () => {
  assert.equal(forQr('https://reji.example/receipt.html#r=abc'), 'https://reji.example/receipt.html?openExternalBrowser=1#r=abc');
  assert.match(forQr('https://reji.example/pay.html?to=0x1&a=5'), /^https:\/\/reji\.example\/pay\.html\?to=0x1&a=5&openExternalBrowser=1$/);
  assert.equal(forQr('ethereum:0xabc@137/transfer'), 'ethereum:0xabc@137/transfer');
  assert.ok(inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0'));
  assert.ok(inAppBrowser('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Instagram 300.0.0'));
  assert.ok(!inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'));
  assert.ok(!inAppBrowser('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'));
});
