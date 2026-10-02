// Records the landing page's demo video and screenshots (needs tests/shots/seed.json from e2e).
import fs from 'node:fs';
import { mockRpc, mockNostr, addTransfer, UNIT, sleep } from './mocks.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.env.SHOTS || 'tests/shots';
const seed = JSON.parse(fs.readFileSync(`${OUT}/seed.json`, 'utf8'));
const browser = await chromium.launch();
try {
  // ---- demo video: a real checkout against the mocked chain ----
  // Frames come from the DevTools screencast; ffmpeg turns them into an MP4 afterwards.
  const FR = `${OUT}/frames`;
  fs.rmSync(FR, { recursive: true, force: true });
  fs.mkdirSync(FR, { recursive: true });
  const vctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'ja-JP', serviceWorkers: 'block' });
  await mockRpc(vctx);
  await mockNostr(vctx);
  await vctx.addInitScript((s) => {
    if (sessionStorage.getItem('seeded')) return;
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    for (const k of ['reji:cart:v1', 'reji:gas:v1']) localStorage.removeItem(k);
    localStorage.setItem('reji:lang', 'ja');
    sessionStorage.setItem('seeded', '1');
  }, seed);
  const v = await vctx.newPage();
  await v.goto(BASE + 'app.html');
  await v.waitForSelector('.register');
  const frames = [];
  const cdp = await vctx.newCDPSession(v);
  cdp.on('Page.screencastFrame', (f) => {
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(`${FR}/${file}`, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1180, maxHeight: 820, everyNthFrame: 1 });
  await v.click('[data-act="mode"][data-v="menu"]').catch(() => {});
  await sleep(900);
  for (const name of ['ブレンドコーヒー', 'ブレンドコーヒー', '抹茶ラテ', 'どら焼き']) {
    await v.click(`.tile:has-text("${name}")`, { timeout: 2000 }).catch(() => {});
    await sleep(520);
  }
  await sleep(700);
  await v.click('.tape-actions .charge-btn');
  await v.waitForSelector('#listen[data-state="ok"]', { timeout: 15000 });
  await sleep(2600);
  const p = await v.evaluate(() => JSON.parse(localStorage.getItem('reji:pending:v1')));
  addTransfer({ value: BigInt(p.amountYen) * UNIT + BigInt(p.suffix), tx: '0x' + '9a'.repeat(32), ahead: 1 });
  await v.waitForSelector('.charge[data-phase="paid"]', { timeout: 20000 });
  await sleep(3400);
  await v.click('[data-act="next"]');
  await sleep(700);
  await v.click('.tab[href="#/sales"]');
  await sleep(2400);
  await cdp.send('Page.stopScreencast');
  await sleep(200);
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.01, ((frames[i + 1]?.t ?? f.t + 1.5) - f.t)).toFixed(3)}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`;
  fs.writeFileSync(`${FR}/list.txt`, list);
  console.log('frames', frames.length, 'seconds', (frames.at(-1).t - frames[0].t).toFixed(1));
  await vctx.close();

  // ---- landing page ----
  const freeze = (at) => `*,*::before,*::after{animation-delay:-${at}s !important;animation-play-state:paused !important;transition:none !important}`;
  const lctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ja-JP', serviceWorkers: 'block' });
  await lctx.route(/^https:\/\//, (r) => r.abort());
  const l = await lctx.newPage();
  await l.goto(BASE);
  await l.addStyleTag({ content: freeze(6.4) + '.reveal{opacity:1 !important;transform:none !important}' });
  await sleep(500);
  await l.screenshot({ path: `${OUT}/lp-hero.png` });
  await l.screenshot({ path: `${OUT}/lp-full.png`, fullPage: true });
  await l.setViewportSize({ width: 1200, height: 630 });
  await sleep(200);
  await l.screenshot({ path: `${OUT}/lp-og.png` }); // reference only: the real link-preview card is the designed assets/img/landing/og.png
  const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, locale: 'ja-JP', serviceWorkers: 'block' })).newPage();
  await m.route(/^https:\/\//, (r) => r.abort());
  await m.goto(BASE);
  await m.addStyleTag({ content: freeze(6.4) + '.reveal{opacity:1 !important;transform:none !important}' });
  await sleep(400);
  await m.screenshot({ path: `${OUT}/lp-mobile.png`, fullPage: true });
} finally {
  await browser.close();
}
console.log('landing shots done');
