// Builds the staff manual PDF (docs/reji-manual-ja.pdf) from manual/runbook.html with Playwright.
// Usage: node manual/build.mjs   (PLAYWRIGHT_MODULE can point to a Playwright install; images: python3 manual/images.py)
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(pathToFileURL(path.join(here, 'runbook.html')).href, { waitUntil: 'load' });
await p.evaluate(() => document.fonts.ready);
const out = path.join(here, '..', 'docs', 'reji-manual-ja.pdf');
await p.pdf({
  path: out, format: 'A4', printBackground: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: `<div style="width:100%;padding:0 16mm;font-size:7.5pt;color:#5a6480;display:flex;justify-content:space-between;font-family:'Noto Sans CJK JP',sans-serif"><span>Reji スタッフ運用マニュアル（JPYC決済）</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
});
await b.close();
console.log(`manual written to ${path.relative(process.cwd(), out) || out}`);
