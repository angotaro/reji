# Reji (レジ) v0.1.2

A free point-of-sale web app for taking **JPYC** in a shop. Customers scan a QR code and pay from their own wallet; the money goes straight to the store's wallet. No sign-up, no monthly fee, no payment processing fee, no backend of ours.

- `index.html` landing page · `app.html` register · `pay.html` customer payment · `receipt.html` saved e-receipts · `sign.html` owner's phone signing
- `docs/reji-manual-ja.pdf` staff manual (Japanese) · `docs/DEPLOY.ja.md` deployment guide (Japanese)

## Deploy (GitHub → Cloudflare Pages, free)

1. Push the contents of this folder to a GitHub repository (`index.html` and `_headers` at the repository root).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages tab → Connect to Git** → pick the repository → **Begin setup**.
3. Production branch `main`, framework preset **None**, build command **`node tools/build.mjs`**, build output directory **`/`** → **Save and Deploy**. Using a custom domain? Add the environment variable `SITE_URL` = `https://your.domain` and redeploy.

Optional variables `OPERATOR_NAME` and `CONTACT` (email or https URL) add an operator/contact block to the terms (`terms.html`) and privacy/external-transmission notice (`privacy.html`); without them that block stays hidden.

The build step installs nothing. It makes link-preview URLs absolute (X, Facebook, LINE and Slack need full image URLs, and the Pages address isn't known until deploy) and gives the offline cache a new name for every commit, so stores pick up updates automatically. Without it the site still works; shared links just show no image.
4. Open `https://<project>.pages.dev`, set up a store in Test mode and take a test payment.

Cloudflare Pages' free plan allows commercial use and static requests are free. Vercel's Hobby plan is non-commercial only. `_headers` sets the security headers on Cloudflare; `vercel.json` carries the same for Vercel. Full Japanese walkthrough: `docs/DEPLOY.ja.md`.

## How it works

Static files only: vanilla JavaScript ES modules, no runtime dependencies, no CDN scripts. The optional build step above only rewrites a few URLs.

On first launch the register opens a **guided setup (かんたん設定)**. Required steps (store name, receiving wallet, test or live mode and chains) can't be skipped; recommended (owner confirmation, PIN lock) and optional steps (menu, receipts & tax, no-fee payments) are labelled as such. Progress survives a reload, choosing "set up manually" asks for confirmation first, and the guide can be reopened from Settings.

- **Payments** are detected by polling JPYC `Transfer` logs to the store address. Each charge has a random sub-yen suffix so the exact amount identifies it; other amounts are listed for staff. Unpaid charges are kept 7 days and can be checked again.
- **Data** (settings, products, sales) lives in `localStorage` on the store's device. Receipts travel in the URL `#fragment`.
- **Chains**: JPYC `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` on Polygon, Avalanche, Ethereum, Kaia (+ testnets).
- **Japanese tax**: 10% / 8% / 0%, inclusive or exclusive, qualified simplified invoice fields.

## Many stores, nothing central

| | Where it runs | Cost to the operator |
|---|---|---|
| Web app | Static hosting (Cloudflare Pages) | Free |
| Store data | Each store's own device | None |
| Blockchain reads (RPC) | Each device → public nodes directly (or the store's own provider key) | None |
| No-fee payments (gas) | Each store's own gas wallet on its register | None |
| No-fee / phone-signing messages | Public Nostr relays | None |

### Connections (RPC)

Every device talks to blockchain nodes directly, so load is naturally spread: public nodes rate-limit per client IP, and one register uses roughly one request per second per chain while a charge is on screen (nothing when idle besides a health check every 30 s). `assets/js/rpc.js` keeps a scored pool per chain (4–5 public endpoints each, plus any the owner adds):

- endpoints are ranked by moving-average latency and recent errors, with jitter so traffic spreads over the healthy ones;
- HTTP 429 / quota errors, failures, 401/403 and nodes lagging behind the chain head make an endpoint rest (backoff up to 5 min; 30 min for refused keys);
- slow calls are hedged to a second endpoint after 1.5–2.5 s; transactions are broadcast to up to 3 endpoints;
- each polling round reads head and logs from the same endpoint and re-scans an 8-block overlap;
- **a payment found on one endpoint is confirmed on an endpoint run by a different provider before it is booked automatically**; if nobody else confirms it within 2 minutes it is shown to staff instead.

Optional private connection (Settings → 接続先（RPC）): choose dRPC, Alchemy or Infura, sign up on their site, paste the API key, and Reji builds and tests the URLs for every supported chain (chain id + log access) and keeps the ones that work; or paste any full https URL (QuickNode, Ankr, Chainstack…). Keys stay on the device and in backups. No provider lets an app create keys on a user's behalf, so this sign-up step can't be one click; it is optional because the public pool is enough for typical shops.

### Store page, counter sign and 領収書

Settings → このお店の情報 adds a public profile on top of the branding: a tagline, who runs the store (a pen name is fine), an introduction, up to four links (X, Instagram, BOOTH, pixiv, YouTube, LINE and others are labelled automatically) and, for pop-ups, the event name and space number. It all travels in the same signed profile. Customers see it on **store.html#p=…**, a page they can open from the payment-complete screen or a receipt and share. It lists their own receipts from that store, and the receipts page groups stores as chips. While an event is set, it also appears on the charge screen, the customer's bill, receipts and the counter sign. The same section prints a postcard-size counter sign (100 × 148 mm) with a QR code to the store page, and shows the identifiers support needs: receiving address with a link to its JPYC history, owner confirmation, profile ID, register letter, where data lives and the last backup. On the receipts page, customers can add a 宛名 and 但し書き, which turns the e-receipt into a formal 領収書. That data stays on their phone and in links they copy; it is never sent to the store.

### Tips (応援)

A store can accept tips from its store page: a collapsed, optional 「このお店を応援する」 near the bottom, never at checkout. To turn it on, the owner signs an `accept-tips` text with the receiving wallet. The signed text carries the first half of the store profile key and travels in the profile. Every supporter's phone checks it with `verifyTip()`: the wallet that receives the tip must have signed it for this very profile. The pay page (`pay.html?tip=1&…`) checks it again and refuses a crafted link whose address doesn't match. If the phone holds receipts from the store, it also shows whether their address is the same. Every tip carries `LIMITS.tipMark` (8,888,888 wei) below the yen. That is outside the range used for sales, so the register never books a tip as a sale or offers it to staff, even at the same amount as an open charge. Tips have no manual-transfer option, so the marker can't be lost. Supporters pay the small network fee themselves. Tips are not sales and produce no 領収書, and a record stays on the supporter's phone (`reji:tips:v1`). Changing the receiving address turns tips off until the owner signs again.

### Phones and tablets

`tests/devices.mjs` opens every screen on 13 device profiles common in Japan: iPhone SE 3rd gen, 13 mini, 15, 15 Pro Max; Pixel 7, Galaxy S24, an Xperia-sized 360×840 screen and a 320px screen; iPad mini, iPad 10th gen portrait and landscape, iPad Pro 11, Galaxy Tab S9. It fails on sideways scrolling, content cut off at the edge, text fields under 16px (iPhones zoom into those) and page errors. It uses Chromium with each device's size, pixel ratio, touch and user agent; Safari-specific behaviour is handled in code:
- **Phone numbers:** `format-detection` stops receipt numbers turning into phone links.
- **Dark mode:** `color-scheme: only light` keeps Android's forced dark mode from inverting QR codes.
- **Double-tap zoom:** `touch-action: manipulation` stops quick double taps zooming the page.
- **Line breaks:** Japanese labels break only at natural points (`word-break: keep-all`).
- **LINE:** QR codes carry `openExternalBrowser=1`, so LINE's QR reader opens them in Safari or Chrome, where wallet apps and saved receipts live. Other in-app browsers get a short hint.

### When the browser has no wallet

Scanning the register's QR code with the phone camera opens Safari or Chrome, which can't sign anything. The pay page then offers, in order:
1. **Wallet buttons:** reopen the same page inside MetaMask, Trust Wallet, Coinbase Wallet or OKX Wallet, where signing works.
2. **If the app doesn't open:** that is, the page is still on screen 3 seconds later (app not installed, link blocked, or iOS opened the link in the browser). The page says so and expands 「ほかのウォレット・アプリが開かないとき」:
   - copy this page's link into any wallet app's built-in browser (wallets not listed, as long as the app has a browser);
   - ask staff to switch the register's QR to 「ウォレット用」 (EIP-681) and scan it with the wallet's own QR reader;
   - or send manually (the register also accepts the plain yen amount).
The owner's phone-signing page has the same help. WalletConnect is deliberately not used: it needs a registered project ID and a company-run relay, which Reji avoids.

### Fonts and images (nothing from Google)

Reji loads nothing from Google: no Google Fonts, no analytics, no WebP images. Prices and numbers use **Reji Dot**, a 3 KB dot-matrix font made for this project (`tools/make-dot-font.py`, MIT), served from the site itself. Japanese text uses the device's own fonts: BIZ UDPGothic on Windows, Hiragino on Apple devices, the system font on Android. Images are AVIF, and the landing page adds JPEG fallbacks for older browsers. Icons stay PNG, and the link-preview card stays PNG because social networks don't read AVIF. The tests fail if any page contacts a Google host or a WebP file comes back.

### Store branding

Each store can add a logo, an accent colour and a link (website, Instagram, LINE…) in Settings → Branding or in the guided setup, alongside the existing receipt message. The register shows them directly: header, the customer-facing charge screen, the paid slip and printed receipts. Customers' phones get them from a small profile the store signs with its own key and publishes as a replaceable Nostr event (kind 30078) on the public relays. The pay QR carries only the profile's public key and the colour; the pay and receipt pages verify the signature before showing anything, and cache it. Receipts store the pointer, never the image. Logos are shrunk on the device and saved as AVIF, which the browser makes itself: its built-in AV1 encoder (WebCodecs) produces one frame and `assets/js/avif.js` wraps it in the AVIF container, with no library. A logo is typically 2–4 KB (24 KB at most). Browsers without an AV1 encoder save PNG or JPEG instead, and an AVIF file that is already small is kept as is. Colours are darkened automatically when white text would be hard to read. Backups include the profile key, so a store keeps the same public profile on a new device. If the relays can't be reached, pages fall back to the store name and colour. A logo is decoration, not proof of authenticity: staff still check the amount and store name, as before.

### Owner confirmation

The owner signs a fixed-format message (`personal_sign`) with the receiving wallet, locally or by scanning a QR and signing on their phone (`sign.html`; the signature returns over Nostr). The signed message is stored with the settings and re-verified at start-up: if the stored address or owner record is edited on the device, a red strip warns staff. Changing the receiving address, returning gas and showing the gas key need a fresh owner signature.

### No-fee payments (Polygon)

The register creates its own gas wallet (key only on that device), the owner funds it with a little POL, and for each Polygon charge the pay link carries a random channel id (`n`) and a one-off public key (`k`). The customer signs an EIP-3009 authorization (about 150 s validity, chain time) and publishes it on Nostr; the register relays it only if it exactly matches the charge on screen and replies **signed with the charge's key**. The customer page accepts only replies with that key and a valid signature, so a relay or a bystander can't fake a "failed" answer to trigger a second payment. With no answer, the page waits until the authorization expires on-chain before offering a normal payment. Below 0.02 POL, charges use normal payments.

## Security

Protections: strict CSP (no inline or third-party scripts), `frame-ancestors 'none'`, HSTS, nosniff; all dynamic HTML escaped; no store private keys ever; exact-match relaying with a cap of 3 attempts per charge; authenticated relay replies; second-source payment confirmation; signed and re-verified owner record; strict parsing of signing requests (`sign.html` signs only Reji's own message format); CSV cells can't start formulas; PIN lock with growing lockout.

Limits to know: someone with the unlocked register and developer tools can change local data (the owner strip makes address edits visible); browser extensions on the register can read the page, so use a dedicated browser profile without extensions; customers should scan only the QR on the register screen; the gas wallet is a hot key, so keep a small float. This is a careful review plus automated tests, not a professional audit.

## Development

```sh
python3 -m http.server 8080        # from the project root
node --test                        # unit tests (46)
npm i -D playwright && npx playwright install chromium
node tests/e2e.mjs                 # end to end (130 checks, screenshots in tests/shots/)
node tests/devices.mjs             # 13 phones and tablets × 10 screens (tests/shots/devices/)
node tests/landing-shots.mjs       # landing screenshots and demo frames (after e2e)
```

The end-to-end test runs against a mocked chain (it "mines" relayed transactions), an in-process Nostr relay that checks every signature and can act hostile (injects forged replies), and wallets that sign with real test keys. Nothing here has been run against a live chain or live relays: try Test mode (Polygon Amoy) before going live.
