// Offline check under Cloudflare Workers' default HTML handling: /pay.html redirects (307) to
// /pay, which serves pay.html. After one online visit, pages must open with no network.
// Run: node tests/offline-workers.mjs   (starts its own server on :8091)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve('.');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.pdf': 'application/pdf', '.mp4': 'video/mp4' };
const file = (p) => { const f = path.join(ROOT, p); return f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile() ? f : ''; };
let swRev = 0; // a later deploy: sw.js comes back with a new cache name
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p === '/sw.js' && swRev) { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' }); return res.end(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = 'reji-test-${swRev}';`)); }
  if (p.endsWith('/index.html')) { res.writeHead(307, { Location: p.slice(0, -10) + u.search }); return res.end(); }
  if (p.endsWith('.html')) { res.writeHead(307, { Location: p.slice(0, -5) + u.search }); return res.end(); }
  const f = p.endsWith('/') ? file(p + 'index.html') : file(p) || file(p + '.html');
  if (!f) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}).listen(8091);

const results = [];
const ok = (name, pass) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8091/app.html');
  ok('online: /app.html is redirected to /app like on Workers', new URL(page.url()).pathname === '/app');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => caches.keys().then(async (k) => k.length && (await (await caches.open(k[0])).keys()).length > 40), null, { timeout: 15000 });
  ok('first visit: no update notice', (await page.locator('.update-banner').count()) === 0);
  // a deploy happens while the register is open
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  swRev = 1;
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await page.waitForSelector('.update-banner', { timeout: 20000 });
  ok('a new version arrives while the app is open: the notice appears with an update button', (await page.locator('.update-banner button').count()) === 1);
  await page.click('.update-banner button');
  await page.waitForLoadState('load');
  await page.evaluate(() => navigator.serviceWorker.ready);
  ok('after updating: the app runs from the new cache and the notice is gone', (await page.locator('.update-banner').count()) === 0
    && (await page.evaluate(() => caches.keys())).join() === 'reji-test-1');
  await page.waitForFunction(() => caches.keys().then(async (k) => k.length && (await (await caches.open(k[0])).keys()).length > 40), null, { timeout: 15000 });
  await ctx.setOffline(true);
  server.closeAllConnections(); // really offline: the service worker's own requests can't reach the server either
  server.close();
  for (const target of ['/pay.html?to=0x0000000000000000000000000000000000000001&c=137&a=100', '/receipt.html', '/store.html', '/app', '/']) {
    let loaded = false;
    try {
      const r = await page.goto('http://localhost:8091' + target, { timeout: 8000 });
      loaded = !!r && r.ok() && (await page.locator('script[type="module"]').count()) > 0;
    } catch { loaded = false; }
    ok(`offline: ${target.split('?')[0]} opens from the cache`, loaded);
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
}
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} offline checks passed`);
process.exit(passed === results.length ? 0 : 1);
