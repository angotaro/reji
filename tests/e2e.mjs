// End-to-end check with a mocked blockchain, a mocked Nostr relay and wallets
// that sign with test keys: no network, no funds.
//   1. python3 -m http.server 8080          (from the project root)
//   2. npm i -D playwright && npx playwright install chromium
//   3. node tests/e2e.mjs                    (screenshots go to tests/shots/)
import { LIMITS } from '../assets/js/config.js';
import { nextTerminal } from '../assets/js/util.js';
import fs from 'node:fs';
import {
  JPYC, MERCHANT, MERCHANT_KEY, CUSTOMER, CUSTOMER_KEY, PAYER, UNIT, chain, hub, addTransfer, mockRpc, mockNostr, walletInit, watch, sleep,
} from './mocks.mjs';
import { KIND } from '../assets/js/nostr.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const APP = BASE + 'app.html';
const OUT = process.env.SHOTS || 'tests/shots';
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const errors = [];
const ok = (name, cond, detail = '') => {
  checks.push({ name, pass: !!cond, detail: String(detail).slice(0, 300) });
  console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : detail);
};
const settingsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('reji:settings:v1')));
const seen = (page, sel, timeout = 10000, state) => page.waitForSelector(sel, { timeout, ...(state ? { state } : {}) }).then(() => true, () => false);
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const hosts = new Set(); // every host any page contacted
async function context(browser, opts, wallet) {
  const ctx = await browser.newContext({ locale: 'ja-JP', serviceWorkers: 'block', ...opts });
  ctx.on('request', (r) => { try { hosts.add(new URL(r.url()).hostname); } catch { /* data: etc. */ } });
  await mockRpc(ctx);
  await mockNostr(ctx);
  if (wallet) await ctx.addInitScript(walletInit, wallet);
  return ctx;
}

