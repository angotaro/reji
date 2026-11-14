// The deployed copy uses addresses without ".html" (tools/build.mjs, step 5). This builds a copy, serves it
// the way Cloudflare does, and checks links, generated payment/store addresses, and that old links still work.
// Run: node tests/clean-urls.mjs   (starts its own server on :8092)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const SRC = path.resolve('.');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'reji-clean-'));
fs.cpSync(SRC, ROOT, { recursive: true, filter: (f) => !/[\\/](tests[\\/]shots|node_modules|manual|\.git)([\\/]|$)/.test(f) });
const log = execFileSync('node', ['tools/build.mjs'], { cwd: ROOT, env: { ...process.env, CLEAN_URLS: '1', SITE_URL: 'https://reji.example.workers.dev' } }).toString();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.mp4': 'video/mp4' };
const file = (p) => { const f = path.join(ROOT, p); return f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile() ? f : ''; };
let redirects = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  if (p.endsWith('.html')) { redirects++; res.writeHead(307, { Location: (p.endsWith('/index.html') ? p.slice(0, -10) : p.slice(0, -5)) + u.search }); return res.end(); }
  const f = p.endsWith('/') ? file(p + 'index.html') : file(p) || file(p + '.html');
  if (!f) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}).listen(8092);

const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass || !detail ? '' : ' ' + detail}`); };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGE = /(?<![\w.\\-])(app|pay|receipt|store|sign|terms|privacy|backup|ideas|okuri|hajimete)\.html\b/;

ok('build: says it cleaned the addresses', /clean addresses: ".html" removed/.test(log), log);
const left = ['index.html', 'okuri.html', 'hajimete.html', 'app.html', 'assets/js/charge.js', 'assets/js/brand.js', 'assets/js/receipt.js', 'assets/js/settings.js', 'assets/js/pay.js']
  .filter((f) => PAGE.test(read(f)));
ok('build: no page link or generated address still ends in .html', left.length === 0, left.join(', '));
ok('build: the address given to search engines has no .html', read('okuri.html').includes('<link rel="canonical" href="https://reji.example.workers.dev/okuri"'));
const mf = JSON.parse(read('manifest.webmanifest'));
ok('build: the installed app opens the clean address but keeps its identity', mf.start_url === './app' && mf.id === './app.html', `${mf.start_url} ${mf.id}`);
ok('build: the offline cache list is left alone (it already handles both forms)', read('sw.js').includes("'./app.html'"));
ok('source: untouched, so it still runs on any host', PAGE.test(fs.readFileSync(path.join(SRC, 'okuri.html'), 'utf8')));

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ serviceWorkers: 'block', locale: 'ja-JP' });
  await ctx.route(/^(https|wss):\/\//, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto('http://localhost:8092/');
  redirects = 0;
  await page.click('a[href="okuri"]');
  await page.waitForSelector('#board');
  ok('landing → 恩送り: the link goes straight to the clean address, no redirect', new URL(page.url()).pathname === '/okuri' && redirects === 0, `${page.url()} redirects=${redirects}`);
  await page.goto('http://localhost:8092/hajimete');
  ok('the guide opens at its clean address', (await page.locator('.hj-steps > li').count()) === 3);
  await page.goto('http://localhost:8092/okuri.html?test=1');
  ok('an old .html link still works and lands on the clean address', new URL(page.url()).pathname === '/okuri' && new URL(page.url()).search === '?test=1');

  // addresses Reji generates: a store page link, and a payment link that opens and shows its amount
  await page.goto('http://localhost:8092/app');
  const storeLink = await page.evaluate(() => import('./assets/js/brand.js').then((m) => m.storePageUrl('ab'.repeat(32))));
  ok('generated store page address has no .html', /\/store#p=/.test(storeLink), storeLink);
  const to = '0x1111111111111111111111111111111111111111';
  const pay = `http://localhost:8092/pay?to=${to}&c=137&a=600&u=4321&e=${Math.floor(Date.now() / 1000) + 600}&s=${encodeURIComponent('喫茶たまご')}&no=20261114-0001`;
  await page.goto(pay);
  await page.waitForSelector('.bill-amount, .amount, .bill', { timeout: 8000 });
  ok('a payment link at the clean address opens and shows the amount', (await page.textContent('body')).includes('600'));
  const foot = await page.locator('.pay-foot a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  ok('links on the payment page are clean too', foot.includes('hajimete') && foot.some((h) => /^receipt/.test(h)), foot.join(' '));
} finally {
  await browser.close();
  server.close();
  fs.rmSync(ROOT, { recursive: true, force: true });
}
console.log(`${results.filter(Boolean).length}/${results.length} clean-address checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
