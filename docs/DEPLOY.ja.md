# Reji 公開手順（GitHub → Cloudflare Workers）

費用はかかりません。Cloudflare Workers の無料プランは商用利用ができ、静的ファイルの配信は回数無制限・無料です（Cloudflare は Pages を Workers に統合しました）。Rejiは変換作業（ビルド）なしでも動きますが、X などにリンクを貼ったときに画像つきのカードを出すため、仕上げの1行（`node tools/build.mjs`）を設定します。追加のソフトのインストールは不要です。

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
   - ファイルは105個あり、ブラウザからは一度に100個までなので、**2回に分けます**。1回目は `assets` フォルダ以外のすべて（34個）、2回目は `assets` フォルダ（71個）をドラッグして、それぞれ「Commit changes」を押します。名前が「.」で始まるファイル（`.assetsignore` など）はMacでは見えないことがありますが、なくてもかまいません（`.assetsignore` はビルドのときに自動で作られます）。
   - 確認：リポジトリを開いたとき、一番上の階層に `index.html` と `_headers` が見えていれば正しい置き方です（`reji` フォルダの中に入っていたらやり直し）。

## 2. Cloudflare Workers で公開する

1. https://dash.cloudflare.com で無料アカウントを作ります。
2. **最初に、workers.dev のサブドメインを確認します。** 「Workers & Pages」の概要ページ（Account details の「Subdomain」）に表示される、アカウント全体で1つの名前です。公開アドレスは `https://<Workerの名前>.<サブドメイン>.workers.dev` になります。
   - **サブドメインにもWorkerの名前にも、jpyc・metamask・hashport・wallet などのブランド名や暗号資産の言葉を入れないでください。** ブランド名に見えるアドレスは、MetaMaskなどの詐欺サイト検知で「このWebサイトは有害な可能性があります」と警告され、お客様が開けなくなります（例：`tamago-cafe` は良い、`jpyc` はだめ）。ビルドのログにも警告が出ます。
   - 「Change」で変えられます。変えた時点で古いアドレスは開けなくなるので、すでに使っている場合は先にバックアップを取ります（7章）。
3. 「Workers & Pages」→「Create」（作成）→「Import a repository」（リポジトリをインポート）→ GitHub と連携し、このリポジトリを選びます（このリポジトリだけを許可してもかまいません）。
4. 次のように設定します。

   | 項目 | 設定 |
   |---|---|
   | Project name（Workerの名前） | `reji`（リポジトリの `wrangler.jsonc` の `name` と同じにします） |
   | Build command | `node tools/build.mjs` |
   | Deploy command | `npx wrangler deploy`（最初から入っています） |
   | Build variables（ビルド用の変数） | `SITE_URL` = 公開アドレス（例：`https://reji.tamago-cafe.workers.dev`）。運営者の表示は6章 |

5. 「Deploy」を押します。1〜2分で公開されます。
   - 公開されるのはサイトのファイルだけです（`tests`・`tools`・設定ファイルは `.assetsignore` で除外されます）。
   - Workers は `pay.html` を `/pay` で表示します（`/pay.html` は自動で `/pay` に移ります）。リンクやQRコードはそのまま使え、オフラインでも開けます。

## 3. 公開後の確認（5〜10分）

1. 公開アドレスを開き、トップページ →「Rejiを無料で始める」で「かんたん設定」が始まることを確認します。
2. かんたん設定で「テストモードで試す」を選んで最後まで進め、1回お会計をします。テスト用のJPYCは https://faucet.jpyc.co.jp で受け取れます。
3. （任意）手数料なし決済：設定で「ウォレットで店主確認」→「ガス用ウォレットを作る」→ テスト用POL（Polygon Amoy）を入れる → POLを持っていないスマホで支払ってみます。
4. **MetaMask のアプリ内ブラウザで公開アドレスを開き、警告が出ないことを確認します**（出る場合は7章）。
5. （任意）「設定」→「このお店の情報」で紹介やイベントを入れて保存し、「ページを開く」でお店のページが表示されることを確認します。
6. （任意）セキュリティヘッダーの確認：パソコンのブラウザで開発者ツール →「ネットワーク」→ `index.html` の応答ヘッダーに `Content-Security-Policy` と `X-Frame-Options: DENY` があれば、`_headers` が効いています。
7. リンクのカード表示：X の投稿画面やLINEに公開アドレスを貼り、画像つきのカードが出ることを確認します。出ない場合は、Build command が `node tools/build.mjs`、ビルド変数 `SITE_URL` が公開アドレスになっているか確認して、もう一度デプロイします（Worker の「Deployments」または「Builds」から）。一度読み込んだカードは各サービスがしばらく覚えているので、URLの最後に `?v=2` を付けて試してください。Facebook は Sharing Debugger（https://developers.facebook.com/tools/debug/）で読み込み直せます。