const browser = await chromium.launch();
try {
  // ================= landing page =================
  const ctx = await context(browser, { viewport: { width: 1180, height: 820 } }, { key: MERCHANT_KEY, name: 'Owner Wallet', rdns: 'test.owner' });
  const page = await ctx.newPage();
  watch(page, 'register', errors);
  await page.goto(BASE);
  await page.waitForSelector('.lp-hero');
  ok('landing: CTA opens the register', (await page.getAttribute('.lp-hero .btn.primary', 'href')) === 'app.html');
  await page.click('[data-lang-toggle]');
  ok('landing: English toggle', (await page.getAttribute('html', 'data-lang')) === 'en' && (await page.locator('.lp-hero h1 [lang="en"]').isVisible()));
  ok('landing: images are AVIF (JPEG only for older browsers), poster too', await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('.lp-stage img, .lp-steps img')];
    for (const i of imgs) i.loading = 'eager';
    await Promise.all(imgs.map((i) => (i.complete && i.naturalWidth ? 1 : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 5000); }))));
    return imgs.length >= 8 && imgs.every((i) => i.naturalWidth > 0 && /\.avif$/.test(i.currentSrc)) && /\.avif$/.test(document.querySelector('.lp-video video').poster);
  }));
  ok('landing: footer links the terms and privacy policy', (await page.locator('.lp-foot a[href="terms.html"]').count()) === 1 && (await page.locator('.lp-foot a[href="privacy.html"]').count()) === 1);
  await page.click('[data-lang-toggle]');
  await page.click('.lp-hero .btn.primary');

  // ================= first run: the guided setup =================
  await page.waitForSelector('.ob[data-step="welcome"]');
  ok('guided setup opens on first run', (await page.locator('.ob-list li').count()) === 9);
  ok('guide: welcome links the terms and privacy policy', (await page.locator('.ob-agree a[href="terms.html"]').count()) === 1 && (await page.locator('.ob-agree a[href="privacy.html"]').count()) === 1);
  await sleep(900);
  await page.screenshot({ path: `${OUT}/01-setup.png` });
  await page.click('[data-ob="next"]');
  await page.waitForSelector('.ob[data-step="store"]');
  await page.click('[data-ob="next"]');
  ok('setup: store name is required', (await page.locator('[data-err="storeName"]').textContent()).length > 0);
  ok('setup: required steps have no skip', (await page.locator('[data-ob="skip"]').count()) === 0);
  await page.fill('[name=storeName]', '喫茶たまご');
  await page.click('[data-ob="next"]');
  await page.waitForSelector('.ob[data-step="wallet"]');
  await page.click('[data-ob="next"]');
  ok('setup validates the address', (await page.locator('[data-err="address"]').textContent()).length > 0);
  await page.fill('[name=address]', MERCHANT.toLowerCase());
  ok('setup: address is shown in groups to check', await seen(page, '.ob-addr-card code b'));
  await sleep(500);
  await page.screenshot({ path: `${OUT}/01b-setup-wallet.png` });
  await page.click('[data-ob="next"]');
  await page.waitForSelector('.ob[data-step="owner"]');
  ok('setup: owner step waits for a signature or an explicit "later"', (await page.locator('[data-ob="next"]').count()) === 0 && (await page.locator('[data-ob="skip"]').count()) === 1);
  ok('setup: rail marks finished steps', (await page.getAttribute('.ob-rail li[data-id="wallet"]', 'data-state')) === 'done');
  await page.click('[data-ob-act="verify"]');
  await page.waitForSelector('.owner-sign');
  await sleep(300);
  await page.screenshot({ path: `${OUT}/21-owner-modal.png` });
  await page.click('[data-o="local"]');
  ok('setup: owner confirmed by signing with the wallet', await seen(page, '.ob[data-step="owner"] .ob-okline'));
  const signed = await page.evaluate(() => window.__personal || '');
  ok('setup: signed message names the store and wallet', signed.includes('喫茶たまご') && signed.includes(MERCHANT), signed);
  await sleep(500);
  await page.screenshot({ path: `${OUT}/01c-setup-owner.png` });
  await page.click('[data-ob="next"]');
  await page.waitForSelector('.ob[data-step="network"]');
  ok('setup: Test mode is suggested first', await page.isChecked('[name="network"][value="testnet"]'));
  await page.click('.ob-choice:has(input[value="mainnet"])');
  await page.click('.chip-check:has(input[value="43114"]) span');
  await sleep(500);
  await page.screenshot({ path: `${OUT}/01d-setup-network.png` });
  await page.click('[data-ob="next"]');
  await page.waitForSelector('.ob[data-step="menu"]');
  await page.click('[data-ob="next"]');
  await page.waitForSelector('.ob[data-step="receipt"]');
  await page.click('[data-ob="skip"]');
  await page.waitForSelector('.ob[data-step="brand"]');
  await page.setInputFiles('[data-logo-file]', 'tests/fixtures/logo.png');
  ok('setup: a picked logo is shrunk and previewed', await seen(page, '.logo-tile img') && /^data:image\/avif;base64,/.test(await page.inputValue('[name="logo"]')) && (await page.inputValue('[name="logo"]')).length < 24001);
  ok('setup: logo made into AVIF by the browser itself, colours intact', (await page.locator('[data-logo-note]').textContent()).includes('AVIF') && await page.evaluate(async () => {
    const i = new Image();
    i.src = document.querySelector('[name="logo"]').value;
    await i.decode();
    const c = document.createElement('canvas');
    c.width = i.naturalWidth; c.height = i.naturalHeight;
    const x = c.getContext('2d');
    x.drawImage(i, 0, 0);
    const [r, g, b] = x.getImageData(Math.round((c.width * 140) / 256), Math.round((c.height * 150) / 256), 1, 1).data; // the yolk
    return Math.abs(r - 242) < 14 && Math.abs(g - 179) < 14 && Math.abs(b - 58) < 14;
  }));
  await page.fill('[name="storeLink"]', 'http://not-secure.example');
  await page.click('[data-ob="next"]');
  ok('setup: store link must be https', (await page.locator('[data-err="storeLink"]').textContent()).length > 0);
  await page.fill('[name="storeLink"]', 'https://www.instagram.com/kissa_tamago');
  ok('setup: preview shows the logo and link', await seen(page, '[data-brand-preview] .bp-top .bp-logo img') && (await page.locator('[data-brand-preview] .bp-link').textContent()).includes('Instagram'));
  await sleep(400);
  await page.screenshot({ path: `${OUT}/01g-setup-brand.png` });
  await page.click('[data-ob="next"]');
  await page.waitForSelector('.ob[data-step="pin"]');
  ok('setup: a skipped step is marked on the rail', (await page.getAttribute('.ob-rail li[data-id="receipt"]', 'data-state')) === 'skipped');
  await page.reload();
  ok('setup: a reload resumes at the same step', await seen(page, '.ob[data-step="pin"]'));
  await page.click('[data-ob="skip"]');
  await page.waitForSelector('.ob[data-step="gasless"]');
  await page.click('[data-ob="skip"]');
  await page.waitForSelector('.ob[data-step="done"]');
  ok('setup summary: owner done, PIN still recommended', (await page.getAttribute('.ob-summary li:nth-child(3)', 'data-st')) === 'done' && (await page.getAttribute('.ob-summary li:nth-child(8)', 'data-st')) === 'warn' && (await page.getAttribute('.ob-summary li:nth-child(7)', 'data-st')) === 'done');
  await sleep(1600);
  await page.screenshot({ path: `${OUT}/01e-setup-done.png` });
  await page.click('[data-ob="finish"]');
  await page.waitForSelector('.register');
  ok('owner saved with settings', (await settingsOf(page)).owner?.address === MERCHANT);
  ok('register header shows the store logo', await seen(page, '.noren .brand-logo'));
  ok('backup carries the store profile key; restore checks it before use', await page.evaluate(async () => {
    const m = await import('./assets/js/brand.js');
    const k = m.brandKeyForBackup();
    localStorage.removeItem('reji:brandkey:v1');
    const restored = (await m.restoreBrandKey(k)) && m.brandPub() === k.pub;
    const forged = await m.restoreBrandKey({ sk: k.sk, pub: 'f'.repeat(64) });
    return restored && !forged && m.brandPub() === k.pub;
  }));
  ok('amounts use Reji Dot, served from this site', await page.evaluate(async () => {
    await document.fonts.ready;
    const face = [...document.fonts].find((f) => /Reji Dot/.test(f.family));
    return face?.status === 'loaded' && getComputedStyle(document.querySelector('.tile-price')).fontFamily.startsWith('"Reji Dot"');
  }));
  ok('store profile published to the relays, signed', await (async () => { for (let i = 0; i < 40 && !hub.events.some((e) => e.kind === 30078); i++) await sleep(150); return hub.events.some((e) => e.kind === 30078 && JSON.parse(e.content).logo.startsWith('data:image/')); })());

  // ---- このお店の情報: fill in the public store page first, so the customer screens show it ----
  await page.goto(`${BASE}app.html#/settings?s=info`);
  await page.waitForSelector('#sec-info [name="tagline"]');
  await page.fill('[name="tagline"]', '自家焙煎のコーヒーと、たまごサンドのお店');
  await page.fill('[name="people"]', '店主 山田たまこ');
  await page.fill('[name="about"]', '高円寺の小さな喫茶店です。\n週末はクリエイターのイベントにも出店しています。');
  await page.fill('[name="link2"]', 'https://x.com/kissa_tamago');
  await page.fill('[name="link3"]', 'https://kissa-tamago.booth.pm/');
  await page.fill('[name="eventName"]', '秋のクリエイター市');
  await page.fill('[name="eventSpace"]', 'A-12');
  ok('store info: お品書き on the store page is on by default', await page.locator('#sec-info [name="showMenu"]').isChecked());
  ok('store info: live preview with tagline, event and labelled links', (await page.locator('[data-info-preview] .sc-event').textContent()).includes('A-12')
    && (await page.locator('[data-info-preview] .sc-link').allTextContents()).join(',') === 'Instagram,X,BOOTH');
  await page.click('.save-bar [type=submit]');
  ok('store info: published in the signed profile', await (async () => {
    for (let i = 0; i < 40; i++) {
      const e = hub.events.filter((x) => x.kind === 30078).pop();
      const c = e ? JSON.parse(e.content) : {};
      if (c.event?.space === 'A-12') return c.links.length === 3 && c.tagline.includes('たまごサンド') && c.about.includes('\n') && c.menu?.items?.length === (await settingsOf(page), JSON.parse(await page.evaluate(() => localStorage.getItem('reji:products:v1'))).length);
      await sleep(150);
    }
    return false;
  })());
  await page.waitForSelector('#sec-info .share-qr svg');
  ok('store info: identifiers for staff and support', (await page.locator('#sec-info .id-list').textContent()).includes(MERCHANT) && (await page.locator('#info-backup').textContent()).includes('まだ'));
  // ---- 応援 (tips): the owner agrees once, with the receiving wallet's signature ----
  await page.click('#sec-info [data-act="tips-on"]');
  await page.waitForSelector('.owner-sign');
  await page.click('[data-o="local"]');
  await page.waitForSelector('#sec-info .tip-state', { timeout: 10000 });
  ok('tips: on after the owner\'s wallet signature', (await settingsOf(page)).tips === true);
  ok('tips: published with a signature any phone can check', await (async () => {
    for (let i = 0; i < 40; i++) {
      const e = hub.events.filter((x) => x.kind === 30078).pop();
      const c = e ? JSON.parse(e.content) : {};
      if (c.tip?.sig) return c.tip.to.toLowerCase() === MERCHANT.toLowerCase() && /Action: accept-tips/.test(c.tip.msg);
      await sleep(150);
    }
    return false;
  })());
  await sleep(3200); // let the "saved" toast fade
  await page.click('[data-jump="info"]');
  await sleep(600);
  await page.screenshot({ path: `${OUT}/09c-settings-info.png` });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sec-info [data-act="backup"]')]);
  const bk = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok('store info: backup time shown; backup keeps the profile key', !(await page.locator('#info-backup').textContent()).includes('まだ') && /^[0-9a-f]{64}$/.test(bk.brandKey?.pub || ''));
  await sleep(3200); // let the toast fade
  await page.evaluate(() => document.querySelector('#sec-info .info-box').scrollIntoView({ block: 'start' }));
  await sleep(400);
  await page.screenshot({ path: `${OUT}/09d-settings-info-share.png` });
  await page.evaluate(() => document.querySelector('#sec-info .id-list').closest('.info-box').scrollIntoView({ block: 'start' }));
  await sleep(400);
  await page.screenshot({ path: `${OUT}/09e-settings-info-ids.png` });
  ok('store info: postcard POP with logo, event and a QR to the store page', await page.evaluate(async () => {
    const { popHtml } = await import('./assets/js/pop.js');
    const { storePageUrl, brandPub } = await import('./assets/js/brand.js');
    const s = JSON.parse(localStorage.getItem('reji:settings:v1'));
    const box = document.createElement('div');
    box.id = 'pop-shot';
    box.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;padding:18px;background:#e9edf5;zoom:2'; // 2x for a crisp manual image
    box.innerHTML = String(popHtml(s, { pageUrl: storePageUrl(brandPub()), free: true }));
    document.body.append(box);
    await box.querySelector('img')?.decode().catch(() => {});
    return !!box.querySelector('.pop-logo') && box.querySelector('.pop-event').textContent.includes('A-12') && !!box.querySelector('.pop-qr svg') && box.textContent.includes('JPYC払い OK');
  }));
  await page.locator('#pop-shot').screenshot({ path: `${OUT}/22-pop.png` });
  await page.evaluate(() => document.getElementById('pop-shot').remove());
  await page.goto(`${BASE}app.html#/`);
  await page.waitForSelector('.register');
  ok('sample menu loaded', (await page.locator('.tile').count()) === 9);
  ok('guide remembered as finished', (await page.evaluate(() => JSON.parse(localStorage.getItem('reji:onboard:v1') || '{}').finished)) === true);

  // ---- choosing manual setup asks first, and strongly suggests the guide ----
  {
    const mctx = await context(browser, { viewport: { width: 1180, height: 820 } });
    const mp = await mctx.newPage();
    await mp.goto(`${BASE}app.html`);
    await mp.waitForSelector('.ob[data-step="welcome"]');
    await mp.click('[data-ob="later"]');
    ok('manual setup: a warning appears first', await seen(mp, '.ob-warn'));
    await sleep(350);
    await mp.screenshot({ path: `${OUT}/01f-setup-skip.png` });
    await mp.click('.ob-warn [data-close]');
    ok('manual setup: "continue" keeps the guide open', await seen(mp, '.ob[data-step="welcome"]') && !(await mp.locator('.ob-warn').count()));
    await mp.click('[data-ob="later"]');
    await mp.click('.ob-warn [data-ok]');
    ok('manual setup: opens Settings with a way back to the guide', await seen(mp, '#settings-form .ob-reopen[data-manual] [data-act="onboard"]'));
    await mp.fill('[name=storeName]', 'テスト商店');
    await mp.fill('[name=address]', MERCHANT);
    await mp.click('#sec-brand .swatch:has(input[value="#3F7D4E"]) .sw');
    ok('settings: colour preview updates live', (await mp.evaluate(() => document.querySelector('[data-brand-preview]').style.getPropertyValue('--bp'))) === '#3F7D4E');
    await mp.click('.save-bar [type=submit]');
    await sleep(600);
    ok('settings: store colour themes the register', (await mp.evaluate(() => document.documentElement.style.getPropertyValue('--brand'))) === '#3F7D4E');
    await mp.click('#settings-form [data-act="onboard"]');
    ok('manual setup: the guide can be reopened', await seen(mp, '.ob .ob-card'));
    await mctx.close();
  }

  await page.click('.tile:has-text("ブレンドコーヒー")');
  await page.click('.tile:has-text("ブレンドコーヒー")');
  await page.click('.tile:has-text("コーヒー豆")');
  const total = await page.locator('.tape .sum-total .amt').textContent();
  ok('cart total is ¥2,500', total.includes('2,500'), total);
  ok('tax note shows 内消費税', (await page.locator('.tape .sum-note').first().textContent()).includes('199'));
  await page.screenshot({ path: `${OUT}/02-register.png` });

  // ---- charge: wrong amount, then the exact one ----
  await page.click('.tape-actions .charge-btn');
  await page.waitForSelector('.charge[data-phase="waiting"]');
  await page.waitForSelector('#listen[data-state="ok"]', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/03-charge.png` });
  ok('charge screen: today\'s event under the store name', (await page.locator('.bill-store-event').textContent()).includes('A-12'));
  ok('charge: one QR for every wallet (no wallet-specific mode)', (await page.locator('[data-act="qrkind"]').count()) === 0 && (await page.locator('#qr-frame svg').count()) === 1);
  await page.locator('#qr-frame svg').screenshot({ path: `${OUT}/qr-pay.png` });
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('reji:pending:v1')));
  ok('pending charge saved', pending && pending.amountYen === 2500 && pending.chains.join() === '137,43114', JSON.stringify(pending?.chains));
  ok('no gas wallet yet: normal payment only', pending.relayChannel === '');

  addTransfer({ value: 2500n * UNIT + BigInt(LIMITS.tipMark), tx: '0x' + '88'.repeat(32) }); // a fan's ¥2,500 tip while ¥2,500 is being charged
  addTransfer({ value: 1000n * UNIT, tx: '0x' + '11'.repeat(32) });
  await page.waitForSelector('.others-list li', { timeout: 20000 });
  await sleep(1500);
  ok('a tip of the same amount is neither booked nor offered to staff', (await page.locator('.others-list li').count()) === 1 && (await page.locator('.charge[data-phase="waiting"]').count()) === 1);
  ok('a different amount is listed, not booked', (await page.locator('.charge[data-phase="waiting"]').count()) === 1);
  await page.click('.chain-tabs button:has-text("Avalanche")');
  ok('chain tab switches', (await page.getAttribute('.chain-tabs [aria-selected="true"]', 'data-v')) === '43114');
  await page.click('.chain-tabs button:has-text("Polygon")');

  const expected = 2500n * UNIT + BigInt(pending.suffix);
  addTransfer({ value: expected, tx: '0x' + 'cd'.repeat(32) });
  await page.waitForSelector('.charge[data-phase="paid"]', { timeout: 20000 });
  await sleep(1000);
  await page.screenshot({ path: `${OUT}/04-paid.png` });
  await page.waitForSelector('#rc-qr svg', { timeout: 5000 });
  await page.locator('#rc-qr svg').screenshot({ path: `${OUT}/qr-receipt.png` });
  const sales = await page.evaluate(() => JSON.parse(localStorage.getItem('reji:sales:v1')));
  ok('sale booked with exact match', sales.length === 1 && sales[0].match === 'exact' && sales[0].valueWei === expected.toString(), JSON.stringify(sales[0]).slice(0, 200));
  ok('sale confirmed after enough blocks', await page.waitForFunction(() => /確定/.test(document.querySelector('#conf')?.textContent || ''), null, { timeout: 45000 }).then(() => true, () => false));
  const receiptLink = await page.evaluate(async () => {
    const { receiptFromSale, receiptUrl } = await import('./assets/js/receipt.js');
    const { state } = await import('./assets/js/state.js');
    return receiptUrl(receiptFromSale(state.sales[0], state.settings));
  });
  await page.click('[data-act="next"]');
  ok('next sale starts empty', (await page.locator('.tape .line').count()) === 0);

  // ---- a charge that is cancelled, then paid late ----
  await page.click('.tile:has-text("抹茶ラテ")');
  await page.click('.tape-actions .charge-btn');
  await page.waitForSelector('#listen[data-state="ok"]', { timeout: 15000 });
  await page.click('[data-act="present"]');
  await sleep(300);
  await page.screenshot({ path: `${OUT}/05-present.png` });
  await page.click('[data-act="present-exit"]');
  const p2 = await page.evaluate(() => JSON.parse(localStorage.getItem('reji:pending:v1')));
  await page.click('[data-act="cancel"]');
  await page.click('.modal [data-ok]');
  await page.waitForSelector('#overlay', { state: 'hidden' });
  ok('cancel keeps the cart', (await page.locator('.tape .line').count()) === 1);
  await page.click('.tab[href="#/sales"]');
  await page.waitForSelector('.unpaid');
  await page.screenshot({ path: `${OUT}/06-sales.png` });
  addTransfer({ value: 600n * UNIT + BigInt(p2.suffix), tx: '0x' + 'ef'.repeat(32), ahead: 1 });
  await page.click('[data-act="recheck"]');
  ok('late payment found by Check again', await page.waitForFunction(() => !document.querySelector('.unpaid'), null, { timeout: 20000 }).then(() => true, () => false));
  await page.click('.row >> nth=0');
  await page.waitForSelector('.sale-view');
  await sleep(200);
  await page.screenshot({ path: `${OUT}/07-sale-modal.png` });
  await page.keyboard.press('Escape');

  // ---- keypad ----
  await page.click('.tab[href="#/"]');
  await page.click('[data-act="clear"]');
  await page.click('.modal [data-ok]');
  await page.click('[data-act="mode"][data-v="keypad"]');
  await page.keyboard.type('1200');
  await page.keyboard.press('Enter');
  ok('keypad adds a line', (await page.locator('.tape .line').count()) === 1);
  await page.screenshot({ path: `${OUT}/08-keypad.png` });
  const vbox = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return b && { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; };
  const vcoords = { charge: await vbox(page, '.tape-actions .charge-btn') };

  // ================= the store's own gas wallet =================
  await page.click('.tab[href="#/settings"]');
  await page.waitForSelector('.settings');
  ok('settings: owner box shows confirmed', (await page.getAttribute('#owner-box', 'data-ok')) === 'true');
  await page.click('[data-jump="gasless"]');
  await page.click('[data-act="gas-create"]');
  ok('gas wallet created, funded and on', await seen(page, '#gas-status[data-st="on"]'), await page.locator('#gas-status').textContent().catch(() => ''));
  ok('gas balance shown', (await page.locator('#gas-bal').textContent()).includes('1 POL'), await page.locator('#gas-bal').textContent());
  ok('gas key kept only in its own storage key', await page.evaluate(() => !!JSON.parse(localStorage.getItem('reji:gas:v1')).key && !localStorage.getItem('reji:settings:v1').includes('"key"')));
  await page.locator('#sec-gasless').scrollIntoViewIfNeeded();
  await sleep(300);
  await page.screenshot({ path: `${OUT}/10b-settings-gasless.png` });

  // ---- no-fee payment: the customer signs, this register relays over Nostr ----
  await page.click('.tab[href="#/"]');
  await page.click('.tape-actions .charge-btn');
  await page.waitForSelector('#listen[data-state="ok"]', { timeout: 15000 });
  const p3 = await page.evaluate(() => JSON.parse(localStorage.getItem('reji:pending:v1')));
  ok('charge carries a relay channel and reply key', /^[0-9a-f]{32}$/.test(p3.relayChannel || '') && /^[0-9a-f]{64}$/.test(p3.relayPub || ''), JSON.stringify(p3));
  ok('register shows the no-fee line', await page.locator('#relay-line').isVisible());
  await page.screenshot({ path: `${OUT}/03b-charge-nofee.png` });
  await sleep(4200); // let earlier toasts fade for a clean still (intro video)
  await page.screenshot({ path: `${OUT}/03c-charge-clean.png` });
  const u = new URL('pay.html', BASE);
  u.search = new URLSearchParams({ to: MERCHANT, c: '137', a: '1200', u: String(p3.suffix), s: '喫茶たまご', r: p3.no, e: String(Math.floor(p3.expiresAt / 1000)), d: p3.desc, n: p3.relayChannel, k: Buffer.from(p3.relayPub, 'hex').toString('base64url') }).toString();
  if (p3.brandPub) u.searchParams.set('b', Buffer.from(p3.brandPub, 'hex').toString('base64url'));
  if (p3.brandColor) u.searchParams.set('bc', p3.brandColor.slice(1));
  ok('pay link carries a pointer to the store profile', /^[0-9a-f]{64}$/.test(p3.brandPub || ''));

  const cust = await context(browser, PHONE, { key: CUSTOMER_KEY, name: 'Test Wallet', rdns: 'test.wallet' });
  const cp = await cust.newPage();
  watch(cp, 'pay-nofee', errors);
  await cp.goto(u.href);
  await cp.waitForSelector('.wallet-btn');
  ok('no-fee offered to the customer', await seen(cp, '.notice.free'));
  ok('customer: store logo shown from its signed profile', await seen(cp, '.pay-top .store-logo'));
  ok('customer: the event booth is on the bill', (await cp.locator('.bill-event').textContent()).includes('秋のクリエイター市'));
  await cp.screenshot({ path: `${OUT}/14-pay-ready.png`, fullPage: true });
  vcoords.wallet = await vbox(cp, '.wallet-btn');
  ok('customer: pay page links the terms and privacy policy', (await cp.locator('.legal-links a[href="privacy.html"]').count()) === 1);
  await cp.tap('.wallet-btn');
  await cp.waitForSelector('.pay-btn:not([disabled])');
  await sleep(300);
  await cp.screenshot({ path: `${OUT}/15-pay-connected.png`, fullPage: true });
  vcoords.pay = await vbox(cp, '.pay-btn');
  hub.forge = true;
  hub.forgePub = p3.relayPub;
  await cp.tap('.pay-btn');
  ok('customer: no-fee payment completes', await seen(cp, '.done-title', 30000), await cp.locator('.pay-panel').textContent().catch(() => ''));
  ok('register: marked paid', await seen(page, '.charge[data-phase="paid"]', 20000));
  await sleep(1000);
  await cp.screenshot({ path: `${OUT}/16-pay-done.png`, fullPage: true });
  ok('customer: done screen shows the store card, its links and page', (await cp.locator('.done-store .sc-link').count()) === 3 && (await cp.locator('.done-store .sc-link').first().getAttribute('href')) === 'https://www.instagram.com/kissa_tamago' && /store\.html#p=[A-Za-z0-9_-]{43}$/.test(await cp.locator('.done-store a.store-page').getAttribute('href')));
  await page.screenshot({ path: `${OUT}/16b-register-paid.png` });
  ok('customer: payment-complete screen never scrolls sideways', await cp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), await cp.evaluate(() => `${document.documentElement.scrollWidth} > ${innerWidth}`));
  fs.writeFileSync(`${OUT}/video-coords.json`, JSON.stringify(vcoords));
  const want = 1200n * UNIT + BigInt(p3.suffix);
  const typed = await cp.evaluate(() => window.__typed);
  ok('customer signed EIP-3009 for the exact amount', typed?.primaryType === 'TransferWithAuthorization' && typed.message.to === MERCHANT && typed.message.value === want.toString() && typed.domain.verifyingContract.toLowerCase() === JPYC, JSON.stringify(typed?.message));
  ok('customer sent no transaction', !(await cp.evaluate(() => window.__sent)));
  ok('forged "failed" replies from a hostile relay were ignored', hub.forged >= 2 && !(await cp.locator('.notice.error').count()), `forged=${hub.forged}`);
  hub.forge = false;
  const relayed = chain.sent.find((s) => s.twa);
  ok('register relayed it from its gas wallet', relayed && relayed.twa.from === CUSTOMER.toLowerCase() && relayed.twa.value === want, relayed ? `${relayed.twa.from} ${relayed.twa.value}` : 'none');
  ok('Nostr: request and reply, all signatures valid', hub.bad === 0 && hub.events.some((e) => e.kind === KIND.payRequest) && hub.events.some((e) => e.kind === KIND.payReply && JSON.parse(e.content).hash === relayed?.hash), `bad=${hub.bad} kinds=${hub.events.map((e) => e.kind)}`);
  const s3 = (await page.evaluate(() => JSON.parse(localStorage.getItem('reji:sales:v1'))))[0];
  ok('sale booked exact from the customer', s3.match === 'exact' && String(s3.from).toLowerCase() === CUSTOMER.toLowerCase(), JSON.stringify(s3).slice(0, 200));
  ok('customer receipt saved on device', (await cp.evaluate(() => JSON.parse(localStorage.getItem('reji:receipts:v1') || '[]').length)) === 1);
  await cp.click('.pay-panel a.btn.primary');
  ok('receipt verified on-chain', await seen(cp, '.verify[data-state="verified"]', 15000));
  await sleep(900);
  await cp.screenshot({ path: `${OUT}/17-receipt-basic.png`, fullPage: true });
  ok('receipts: stores this phone paid appear as chips', (await cp.locator('.store-chip').count()) === 1 && (await cp.locator('.store-chip').textContent()).includes('喫茶たまご'));
  await cp.click('.rc-addr summary');
  await cp.fill('[name="an"]', '株式会社たまご商事');
  await cp.click('[data-act="addr"]');
  await cp.waitForSelector('.rc-addressee');
  ok('receipt: 宛名 and 但し書き make it a formal 領収書', (await cp.locator('.rc-addressee').textContent()).includes('株式会社たまご商事 様') && (await cp.locator('.rc-proviso').textContent()).includes('お品代') && (await cp.locator('.rc-received').count()) === 1);
  await cp.reload();
  await cp.waitForSelector('.rc-addressee');
  ok('receipt: the 宛名 is kept (this phone and the link)', (await cp.locator('.rc-addressee').textContent()).includes('株式会社たまご商事'));
  await cp.screenshot({ path: `${OUT}/21-receipt-addressee.png`, fullPage: true });
  const storePg = await cust.newPage();
  watch(storePg, 'store page', errors);
  const storeHref = await cp.locator('.rcpt-current a[href*="store.html#p="]').getAttribute('href');
  await storePg.goto(storeHref);
  await storePg.waitForSelector('.store-card .sc-about');
  ok('store page: signed profile with introduction, event and links', (await storePg.locator('.sc-name').textContent()) === '喫茶たまご' && (await storePg.locator('.sc-event').textContent()).includes('A-12') && (await storePg.locator('.sc-link').count()) === 3 && await seen(storePg, '.store-card img.sc-logo'));
  ok('store page: lists this phone\'s receipts from the store', (await storePg.locator('.sp-mine li').count()) >= 1);
  ok('store page: お品書き with names and prices', (await storePg.locator('.sp-menu .sp-items li').count()) >= 5 && /¥/.test(await storePg.locator('.sp-menu .sp-price').first().textContent()) && (await storePg.locator('.sp-menu .panel-title').textContent()).includes('お品書き'));
  await storePg.screenshot({ path: `${OUT}/20-store-page.png`, fullPage: true });
  ok('store page: the tip section starts closed (quiet)', (await storePg.locator('details.sp-tip:not([open])').count()) === 1);
  await storePg.click('.sp-tip > summary');
  ok('store page: tip address checked on this phone, same as its receipts', (await storePg.locator('.tip-checks .ok').count()) === 2 && (await storePg.locator('.tip-kv code').textContent()) === MERCHANT);
  await storePg.click('.tip-amt[data-a="500"]');
  ok('store page: amount chosen, send button names it', /500/.test(await storePg.locator('.tip-go').textContent()) && !(await storePg.locator('.tip-go').isDisabled()));
  await storePg.locator('.sp-tip').screenshot({ path: `${OUT}/23-store-tip.png` });
  const tipTx = '0x' + '8a'.repeat(32);
  addTransfer({ from: CUSTOMER, value: 500n * UNIT + BigInt(LIMITS.tipMark), tx: tipTx });
  await storePg.addInitScript((tx) => { window.__txHash = tx; }, tipTx);
  await storePg.click('[data-act="tip-go"]');
  await storePg.waitForSelector('.wallet-btn');
  ok('tip page: labelled as a tip, no manual transfer', (await storePg.locator('.bill-label').textContent()).includes('応援') && (await storePg.locator('details.manual').count()) === 0);
  await storePg.tap('.wallet-btn');
  await storePg.waitForSelector('.pay-btn:not([disabled])');
  await storePg.tap('.pay-btn');
  ok('tip: thanked once confirmed', await seen(storePg, '.done-title', 20000) && (await storePg.locator('.done-title').textContent()).includes('応援ありがとう'));
  const tipSent = await storePg.evaluate(() => window.__sent);
  ok('tip: sent to the store with the tip marker', tipSent && BigInt('0x' + tipSent.data.slice(74)) === 500n * UNIT + BigInt(LIMITS.tipMark) && tipSent.data.slice(34, 74).toLowerCase() === MERCHANT.slice(2).toLowerCase());
  ok('tip: kept on this phone, no 領収書 made', await storePg.evaluate(() => JSON.parse(localStorage.getItem('reji:tips:v1') || '[]').length === 1) && /store\.html#p=/.test(await storePg.locator('.pay-panel .btn.primary.big').getAttribute('href')));
  await storePg.waitForSelector('.bill-stamp .hanko');
  await sleep(1000); // the stamp lands (animation)
  ok('tip: a 感謝 stamp instead of 入金済', (await storePg.locator('.bill-stamp .hanko text').last().textContent()) === '感謝');
  await storePg.screenshot({ path: `${OUT}/24-tip-done.png`, fullPage: true });
  await storePg.close();
  const crafted = await cust.newPage();
  watch(crafted, 'crafted tip link', errors);
  await crafted.goto(`${BASE}pay.html?tip=1&to=${PAYER}&c=137&a=500&s=${encodeURIComponent('喫茶たまご')}&b=${new URL(storeHref).hash.slice(3)}`);
  ok('a crafted tip link with another address is refused', await seen(crafted, '.notice.error', 15000) && (await crafted.locator('.wallet-btn').count()) === 0);
  await crafted.close();
  await page.click('[data-act="next"]');

  // ---- owner-only actions: return gas (signed here), confirm again from a phone ----
  await page.click('.tab[href="#/settings"]');
  await page.click('[data-jump="gasless"]');
  const before = chain.sent.length;
  await page.click('[data-act="gas-withdraw"]');
  ok('returning gas asks for the owner signature', await seen(page, '.owner-sign'));
  await page.click('[data-o="local"]');
  await page.waitForFunction((n) => (window.__done = 1) && document.querySelector('.owner-sign') === null, before, { timeout: 10000 }).catch(() => {});
  await sleep(1500);
  ok('gas returned to the owner', chain.sent.slice(before).some((s) => !s.twa), `sent=${chain.sent.length - before}`);

  await page.click('#owner-box [data-act="owner-verify"]');
  await page.waitForSelector('.owner-sign');
  const signLink = await page.getAttribute('.owner-sign', 'data-link');
  const ownerPhone = await context(browser, PHONE, { key: MERCHANT_KEY, name: 'Owner Wallet', rdns: 'test.owner' });
  const op = await ownerPhone.newPage();
  watch(op, 'sign', errors);
  await op.goto(signLink);
  await op.waitForSelector('.wallet-btn');
  await op.screenshot({ path: `${OUT}/20-sign-page.png`, fullPage: true });
  await op.tap('.wallet-btn');
  ok('phone: signature sent', await seen(op, '.done-title', 15000));
  ok('register: accepts the phone signature', await seen(page, '.owner-sign', 10000, 'detached'));
  const wrongPhone = await cust.newPage();
  watch(wrongPhone, 'sign-wrong', errors);
  await wrongPhone.goto(signLink);
  await wrongPhone.tap('.wallet-btn');
  ok('phone: another wallet is refused', await seen(wrongPhone, '.notice.error'));

  // ---- connections (RPC): pool status, own endpoint by URL and by API key ----
  await page.click('[data-jump="nodes"]');
  ok('connection status shows healthy nodes', await seen(page, '#sec-nodes .rpc-chain[data-st="ok"]', 15000));
  await page.click('.rpc-own > summary');
  await page.click('.rpc-prov .seg-opt:has(input[value="other"]) span');
  await page.fill('[name="rpcPaste"]', 'https://my-node.example.com/v1/abcdefghijklmnop1234');
  await page.click('[data-act="rpc-add"]');
  ok('own endpoint added by URL', await seen(page, '.rpc-mine li'));
  ok('pasting a key does not mark the form as changed', (await page.locator('#save-bar[data-dirty="true"]').count()) === 0);
  ok('own endpoint saved for Polygon', ((await settingsOf(page)).rpc?.['137'] || [])[0]?.startsWith('https://my-node.example.com'), JSON.stringify((await settingsOf(page)).rpc));
  await page.click('.rpc-prov .seg-opt:has(input[value="drpc"]) span');
  await page.fill('[name="rpcPaste"]', 'abcdefghijklmnopqrstuvwx');
  await page.click('[data-act="rpc-add"]');
  await page.waitForFunction(() => document.querySelectorAll('.rpc-mine li').length === 2, null, { timeout: 15000 }).catch(() => {});
  const rs = (await settingsOf(page)).rpc || {};
  ok('an API key becomes endpoints only for chains that answer correctly', (rs['137'] || []).some((u) => u.startsWith('https://lb.drpc.live/polygon/')) && Object.keys(rs).length === 1, JSON.stringify(rs));
  await page.locator('#sec-nodes').scrollIntoViewIfNeeded();
  await sleep(300);
  await page.screenshot({ path: `${OUT}/22-settings-rpc.png` });
  await page.click('.rpc-mine [data-act="rpc-remove"]');
  await page.click('.rpc-mine [data-act="rpc-remove"]');
  ok('own endpoints removed', Object.keys((await settingsOf(page)).rpc || {}).length === 0);

  // ---- changing the address needs the owner ----
  await page.fill('[name=address]', PAYER);
  await page.click('.save-bar [type=submit]');
  ok('changing the address asks the owner', await seen(page, '.owner-sign', 5000));
  await page.click('.owner-sign [data-close]');
  await sleep(300);
  ok('cancelled change is not saved', (await settingsOf(page)).address === MERCHANT);
  await page.fill('[name=address]', MERCHANT);

  // ---- settings, test mode, English ----
  const seed = await page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('reji:') && k !== 'reji:pending:v1') o[k] = localStorage.getItem(k); }
    return o;
  });
  fs.writeFileSync(`${OUT}/seed.json`, JSON.stringify(seed));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('[data-jump="store"]').catch(() => {});
  await sleep(400);
  await page.screenshot({ path: `${OUT}/09-settings.png` });
  await page.click('[data-jump="brand"]');
  await sleep(500);
  ok('settings: branding section with live preview', await seen(page, '#sec-brand .brand-preview .bp-logo img'));
  await page.screenshot({ path: `${OUT}/09b-settings-brand.png` });
  await page.click('[data-jump="menu"]');
  await sleep(600);
  await page.screenshot({ path: `${OUT}/10-settings-menu.png` });
  await page.fill('[name=regNo]', '１２３４５６７８９０１２３');
  await page.click('.seg-opt:has(input[value="testnet"]) span');
  await page.click('.save-bar [type=submit]');
  await page.waitForSelector('.test-strip');
  ok('registration number normalized', (await settingsOf(page)).regNo === 'T1234567890123');
  ok('owner kept when the address did not change', (await settingsOf(page)).owner?.address === MERCHANT);
  await page.click('.lang-btn');
  await page.click('.tab[href="#/"]');
  await sleep(300);
  ok('English UI', (await page.locator('.tab[aria-current="page"]').textContent()).includes('Register'));
  await page.screenshot({ path: `${OUT}/11-english-test-mode.png` });

  // ================= phone register =================
  const phone = await context(browser, PHONE, { name: 'Test Wallet', rdns: 'test.wallet2', account: PAYER });
  await phone.addInitScript((s) => {
    if (sessionStorage.getItem('seeded')) return;
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    localStorage.removeItem('reji:cart:v1');
    sessionStorage.setItem('seeded', '1');
  }, seed);
  const pp = await phone.newPage();
  watch(pp, 'phone', errors);
  await pp.goto(APP);
  await pp.waitForSelector('.register');
  await pp.click('[data-act="mode"][data-v="menu"]');
  await pp.tap('.tile >> nth=1');
  await pp.tap('.tile >> nth=5');
  await pp.screenshot({ path: `${OUT}/12-phone-register.png` });
  await pp.tap('.bar-sum');
  await sleep(450);
  await pp.screenshot({ path: `${OUT}/13-phone-sheet.png` });
  // Someone edits the stored receiving address on the device: the register says so.
  const orig = await pp.evaluate(() => localStorage.getItem('reji:settings:v1'));
  await pp.evaluate((a) => { const x = JSON.parse(localStorage.getItem('reji:settings:v1')); x.address = a; localStorage.setItem('reji:settings:v1', JSON.stringify(x)); }, PAYER);
  await pp.reload();
  await pp.waitForSelector('.register');
  ok('an edited receiving address is flagged on the register', await seen(pp, '.owner-strip[data-st="invalid"]', 5000));
  await pp.screenshot({ path: `${OUT}/23-owner-strip.png` });
  await pp.evaluate((v) => localStorage.setItem('reji:settings:v1', v), orig);
  await pp.reload();
  await pp.waitForSelector('.register');
  ok('no warning while the owner record checks out', (await pp.locator('.owner-strip').count()) === 0);

  // ---- normal payment (no channel in the link): the customer's wallet sends JPYC.transfer ----
  const payTx2 = '0x' + 'bc'.repeat(32);
  addTransfer({ value: 1400n * UNIT + 123n, tx: payTx2 });
  const exp = Math.floor(Date.now() / 1000) + 600;
  const payUrl = `${BASE}pay.html?to=${MERCHANT}&c=137&a=1400&u=123&s=${encodeURIComponent('喫茶たまご')}&r=20260928-0009&e=${exp}&d=${encodeURIComponent('カフェラテ×2, どら焼き')}`;
  const fp = await phone.newPage();
  watch(fp, 'pay-fee', errors);
  await fp.addInitScript((tx) => { window.__txHash = tx; }, payTx2);
  await fp.goto(payUrl);
  await fp.waitForSelector('.wallet-btn');
  ok('no no-fee badge without a channel', (await fp.locator('.notice.free').count()) === 0);
  await fp.tap('.wallet-btn');
  await fp.waitForSelector('.pay-btn:not([disabled])');
  await fp.tap('.pay-btn');
  ok('normal payment completes', await seen(fp, '.done-title', 20000));
  const sent = await fp.evaluate(() => window.__sent);
  ok('wallet asked to call JPYC.transfer', sent && sent.to.toLowerCase() === JPYC && sent.data.startsWith('0xa9059cbb'), JSON.stringify(sent));
  ok('exact amount with suffix', sent && BigInt('0x' + sent.data.slice(74)) === 1400n * UNIT + 123n);

  // itemized receipt from the register's QR
  await fp.goto(receiptLink);
  ok('itemized receipt verified', await seen(fp, '.verify[data-state="verified"]', 15000));
  await fp.click('[data-act="save"]');
  await sleep(900);
  ok('receipt: store logo and link shown', await seen(fp, '.receipt .rc-logo') && (await fp.locator('.receipt .rc-link a').count()) === 1);
  ok('receipt from the register names the event', (await fp.locator('.receipt .rc-event').textContent()).includes('A-12'));
  await fp.screenshot({ path: `${OUT}/18-receipt-itemized.png`, fullPage: true });

  // ---- no wallet, broken and expired links ----
  const bare = await context(browser, PHONE);
  const np = await bare.newPage();
  watch(np, 'pay-nowallet', errors);
  await np.goto(payUrl + '&openExternalBrowser=1');
  await np.waitForSelector('.deep-links');
  ok('no wallet: every route offered (wallet apps, copy link, wallet QR, manual)', (await np.locator('.deep-links a[data-deep]').count()) === 4 && (await np.locator('.other-ways .ways li').count()) === 3 && (await np.locator('details.manual').count()) === 1);
  await np.evaluate(() => document.addEventListener('click', (e) => { if (e.target.closest('a[data-deep]')) e.preventDefault(); }, true)); // the app "doesn't open"
  await np.click('.deep-links a[data-deep="metamask"]');
  ok('no wallet: if the app does not open, the page says so and opens the other ways', await seen(np, '.open-failed', 8000) && (await np.locator('details.other-ways[open]').count()) === 1);
  await bare.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await np.click('[data-act="copy-page"]');
  const copied = await np.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('no wallet: the page link copies cleanly for a wallet app\'s browser', copied.startsWith(BASE + 'pay.html?') && !copied.includes('openExternalBrowser'), copied.slice(0, 80));
  const hpUrl = `${BASE}pay.html?to=${MERCHANT}&c=137&a=1357&u=4321&s=${encodeURIComponent('喫茶たまご')}&r=20260928-0010&e=${exp}`;
  addTransfer({ value: 1357n * UNIT, tx: '0x' + '56'.repeat(32), ahead: -3 }); // the previous customer's payment of the same amount, mined before this page opened
  const hp = await bare.newPage();
  watch(hp, 'pay-hashport', errors);
  await hp.goto(hpUrl);
  await hp.waitForSelector('.hp-card');
  await sleep(4500);
  ok('HashPort payment: an earlier payment of the same amount is never taken for this one', (await hp.locator('.done-title').count()) === 0 && (await hp.locator('.hp-card').count()) === 1);
  ok('no wallet: HashPort Wallet steps come first', (await hp.locator('.pay-panel .hp-card').count()) === 1 && (await hp.locator('.hp-card ~ .deep-links, .hp-card ~ * .deep-links').count()) >= 0);
  await hp.click('[data-act="hp-addr"]');
  const hpAddr = await hp.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  await hp.click('[data-act="hp-amt"]');
  const hpAmt = await hp.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('HashPort steps: the address and a plain amount copy in one tap', hpAddr.toLowerCase() === MERCHANT.toLowerCase() && hpAmt === '1357', `${hpAddr} / ${hpAmt}`);
  await hp.screenshot({ path: `${OUT}/19b-pay-hashport.png`, fullPage: true });
  addTransfer({ value: 1357n * UNIT, tx: '0x' + '57'.repeat(32) }); // sent from HashPort's own send screen: plain yen, no hidden digits
  ok('HashPort payment: spotted on chain, done screen and receipt like the QR path', await seen(hp, '.done-title', 25000)
    && await hp.evaluate(() => JSON.parse(localStorage.getItem('reji:receipts:v1') || '[]').some((x) => x.r && x.r.a === 1357)));
  await hp.close();
  await np.click('.manual summary');
  await np.screenshot({ path: `${OUT}/19-pay-nowallet.png`, fullPage: true });
  await np.goto(`${BASE}pay.html?to=0x123&c=137&a=5`);
  ok('broken link explained', (await np.locator('.notice.error').count()) === 1);
  await np.goto(payUrl.replace(/e=\d+/, 'e=1000'));
  ok('expired link explained', (await np.locator('.notice.warn').count()) === 1);
  await np.goto(`${BASE}sign.html?n=zz`);
  ok('broken sign link explained', (await np.locator('.notice.error').count()) === 1);

  // ================= service worker =================
  const core = (fs.readFileSync('sw.js', 'utf8').match(/const CORE = \[([\s\S]*?)\];/)[1].match(/'\.\/[^']*'/g) || []).length;
  // ---- terms and privacy pages ----
  {
    const lctx = await context(browser, PHONE);
    const lp = await lctx.newPage();
    watch(lp, 'legal', errors);
    await lp.goto(`${BASE}terms.html`);
    ok('terms page loads', (await lp.locator('h1').textContent()).includes('利用規約') && (await lp.locator('.lg-main h2').count()) >= 10);
    ok('operator block hidden until configured', await lp.locator('#operator').isHidden());
    await lp.goto(`${BASE}privacy.html`);
    ok('privacy page lists every external destination (no Google any more)', (await lp.locator('.lg-table tbody tr').count()) === 3 && (await lp.locator('.lg-table').textContent()).includes('relay.damus.io') && !(await lp.content()).includes('Google'));
    ok('privacy page explains the public store profile', (await lp.locator('.lg-table').textContent()).includes('ロゴ'));
    ok('privacy page fits a phone (the table scrolls inside)', await lp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await lp.screenshot({ path: `${OUT}/24-privacy-phone.png` });
    await lp.setViewportSize({ width: 1180, height: 820 });
    await lp.locator('#external').scrollIntoViewIfNeeded();
    await sleep(200);
    await lp.screenshot({ path: `${OUT}/25-privacy-external.png` });
    await lctx.close();
  }

  const swCtx = await browser.newContext();
  await swCtx.route(/^https:\/\//, (r) => r.abort());
  const sp = await swCtx.newPage();
  watch(sp, 'sw', errors);
  await sp.goto(APP);
  const sw = await sp.evaluate(async (n) => {
    await Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))]);
    for (let i = 0; i < 20; i++) {
      const k = (await (await caches.open('reji-0.1.2')).keys()).length;
      if (k >= n) return k;
      await new Promise((r) => setTimeout(r, 250));
    }
    return (await (await caches.open('reji-0.1.2')).keys()).length;
  }, core).catch((e) => String(e));
  ok(`service worker caches the app shell (${core} files)`, Number(sw) >= core, sw);

  // ---- moving the store to another device (お店の引き継ぎ) ----
  await page.evaluate(() => localStorage.setItem('reji:lang', 'ja')); // the guide page is in Japanese
  await page.goto(`${BASE}app.html#/settings?s=data`);
  await page.reload();
  await page.waitForSelector('#sec-data [data-act="backup"]');
  await page.click('[data-jump="data"]');
  await sleep(500);
  await page.screenshot({ path: `${OUT}/help-save.png` });
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#sec-data [data-act="backup"]')]);
  const moveFile = await dl2.path();
  fs.copyFileSync(moveFile, `${OUT}/move-backup.json`);
  const mainSales = await page.evaluate(() => JSON.parse(localStorage.getItem('reji:sales:v1') || '[]').length);
  const mainProducts = await page.evaluate(() => JSON.parse(localStorage.getItem('reji:products:v1') || '[]').length);
  const mainLetter = (await settingsOf(page)).terminal;
  ok('backup carries the sales so far', mainSales > 0 && JSON.parse(fs.readFileSync(moveFile, 'utf8')).sales.length === mainSales);
  const nctx = await context(browser, { viewport: { width: 1180, height: 820 } });
  const nd = await nctx.newPage();
  watch(nd, 'new device', errors);
  await nd.goto(`${BASE}app.html`);
  await nd.waitForSelector('.ob-choice');
  ok('new device: first screen offers a new store or moving one, with the guide', (await nd.locator('.ob-choice').count()) === 2 && (await nd.locator('.ob-help a[href="backup.html"]').count()) === 1);
  await sleep(500);
  await nd.screenshot({ path: `${OUT}/help-welcome.png` });
  await nd.click('[data-ob="restore"]');
  const bad = `${OUT}/not-a-backup.json`;
  fs.writeFileSync(bad, '{"hello":"world"}');
  await nd.setInputFiles('[data-ob-file]', bad);
  ok('new device: a wrong file is refused with a clear message', await seen(nd, '.notice.error', 5000) && (await nd.locator('[data-ob="restore-go"]').isDisabled()));
  await nd.setInputFiles('[data-ob-file]', moveFile);
  await nd.waitForSelector('.rs-preview');
  ok('new device: the backup is previewed before anything changes', (await nd.locator('.rs-name').textContent()) === '喫茶たまご' && (await nd.locator('.rs-opt').count()) === 2 && !(await nd.locator('[data-ob="restore-go"]').isDisabled()));
  await nd.evaluate(() => document.querySelector('.rs-preview').scrollIntoView({ block: 'start' }));
  await sleep(400);
  await nd.screenshot({ path: `${OUT}/help-restore.png` });
  await nd.check('[name="rsmode"][value="second"]');
  await nd.click('[data-ob="restore-go"]');
  await nd.waitForSelector('.register', { timeout: 15000 }); // the register mode (menu or keypad) comes along too
  const s2 = await settingsOf(nd);
  const nSales = await nd.evaluate(() => JSON.parse(localStorage.getItem('reji:sales:v1') || '[]').length);
  const nProducts = await nd.evaluate(() => JSON.parse(localStorage.getItem('reji:products:v1') || '[]').length);
  ok('second register: same store and menu, its own letter, no copied sales', s2.storeName === '喫茶たまご' && s2.terminal === nextTerminal(mainLetter) && nSales === 0 && nProducts === mainProducts && s2.regMode === (await settingsOf(page)).regMode);
  await nctx.close();
  const rctx = await context(browser, { viewport: { width: 1180, height: 820 } });
  const rd = await rctx.newPage();
  watch(rd, 'replacement device', errors);
  await rd.goto(`${BASE}app.html`);
  await rd.waitForSelector('.ob-choice');
  await rd.click('[data-ob="restore"]');
  await rd.setInputFiles('[data-ob-file]', moveFile);
  await rd.waitForSelector('.rs-preview');
  await rd.click('[data-ob="restore-go"]');
  await rd.waitForSelector('.register', { timeout: 15000 });
  const rSales = await rd.evaluate(() => JSON.parse(localStorage.getItem('reji:sales:v1') || '[]').length);
  ok('switching device: sales come along, same register letter', rSales === mainSales && (await settingsOf(rd)).terminal === mainLetter);
  await rctx.close();
} finally {
  await browser.close();
}

ok('no page contacted Google (fonts or anything else)', ![...hosts].some((h) => /(^|\.)(google|gstatic|googleapis)\./.test(h) || /google/.test(h)), [...hosts].join(', '));
ok('no console or page errors', errors.length === 0, errors.join(' | '));
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ checks, errors }, null, 2));
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
