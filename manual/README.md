# スタッフ運用マニュアルの元データ / Staff manual source

このフォルダから `docs/reji-manual-ja.pdf` を作ります。公開サイトには載りません（`tools/build.mjs` が `.assetsignore` に `manual` を入れます）。

## 作り方

```sh
node tests/e2e.mjs          # 画面のスクリーンショットを撮る（tests/shots/）
python3 manual/images.py    # マニュアル用の画像を作る（manual/img/）
node manual/build.mjs       # PDFを作る（docs/reji-manual-ja.pdf）
```

- 文章とレイアウトは `manual/runbook.html` を直接編集します。各章は `<section class="chapter">` で、1つ目から新しいページで始まります。
- 画像の切り出し（スマホの画面をどこまで使うか）は、`manual/images.py` の `CROPS` で決めています。
- `manual/img/` の画像も入れてあるので、画面が変わっていなければ `node manual/build.mjs` だけでPDFを作り直せます。
- Playwright を別の場所に入れている場合は、`PLAYWRIGHT_MODULE` でその場所を指定します。

---

Builds `docs/reji-manual-ja.pdf`. Kept off the public site (`tools/build.mjs` adds `manual` to `.assetsignore`). Run the end-to-end tests for fresh screenshots, `python3 manual/images.py` for the manual's images, then `node manual/build.mjs`. Edit text and layout in `manual/runbook.html`; image crops live in `CROPS` in `manual/images.py`. The generated images are committed, so `node manual/build.mjs` alone rebuilds the PDF when the screens haven't changed.