## 4. 更新のしかた

- GitHub のファイルを更新すると（アップロードで上書き、または `git push`）、Cloudflare が自動で公開し直します（1〜2分）。
- アップロードで更新するときも、1章と同じく2回に分けます（同じ名前のファイルは上書きされます）。
- 使っている端末は、次に開いたときに新しい版へ切り替わります。オフライン用のキャッシュ名はデプロイのたびに自動で変わる（`tools/build.mjs`）ので、`sw.js` を手で直す必要はありません。
- マニュアルを直したときは `docs/reji-manual-ja.pdf` も差し替えます（トップページと、かんたん設定の最後の画面からリンクしています）。

## 5. 独自ドメイン（任意・おすすめ）

独自ドメインは、ウォレットの詐欺サイト検知にもっとも強く、お客様にも信頼されやすい方法です（.com で年1,500〜2,000円ほど）。Workers で使うには、ドメインのネームサーバーが Cloudflare にある必要があります（Cloudflare でドメインを買うと、最初からそうなっています）。

1. Worker の「Settings」→「Domains & Routes」→「Add」→「Custom domain」で、例：`reji.example.jp` を追加します。
2. ビルド変数 `SITE_URL` を `https://reji.example.jp` にして、もう一度デプロイします。
3. 古いアドレスで使っていた端末は、バックアップを取ってから、新しいアドレスで「バックアップから戻す」を使います（7章）。

## 6. 利用規約・プライバシーポリシー（運営者の表示）

利用規約（`terms.html`）と、プライバシーポリシー・外部送信について（`privacy.html`）を用意しています。トップページ、お支払い・レシート・店主確認の画面、レジの「設定」→「このアプリについて」、かんたん設定の最初の画面からリンクしています。

運営者名と連絡先を載せる場合は、Worker の「Settings」→「Build」（ビルド）→「Variables and secrets」（ビルド用の変数）に、次を追加してもう一度デプロイします（どちらか一方でもかまいません）。設定しない場合、この欄は表示されません。

| 変数名 | 例 |
|---|---|
| `OPERATOR_NAME` | `Reji 運営：山田 太郎` |
| `CONTACT` | `hello@example.jp`（メール）または `https://github.com/…/issues`（URL） |

外部のサービス（公開ノード、Nostrリレー）を追加・変更したときは、`privacy.html` の「6. 外部送信について」の表も直してください。

## 運営者として知っておくこと

- **費用**：静的ファイルの配信だけです。入金の確認（RPC）、手数料なし決済のガス代、Nostrの通信は、各お店の端末から直接行われ、運営者のサーバーやアカウントを通りません。
- **データ**：各お店の売上・設定は、そのお店の端末の中だけにあります。運営者は見られず、預かりもしません。
- **お店が増えたとき**：各お店がそれぞれの回線から公開ノードにつなぐため、お店が増えても運営者側で混み合うことはありません。混雑しやすいお店は、設定の「接続先（RPC）」から自分専用の接続先（無料アカウント）を追加できます。

## 7. ウォレットで「有害な可能性があります」と出たとき

MetaMaskなどのウォレットは、暗号資産のブランドになりすましたサイトを自動で止めています。Rejiのコードではなく、**公開アドレス**が判断されています。

1. アドレスにブランド名（jpyc・metamask・hashport・wallet など）が入っていないか確認します。
2. 入っていたら、**先にバックアップを取ります。** 古いアドレスで「設定」→「データ」→「バックアップを保存」（お店ごと・端末ごと）。サブドメインを変えた時点で、古いアドレスは開けなくなります。
3. workers.dev のサブドメインを、ブランド名を含まない名前に変えます（「Workers & Pages」の概要ページ →「Subdomain」の「Change」）。または独自ドメインを使います（5章。いちばん確実です）。
4. ビルド変数 `SITE_URL` を新しいアドレスにしてもう一度デプロイし、新しいアドレスで「バックアップから戻す」を使います。店頭POPは印刷し直し、SNSなどに貼ったリンクも新しいアドレスにします。
5. ブランド名を含まないアドレスでも警告が出る場合は、MetaMask の窓口（https://github.com/metamask/eth-phishing-detect/issues）で、サイトの持ち主として見直しを依頼します。
