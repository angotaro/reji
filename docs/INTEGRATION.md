# Rejiとの連携 / Integrating with Reji

ほかのWebアプリや3D空間などから、Rejiのお支払いページを使う方法です。
How to use Reji's payment page from another web app, a 3D space or any other platform. (English below.)

---

## 日本語

Rejiには、運営のサーバーもAPIもありません。リンクでお支払いページを開き、支払いが終わったかどうかは、ブロックチェーンで確かめます。運営の都合に左右されず、APIキーも登録も要りません。

### 1. 流れ

1. あなたのアプリが、注文ごとにお支払いリンクを作ります。
2. お客様がリンクを開き（新しいタブ、またはウォレットアプリのブラウザ）、自分のウォレットから支払います。
3. JPYCが、お店の受取アドレスに直接届きます。
4. あなたのシステムがチェーン上の送金を見つけて、注文を「支払い済み」にします。

### 2. お支払いリンク

`https://〔Rejiのアドレス〕/pay.html?` に、次のパラメーターをつけます。

| パラメーター | | 内容 |
|---|---|---|
| `to` | 必須 | お店の受取アドレス。ウォレットに表示されるとおり（大文字・小文字の混ざった形）か、すべて小文字で。大文字・小文字の並びが正しくないアドレスは、打ち間違いとして使えません |
| `c` | 必須 | チェーンID。本番：137（Polygon）、43114（Avalanche）、1（Ethereum）、8217（Kaia）。テスト：80002（Polygon Amoy）、43113（Avalanche Fuji）、11155111（Sepolia）、1001（Kaia Kairos） |
| `a` | 必須 | 金額（円）。1〜10,000,000の整数 |
| `u` | 連携では必須 | 照合用の端数（1〜999,999）。いちばん小さい単位で金額に足されます：チェーン上の金額 ＝ a × 10¹⁸ ＋ u。同じアドレス・同じ金額で受付中の注文どうしで、重ならないようにします |
| `e` | おすすめ | 有効期限（Unix時刻、秒） |
| `r` | おすすめ | 注文番号など（40文字まで）。お支払いページとレシートに表示されます |
| `s` | | お店の名前（60文字まで） |
| `d` | | 商品の説明（120文字まで） |
| `b` | | お店のプロフィールID（お店のページのアドレス `store.html#p=` のあとの部分）。そのお店の受取アドレスと一致しないリンクは、Rejiが支払いを止めます |
| `bc` | | お店の色（16進数6桁、#なし） |

- `n`・`k`・`tip` は使いません（Rejiのレジ専用です）。
- 手数料なし決済（ガスレス）は、Rejiのレジが作った支払いだけで使えます。連携のリンクは通常の支払いで、ネットワーク手数料はお客様のウォレットで払います。なお、HashPort Walletの「コピーして送る」では、PolygonのJPYC送金は手数料なしの対象です。
- 安全のため、ほかのサイトの中への埋め込み（iframe）はできません。新しいタブか、ウォレットアプリのブラウザで開いてください。

### 3. 支払いの確かめ方

次の条件にあう、JPYCの送金イベント（Transfer）を探します。

- コントラクト：`0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29`（対応するすべてのチェーンで同じ）
- `topics[0]`：`0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`（`Transfer(address,address,uint256)`）
- `topics[2]`：お店の受取アドレス（32バイトになるよう、前を0で埋めたもの）
- `data`（金額）：ちょうど a × 10¹⁸ ＋ u
- 範囲：リンクを作ったときのブロックから、有効期限の数分後まで

守ってほしいこと:

- **必ずチェーンで確かめます。** お客様のブラウザから届く「支払いました」や取引ID（tx hash）を、そのまま信じないでください。
- 支払い済みにする前に、**別の公開ノードでも**同じ送金を確かめます。高額な場合は、さらに数ブロック待ちます。
- ひとつの送金（tx hash と logIndex の組み合わせ）は、**一度しか使いません**。
- 「コピーして送る」の支払いは、端数なし（ちょうど a × 10¹⁸）で届くことがあります。同じアドレスで、その金額の受付中の注文がひとつだけのときに限って受け付け、それ以外は人が確認します（Rejiのレジも同じ考え方です）。
- 同じ受取アドレスを、Rejiのレジと同時に使うと、端数が重なることがあります。連携には、**別の受取アドレス**（ウォレット）を使うのがおすすめです。
- 公開ノードは、一度に調べられるブロックの範囲や回数に制限があります。少しずつ（例：500ブロックずつ）調べ、エラーのときは時間をおいて再試行し、複数のノードを使い分けます。Rejiが使っている公開ノードの一覧は `assets/js/config.js` にあります。

