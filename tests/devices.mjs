// Device check: renders every Reji screen on phones and tablets popular in Japan
// (size, pixel ratio, touch and user agent of each) and reports sideways scrolling,
// content cut off at the screen edge, text fields under 16px (iPhones zoom into
// those) and very small tap targets. Screenshots: tests/shots/devices/.
// Run with a local server on :8080:  node tests/devices.mjs
import fs from 'node:fs';
import { mockRpc, mockNostr, walletInit, MERCHANT, MERCHANT_KEY, sleep } from './mocks.mjs';
import { ownerMessage } from '../assets/js/ownermsg.js';
import { privateKeyFromHex, personalMessageDigest, sign, signatureHex } from '../assets/js/secp256k1.js';

const { chromium, devices } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = 'http://localhost:8080/';
const OUT = 'tests/shots/devices';
fs.mkdirSync(OUT, { recursive: true });
const D = (name, over = {}) => ({ ...devices[name], ...over });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; XQ-ES44) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const MATRIX = [
  ['iphone-se3', D('iPhone SE (3rd gen)')],
  ['iphone-13mini', D('iPhone 13 Mini')],
  ['iphone-15', D('iPhone 15')],
  ['iphone-15promax', D('iPhone 15 Pro Max')],
  ['pixel-7', D('Pixel 7')],
  ['galaxy-s24', D('Galaxy S24')],
  ['xperia-360x840', D('Pixel 7', { viewport: { width: 360, height: 840 }, deviceScaleFactor: 3, userAgent: ANDROID_UA })],
  ['narrow-320', D('iPhone SE')],
  ['ipad-mini', D('iPad Mini')],
  ['ipad-10', D('iPad (gen 7)', { viewport: { width: 820, height: 1180 } })],
  ['ipad-10-landscape', D('iPad (gen 7)', { viewport: { width: 1180, height: 820 } })],
  ['ipad-pro11', D('iPad Pro 11')],
  ['galaxy-tab-s9', D('Galaxy Tab S9')],
];
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;

/** Everything a page shows that runs past the right edge, ignoring parts inside scrollers or clipped boxes. */
async function audit(page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const out = [];
    if (document.documentElement.scrollWidth > W + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth}px > ${W}px)`);
    const clipped = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(hidden|clip|auto|scroll)/.test(cs.overflowX) || cs.position === 'fixed' && /(hidden|clip|auto|scroll)/.test(cs.overflow)) return true;
      }
      return false;
    };
    const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('#print-root, [hidden], svg, template')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
      if ((r.right > W + 1 || r.left < -1) && !clipped(el)) out.push(`cut off: ${name(el)} (${Math.round(r.left)}..${Math.round(r.right)} of ${W})`);
    }
    for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), select, textarea')) {
      if (el.offsetParent && parseFloat(getComputedStyle(el).fontSize) < 16) out.push(`text field under 16px (iPhone zooms): ${name(el)} ${getComputedStyle(el).fontSize}`);
    }
    const tiny = [...document.querySelectorAll('button, a.btn, summary, [role=button]')].filter((el) => {
      if (!el.offsetParent) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.height < 30 || r.width < 30);
    }).map((el) => `${name(el)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
    return { issues: [...new Set(out)].slice(0, 10), tiny: [...new Set(tiny)].slice(0, 6) };
  });
}

