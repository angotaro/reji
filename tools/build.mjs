// Optional build step for Cloudflare Pages. Build command: node tools/build.mjs
// (no packages to install; output directory stays "/").
//
// 1) Link previews (X, Facebook, LINE, Slack, Discord…) need ABSOLUTE image and page
//    URLs. This fills in the site address: SITE_URL if you set one (for a custom
//    domain), otherwise https://<project>.pages.dev taken from Cloudflare's CF_PAGES_URL.
// 2) Gives the offline cache a new name on every deploy (commit id), so every store
//    picks up updates without editing sw.js by hand.
// Without this step the site still works; previews may just show no image.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const env = process.env;
let site = String(env.SITE_URL || '').trim().replace(/\/+$/, '');
if (!site && env.CF_PAGES_URL) {
  const u = new URL(env.CF_PAGES_URL);
  const parts = u.hostname.split('.');
  if (u.hostname.endsWith('.pages.dev') && parts.length === 4) parts.shift(); // <commit>.<project>.pages.dev → <project>.pages.dev
  site = `https://${parts.join('.')}`;
}
if (site && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(site)) {
  console.error(`SITE_URL should look like https://example.com (got "${site}")`);
  process.exit(1);
}

const abs = (p) => `${site}/${p.replace(/^\.?\//, '')}`;
const pages = ['index.html', 'app.html', 'pay.html', 'receipt.html', 'store.html', 'sign.html', 'terms.html', 'privacy.html'];
if (site) {
  for (const f of pages) {
    if (!existsSync(f)) continue;
    let s = readFileSync(f, 'utf8');
    s = s.replace(/(<meta (?:property|name)="(?:og:image|twitter:image|og:url)" content=")(?!https?:)([^"]*)"/g, (_, a, p) => `${a}${abs(p)}"`);
    s = s.replace(/(<link rel="canonical" href=")(?!https?:)([^"]*)"/g, (_, a, p) => `${a}${abs(p)}"`);
    writeFileSync(f, s);
  }
  console.log(`link previews: ${site}`);
} else {
  console.log('link previews: no site address (set SITE_URL, or build on Cloudflare Pages); left relative');
}

// 3) Optional operator name and contact on the terms / privacy pages (hidden when not set).
const esc = (v) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const operator = String(env.OPERATOR_NAME || '').trim().slice(0, 120);
const contact = String(env.CONTACT || '').trim().slice(0, 200);
const contactHtml = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact) ? `<a href="mailto:${esc(contact)}">${esc(contact)}</a>`
  : /^https:\/\/\S+$/.test(contact) ? `<a href="${esc(contact)}" rel="noopener">${esc(contact)}</a>` : esc(contact);
for (const f of ['terms.html', 'privacy.html']) {
  if (!existsSync(f) || !(operator || contact)) continue;
  writeFileSync(f, readFileSync(f, 'utf8')
    .replace('<section class="lg-operator" id="operator" hidden>', '<section class="lg-operator" id="operator">')
    .replace('<dd data-fill="operator"></dd>', `<dd data-fill="operator">${esc(operator) || '—'}</dd>`)
    .replace('<dd data-fill="contact"></dd>', `<dd data-fill="contact">${contactHtml || '—'}</dd>`));
}
console.log(operator || contact ? `legal pages: operator ${operator ? 'set' : '-'}, contact ${contact ? 'set' : '-'}` : 'legal pages: OPERATOR_NAME / CONTACT not set (contact section stays hidden)');

const sha = String(env.CF_PAGES_COMMIT_SHA || '').slice(0, 8) || Date.now().toString(36);
const sw = readFileSync('sw.js', 'utf8');
const next = sw.replace(/const VERSION = 'reji-([0-9.]+)[^']*';/, `const VERSION = 'reji-$1-${sha}';`);
writeFileSync('sw.js', next);
console.log(`offline cache: ${/const VERSION = '([^']+)'/.exec(next)?.[1]}`);