### 4. サンプルコード（JavaScript、ライブラリ不要）

下の「Sample code」をご覧ください（日本語・英語で共通です）。

### 5. テスト

Polygon Amoy（`c=80002`）と、JPYC公式の配布ページ（https://faucet.jpyc.co.jp ）のテスト用JPYCで、無料で試せます。

### 6. そのほか

- 報酬ポイントや独自トークンは、この流れに入れません。Rejiが扱うのは、お客様からお店へのJPYCの直接の支払いだけです。
- Rejiは無料のオープンソース（MITライセンス）で、運営のサーバーやサービス保証（SLA）はありません。
- 不具合や質問は Issue へ。セキュリティの問題は、公開の Issue ではなく [SECURITY.md](../SECURITY.md) の手順でお知らせください。

---

## English

Reji has no server and no API. You open its payment page with a link, and you confirm the payment on the blockchain itself. Nothing depends on Reji's operator, and there are no API keys or sign-ups.

### 1. How it works

1. Your app creates a payment link for each order.
2. The customer opens it (in a new tab or a wallet app's browser) and pays from their own wallet.
3. JPYC arrives directly at the store's receiving address.
4. Your system finds the transfer on-chain and marks the order as paid.

### 2. Payment links

Add these parameters to `https://〔Reji's address〕/pay.html?`:

| Parameter | | Meaning |
|---|---|---|
| `to` | required | The store's receiving address, either exactly as the wallet shows it (mixed case) or all lowercase. A mixed-case address with a wrong checksum is rejected as a likely typo |
| `c` | required | Chain ID. Mainnets: 137 (Polygon), 43114 (Avalanche), 1 (Ethereum), 8217 (Kaia). Testnets: 80002 (Polygon Amoy), 43113 (Avalanche Fuji), 11155111 (Sepolia), 1001 (Kaia Kairos) |
| `a` | required | Amount in yen, an integer from 1 to 10,000,000 |
| `u` | required for integrations | A matching fraction from 1 to 999,999, added in the token's smallest unit: on-chain value = a × 10¹⁸ + u. Keep it different between your open orders for the same address and amount |
| `e` | recommended | Expiry, as Unix time in seconds |
| `r` | recommended | Your order number (up to 40 characters), shown on the payment page and the receipt |
| `s` | | Store name (up to 60 characters) |
| `d` | | Item description (up to 120 characters) |
| `b` | | The store's profile ID (the part after `store.html#p=` in the store page's address). If it belongs to a different receiving address, Reji refuses the payment |
| `bc` | | Store colour, 6 hex digits without `#` |

- Don't use `n`, `k` or `tip`; they're for Reji's own register.
- No-fee (gasless) payments only work for charges created by a Reji register. Integration links are normal payments: the customer's wallet pays the network fee. In HashPort Wallet's copy-and-send flow, JPYC transfers on Polygon are eligible for no fees.
- For safety, Reji can't be embedded in another site (no iframes). Open it in a new tab or a wallet app's browser.

### 3. Confirming payment

Look for a JPYC `Transfer` event with:

- contract `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` (the same on every supported chain)
- `topics[0]` = `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` (`Transfer(address,address,uint256)`)
- `topics[2]` = the store's receiving address, left-padded with zeros to 32 bytes
- `data` (the amount) exactly a × 10¹⁸ + u
- from the block when you created the link until a few minutes after it expires

Rules:

