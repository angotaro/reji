# Reji 公開手順（GitHub → Cloudflare Pages）

費用はかかりません。Cloudflare Pages の無料プランは商用利用ができ、静的ファイルの配信は無料です。Rejiは変換作業（ビルド）なしでも動きますが、X などにリンクを貼ったときに画像つきのカードを出すため、仕上げの1行（`node tools/build.mjs`）を設定します。追加のソフトのインストールは不要です。

> Vercel の無料プラン（Hobby）は商用利用ができないため、お店での決済には使えません。

## 1. GitHub にファイルを置く

1. https://github.com で無料アカウントを作ります。
2. 右上の「＋」→「New repository」。名前（例：`reji`）を入れ、Public / Private どちらでもかまいません。「Create repository」を押します。
3. `reji.zip` を展開し、**`reji` フォルダの中身**（`index.html`、`app.html`、`assets` フォルダなど）をアップロードします。
   - ブラウザの場合：リポジトリの画面で「uploading an existing file」を押し、中身をまとめてドラッグ＆ドロップ →「Commit changes」。
   - コマンドの場合：
     ```sh
     cd reji
     git init && git add . && git commit -m "Reji v0.1.2"
     git branch -M main
     git remote add origin https://github.com/<ユーザー名>/reji.git
     git push -u origin main
     ```
   - ファイルは94個です。ブラウザからは一度に100個までアップロードできるので、1回で入ります。`.gitignore` と `.nojekyll` は、パソコンで見えなくてもかまいません（Cloudflare では使いません）。
   - 確認：リポジトリを開いたとき、一番上の階層に `index.html` と `_headers` が見えていれば正しい置き方です（`reji` フォルダの中に入っていたらやり直し）。

## 2. Cloudflare Pages につなぐ

1. https://dash.cloudflare.com で無料アカウントを作ります。
2. 左のメニュー「Workers & Pages」→「Create」（作成）→ **「Pages」タブ** →「Connect to Git」（Import an existing Git repository）。
   - 「Workers」タブではなく「Pages」タブを選びます。
3. 「Connect GitHub」を押し、GitHub で Cloudflare のアプリを許可します（このリポジトリだけを許可してもかまいません）。リポジトリを選んで「Begin setup」。
4. 次のように設定します。

   | 項目 | 設定 |
   |---|---|
   | Project name | 例：`reji`（公開アドレスが `https://reji.pages.dev` になります。使われている場合は別の名前に） |
   | Production branch | `main` |
   | Framework preset | `None` |
   | Build command | `node tools/build.mjs` |
   | Build output directory | `/` |
   | Environment variables | なし（独自ドメインを使うときは `SITE_URL`。5章。運営者の表示は6章） |

5. 「Save and Deploy」を押します。1〜2分で公開され、`https://<Project name>.pages.dev` が表示されます。

## 3. 公開後の確認（5〜10分）

1. 公開アドレスを開き、トップページ →「Rejiを無料で始める」で「かんたん設定」が始まることを確認します。
2. かんたん設定で「テストモードで試す」を選んで最後まで進め、1回お会計をします。テスト用のJPYCは https://faucet.jpyc.co.jp で受け取れます。
3. （任意）手数料なし決済：設定で「ウォレットで店主確認」→「ガス用ウォレットを作る」→ テスト用POL（Polygon Amoy）を入れる → POLを持っていないスマホで支払ってみます。
4. （任意）「設定」→「このお店の情報」で紹介やイベントを入れて保存し、「ページを開く」でお店のページが表示されることを確認します。
5. （任意）セキュリティヘッダーの確認：パソコンのブラウザで開発者ツール →「ネットワーク」→ `index.html` の応答ヘッダーに `Content-Security-Policy` と `X-Frame-Options: DENY` があれば、`_headers` が効いています。
6. リンクのカード表示：X の投稿画面やLINEに公開アドレスを貼り、画像つきのカードが出ることを確認します。出ない場合は、Build command が `node tools/build.mjs` になっているか確認して再デプロイ（Deployments →「Retry deployment」）します。一度読み込んだカードは各サービスがしばらく覚えているので、URLの最後に `?v=2` を付けて試してください。Facebook は Sharing Debugger（https://developers.facebook.com/tools/debug/）で読み込み直せます。

## 4. 更新のしかた

- GitHub のファイルを更新すると（アップロードで上書き、または `git push`）、Cloudflare が自動で公開し直します（1〜2分）。
- 使っている端末は、次に開いたときに新しい版へ切り替わります。オフライン用のキャッシュ名はデプロイのたびに自動で変わる（`tools/build.mjs`）ので、`sw.js` を手で直す必要はありません。
- マニュアルを直したときは `docs/reji-manual-ja.pdf` も差し替えます（トップページと、かんたん設定の最後の画面からリンクしています）。

## 5. 独自ドメイン（任意）

Cloudflare のプロジェクト画面 →「Custom domains」→「Set up a custom domain」から設定します。

独自ドメインでリンクのカードを出すには、「Settings」→「Variables and Secrets」（または「Environment variables」）の本番（Production）に `SITE_URL` = `https://あなたのドメイン` を追加し、もう一度デプロイします。設定しない場合、カードの画像は `https://<Project name>.pages.dev` から読み込まれます（表示はされます）。

## 6. 利用規約・プライバシーポリシー（運営者の表示）

利用規約（`terms.html`）と、プライバシーポリシー・外部送信について（`privacy.html`）を用意しています。トップページ、お支払い・レシート・店主確認の画面、レジの「設定」→「このアプリについて」、かんたん設定の最初の画面からリンクしています。

運営者名と連絡先を載せる場合は、Cloudflare の「Settings」→「Variables and Secrets」（または「Environment variables」）の本番（Production）に、次を追加してもう一度デプロイします（どちらか一方でもかまいません）。設定しない場合、この欄は表示されません。

| 変数名 | 例 |
|---|---|
| `OPERATOR_NAME` | `Reji 運営：山田 太郎` |
| `CONTACT` | `hello@example.jp`（メール）または `https://github.com/…/issues`（URL） |

外部のサービス（公開ノード、Nostrリレー）を追加・変更したときは、`privacy.html` の「6. 外部送信について」の表も直してください。

## 運営者として知っておくこと

- **費用**：静的ファイルの配信だけです。入金の確認（RPC）、手数料なし決済のガス代、Nostrの通信は、各お店の端末から直接行われ、運営者のサーバーやアカウントを通りません。
- **データ**：各お店の売上・設定は、そのお店の端末の中だけにあります。運営者は見られず、預かりもしません。
- **お店が増えたとき**：各お店がそれぞれの回線から公開ノードにつなぐため、お店が増えても運営者側で混み合うことはありません。混雑しやすいお店は、設定の「接続先（RPC）」から自分専用の接続先（無料アカウント）を追加できます。