async function newCtx(browser, dev, { storage = null, wallet = null } = {}) {
  const ctx = await browser.newContext({ ...dev, locale: 'ja-JP', serviceWorkers: 'block' });
  await mockRpc(ctx);
  await mockNostr(ctx);
  if (storage) await ctx.addInitScript((s) => { if (!localStorage.getItem('reji:seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); localStorage.setItem('reji:seeded', '1'); } }, storage);
  if (wallet) await ctx.addInitScript(walletInit, wallet);
  return ctx;
}

const browser = await chromium.launch();
const report = [];
try {
  // ---- seed: a set-up store (logo, store info, event, tips on) and a customer phone with its receipt ----
  const sctx = await newCtx(browser, { viewport: { width: 1180, height: 820 } });
  const sp = await sctx.newPage();
  await sp.goto(BASE + 'app.html');
  const pub = await sp.evaluate(async () => { localStorage.clear(); return (await (await import('./assets/js/brand.js')).ensureBrandKey()).pub; });
  const message = ownerMessage('accept-tips', MERCHANT, pub.slice(0, 32), '喫茶たまご');
  const signature = signatureHex(await sign(personalMessageDigest(message), privateKeyFromHex(MERCHANT_KEY)));
  const seed = await sp.evaluate(async ({ MERCHANT, message, signature, pub }) => {
    const st = await import('./assets/js/state.js');
    const b = await import('./assets/js/brand.js');
    const rc = await import('./assets/js/receipt.js');
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = '#F3E3B5'; g.fillRect(0, 0, 160, 160);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(80, 88, 46, 0, 7); g.fill();
    g.fillStyle = '#E9A426'; g.beginPath(); g.arc(80, 88, 19, 0, 7); g.fill();
    st.saveSettings(st.normalizeSettings({
      storeName: '喫茶たまご', address: MERCHANT, network: 'mainnet', chains: [137], defaultChain: 137, logo: c.toDataURL('image/png'), brandColor: '#2F4B7C',
      footer: 'またのお越しをお待ちしております', tagline: '自家焙煎のコーヒーと、たまごサンドのお店', people: '店主 山田たまこ',
      about: '高円寺の小さな喫茶店です。\n週末はクリエイターのイベントにも出店しています。',
      links: ['https://www.instagram.com/kissa_tamago', 'https://x.com/kissa_tamago', 'https://kissa-tamago.booth.pm/'],
      eventName: '秋のクリエイター市', eventSpace: 'A-12', tips: true, tipAtt: { wallet: MERCHANT, code: pub.slice(0, 32), message, signature, at: Date.now() },
    }));
    st.state.products = st.sampleProducts('ja');
    st.saveProducts();
    localStorage.setItem('reji:onboard:v1', JSON.stringify({ finished: true }));
    await b.publishBrand(st.state.settings, { force: true });
    const register = Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));
    const p = st.state.products.slice(0, 2);
    const sale = { no: '20261001-0007', createdAt: Date.now(), paidAt: Date.now(), amountYen: p[0].price * 2 + p[1].price, taxMode: 'incl', chainId: 137,
      txHash: '0x' + 'ab'.repeat(32), from: '0x1111111111111111111111111111111111111111', to: MERCHANT, ev: '秋のクリエイター市\u3000A-12',
      items: [{ name: p[0].name, qty: 2, price: p[0].price, tax: p[0].tax }, { name: p[1].name, qty: 1, price: p[1].price, tax: p[1].tax }] };
    const r = rc.sanitizeReceipt({ ...rc.receiptFromSale(sale, st.state.settings), an: '株式会社たまご商事', tg: 'お品代' });
    const customer = { 'reji:receipts:v1': JSON.stringify([{ id: r.tx, savedAt: Date.now(), r }]) };
    const b64 = (await import('./assets/js/util.js')).b64urlEncode(Uint8Array.from(pub.match(/../g), (h) => parseInt(h, 16)));
    const q = (o) => new URLSearchParams(o).toString();
    return {
      register, customer,
      receipt: await rc.receiptUrl(r),
      store: b.storePageUrl(pub),
      pay: BASE_PAY('pay.html?' + q({ to: MERCHANT, c: '137', a: String(sale.amountYen), u: '43210', s: '喫茶たまご', r: '20261001-0008', d: `${p[0].name}×2, ${p[1].name}`, e: String(Math.floor(Date.now() / 1000) + 3600), b: b64, bc: '2F4B7C' })),
      tip: BASE_PAY('pay.html?' + q({ tip: '1', to: MERCHANT, c: '137', a: '500', s: '喫茶たまご', b: b64, bc: '2F4B7C' })),
    };
    function BASE_PAY(path) { return new URL(path, location.href).href; }
  }, { MERCHANT, message, signature, pub });
  await sctx.close();

  const PAGES = [
    ['landing', null, async (pg) => { await pg.goto(BASE + 'index.html'); await sleep(600); }],
    ['wizard', 'fresh', async (pg) => { await pg.goto(BASE + 'app.html'); await pg.waitForSelector('.ob-card, .ob-start, [data-ob]', { timeout: 8000 }); }],
    ['register', 'register', async (pg) => {
      await pg.goto(BASE + 'app.html#/');
      await pg.waitForSelector('.tile');
      await pg.locator('.tile').nth(0).click();
      await pg.locator('.tile').nth(0).click();
      await pg.locator('.tile').nth(3).click();
      await sleep(300);
    }],
    ['charge', 'register', async (pg) => {
      await pg.goto(BASE + 'app.html#/');
      await pg.waitForSelector('.tile');
      await pg.locator('.tile').nth(1).click();
      await pg.locator('.charge-btn:visible').first().click();
      await pg.waitForSelector('.qr-frame svg', { timeout: 8000 });
      await sleep(400);
    }],
    ['settings-info', 'register', async (pg) => { await pg.goto(BASE + 'app.html#/settings?s=info'); await pg.waitForSelector('#sec-info'); await sleep(500); }],
    ['sales', 'register', async (pg) => { await pg.goto(BASE + 'app.html#/sales'); await sleep(500); }],
    ['pay', 'customer', async (pg) => { await pg.goto(seed.pay); await pg.waitForSelector('.bill-amount'); await sleep(900); }],
    ['tip', 'customer', async (pg) => { await pg.goto(seed.tip); await pg.waitForSelector('.bill-amount'); await sleep(900); }],
    ['receipt', 'customer', async (pg) => { await pg.goto(seed.receipt); await pg.waitForSelector('.rc-addressee'); await sleep(600); }],
    ['store', 'customer', async (pg) => {
      await pg.goto(seed.store);
      await pg.waitForSelector('.store-card .sc-about');
      await pg.click('.sp-tip > summary');
      await pg.click('.tip-amt[data-a="500"]');
      await sleep(300);
    }],
  ];
  for (const [dname, dev] of MATRIX) {
    if (only && !only.test(dname)) continue;
    for (const [pname, kind, go] of PAGES) {
      const ctx = await newCtx(browser, dev, { storage: kind === 'register' ? seed.register : kind === 'customer' ? seed.customer : null });
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', (e) => errs.push(e.message));
      let res = { issues: [], tiny: [] };
      try {
        await go(pg);
        res = await audit(pg);
        await pg.screenshot({ path: `${OUT}/${dname}--${pname}.png`, fullPage: !/landscape|ipad|tab/.test(dname) && pname !== 'landing' });
      } catch (e) {
        res.issues.push('could not open: ' + e.message.split('\n')[0]);
      }
      if (errs.length) res.issues.push('page error: ' + errs[0]);
      report.push({ device: dname, page: pname, ...res });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
const bad = report.filter((r) => r.issues.length);
for (const r of bad) console.log(`${r.device} / ${r.page}:\n  - ${r.issues.join('\n  - ')}`);
console.log(`${report.length - bad.length}/${report.length} screens clean` + (bad.length ? '' : ' (no sideways scroll, nothing cut off, no zooming fields)'));