- **Always verify on-chain.** Never trust a "paid" signal or a transaction hash coming from the customer's browser.
- Before marking an order paid, **confirm the same transfer on a second public node**. For high-value goods, also wait a few more blocks.
- **Use each transfer only once** (the pair of tx hash and log index).
- Copy-and-send payments may arrive without the fraction (exactly a × 10¹⁸). Accept them only when exactly one open order for that address has that amount; otherwise review by hand. Reji's register works the same way.
- Using the same receiving address with a Reji register at the same time can make fractions collide. **Use a separate receiving address** (wallet) for integrations.
- Public nodes limit block ranges and request rates. Query in small steps (for example 500 blocks), back off on errors and spread requests over several nodes. The public nodes Reji uses are listed in `assets/js/config.js`.

### 4. Testing

Use Polygon Amoy (`c=80002`) with free test JPYC from JPYC's faucet (https://faucet.jpyc.co.jp).

### 5. Other notes

- Keep reward points and your own tokens out of this flow. Reji handles only direct JPYC payments from customer to store.
- Reji is free, open source (MIT) software with no server and no service guarantee (SLA).
- Questions and bugs: open an issue. Security problems: please follow [SECURITY.md](../SECURITY.md) rather than opening a public issue.

---

## Sample code

A small module with no dependencies (Node 18+ or a modern browser):

```js
// Reji payment links and on-chain confirmation. No dependencies: Node 18+ or a modern browser.
const JPYC = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29'; // the same address on every supported chain
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // Transfer(address,address,uint256)
const UNIT = 10n ** 18n; // JPYC has 18 decimals
const hex = (n) => '0x' + n.toString(16);

/** A payment link. `suffix` (1–999999) must differ between your open orders for the same address and amount. */
export function makePayLink({ site, to, chainId, yen, suffix, ref, expiresAt, store, items, profile }) {
  const p = new URLSearchParams({ to, c: String(chainId), a: String(yen), u: String(suffix) });
  if (ref) p.set('r', ref); // your order number (up to 40 characters)
  if (expiresAt) p.set('e', String(Math.floor(expiresAt / 1000)));
  if (store) p.set('s', store);
  if (items) p.set('d', items);
  if (profile) p.set('b', profile); // the store's profile ID: must belong to the same receiving address
  return `${site.replace(/\/$/, '')}/pay.html?${p}`;
}

async function rpc(url, method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

export const latestBlock = async (url) => Number(await rpc(url, 'eth_blockNumber', []));

/** Looks for a JPYC transfer of exactly `yen` + `suffix` to `to`, from `fromBlock` on.
 *  Returns { txHash, logIndex, from, block } or null. */
export async function findPayment({ url, to, yen, suffix, fromBlock, toBlock }) {
  const want = BigInt(yen) * UNIT + BigInt(suffix);
  const topicTo = '0x' + to.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const last = toBlock ?? (await latestBlock(url));
  for (let start = fromBlock; start <= last; start += 500) { // public nodes limit how many blocks one query may cover
    const end = Math.min(start + 499, last);
    const logs = await rpc(url, 'eth_getLogs', [{ address: JPYC, topics: [TRANSFER, null, topicTo], fromBlock: hex(start), toBlock: hex(end) }]);
    const hit = logs.find((l) => !l.removed && BigInt(l.data) === want);
    if (hit) return { txHash: hit.transactionHash, logIndex: Number(hit.logIndex), from: '0x' + hit.topics[1].slice(26), block: Number(hit.blockNumber) };
  }
  return null;
}
```

Using it:

```js
// When the order is placed: remember the current block, then show the link.
const site = 'https://〔Reji's address〕';
const fromBlock = (await latestBlock(RPC_A)) - 5; // a little before now
const link = makePayLink({ site, to: STORE, chainId: 137, yen: 1200, suffix: 4321, ref: 'SP-0001', expiresAt: Date.now() + 15 * 60_000 });

// Then, every 10 seconds or so until a few minutes after the order expires:
const a = await findPayment({ url: RPC_A, to: STORE, yen: 1200, suffix: 4321, fromBlock });
if (a) {
  const b = await findPayment({ url: RPC_B, to: STORE, yen: 1200, suffix: 4321, fromBlock: a.block, toBlock: a.block }); // a second, independent node
  if (b && b.txHash === a.txHash) markPaid(order, a.txHash, a.logIndex); // never use the same txHash + logIndex twice
}
```

`RPC_A` and `RPC_B` are two different public nodes for the chain, `STORE` is the receiving address, and `markPaid` is your own function.
