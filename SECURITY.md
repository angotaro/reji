# Security Policy / セキュリティについて

Reji handles payments, so security reports matter a lot to us. Thank you for helping keep stores and their customers safe.

Reji は支払いを扱うアプリです。脆弱性のご報告を歓迎します。お店とお客様を守るためのご協力に感謝します。

## Reporting a vulnerability / 脆弱性の報告

**Please don't open a public issue for security problems.**
**セキュリティの問題は、公開の Issue に書かないでください。**

Report privately through GitHub: open this repository's **Security** tab and choose **Report a vulnerability**. Only the maintainers can see these reports.
GitHub の非公開の報告をお使いください：このリポジトリの「Security」タブ →「Report a vulnerability」。報告は管理者だけが見られます。

Please include / 報告に含めていただきたいこと:
- what is affected, and the steps to reproduce it / 影響する箇所と、再現の手順
- the impact you expect, for example funds going to the wrong address, a forged receipt or script injection / 想定される影響（例：別のアドレスに送金される、レシートの偽造、スクリプトの埋め込み）
- the page address, browser and wallet you used / ページのアドレス、ブラウザ、ウォレットの種類

**Never put a seed phrase or private key in a report, and never send one to anyone who says they are from Reji.**
**報告に、シードフレーズや秘密鍵を絶対に書かないでください。Reji を名乗る相手に送ることも、絶対にしないでください。**

## What to expect / 対応の流れ

We aim to acknowledge reports within 7 days, keep you updated, and release a fix before the details are made public. Please allow reasonable time to fix an issue (up to 90 days) before disclosing it yourself.
7日以内に受け取りをお知らせし、進み具合をお伝えします。修正を公開してから、内容を公表します。ご自身で公表される前に、修正のための時間（最大90日）をいただけるとありがたいです。

## Scope / 対象

In scope / 対象:
- the code in this repository: the register, payment page, receipts, store page, owner signatures, the no-fee payment relay, and tip address verification
- このリポジトリのコード：レジ、お支払いページ、レシート、お店のページ、店主の署名、手数料なし決済の中継、応援の受取先の確認

Out of scope / 対象外:
- wallet apps, blockchains, public RPC nodes and Nostr relays run by others / 他者が運営するウォレット、ブロックチェーン、公開ノード、Nostr リレー
- copies of Reji published by other people / 他の人が公開している Reji のコピー
- phishing or scams aimed at users, and attacks that need someone's already unlocked device / 利用者を狙ったフィッシングや詐欺、ロック解除済みの端末を使う攻撃
- denial-of-service attacks on public infrastructure / 公開インフラへの負荷をかける攻撃

## Testing safely / 安全な確かめ方

Use Test mode (Polygon Amoy with test JPYC) and your own wallets and stores. Don't test against real stores, other people's funds or other people's data. Good-faith research that follows this policy is welcome.
テストモード（Polygon Amoy とテスト用 JPYC）と、ご自身のウォレットとお店でお確かめください。実際のお店や、他人の資金・データを対象にしないでください。この方針に沿った善意の調査を歓迎します。
