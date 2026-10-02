// Offline shell for the register. Same-origin files only; blockchain RPC calls
// (POST, cross-origin) always go straight to the network.
const VERSION = 'reji-0.1.2';
const CORE = [
  './', './index.html', './app.html', './pay.html', './receipt.html', './store.html', './sign.html', './terms.html', './privacy.html', './manifest.webmanifest',
  './assets/css/base.css', './assets/css/app.css', './assets/css/pay.css', './assets/css/legal.css', './assets/css/landing.css',
  './assets/js/landing.js', './assets/js/secp256k1.js', './assets/js/relayer.js', './assets/js/nostr.js',
  './assets/js/gas.js', './assets/js/owner.js', './assets/js/sign-page.js', './assets/js/ownermsg.js', './assets/js/providers.js', './assets/js/onboard.js', './assets/js/brand.js', './assets/js/avif.js', './assets/js/storecard.js', './assets/js/pop.js', './assets/js/store-page.js', './assets/fonts/reji-dot.woff', './assets/js/brandui.js',
  './assets/js/app.js', './assets/js/charge.js', './assets/js/config.js', './assets/js/evm.js', './assets/js/i18n.js',
  './assets/js/keccak.js', './assets/js/pay.js', './assets/js/qr.js', './assets/js/receipt.js', './assets/js/receipt-page.js',
  './assets/js/register.js', './assets/js/rpc.js', './assets/js/sales.js', './assets/js/settings.js', './assets/js/sound.js',
  './assets/js/state.js', './assets/js/tax.js', './assets/js/ui.js', './assets/js/util.js', './assets/js/wallet.js',
  './assets/img/icon.svg', './assets/img/icon-192.png', './assets/img/icon-512.png', './assets/img/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/api/')) return; // live relay status must never be cached
    if (req.mode === 'navigate') {
      // Network first so a new deploy shows up at once; cached page when offline.
      e.respondWith(
        fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(url.origin + url.pathname, copy));
            }
            return res;
          })
          .catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('./index.html')),
      );
      return;
    }
    // Stale-while-revalidate for scripts, styles and images.
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
    return;
  }
});
