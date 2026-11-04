# scripts

リリースの作業で使うスクリプトです．

| ファイル | 何をするか |
|---|---|
| `make-latest-json.mjs` | 自動更新用の `latest.json` を作ります．配布物（.exe・.msi・.app.tar.gz）と，それぞれの署名（.sig）を 1 つのフォルダに集めてから実行します．できた `latest.json` を Release に添付すると，前の版のアプリが新しい版を見つけて更新できるようになります． |

## 署名について

- 配布物の署名には，updater 用の秘密鍵が要ります．ビルドする前に環境変数 `TAURI_SIGNING_PRIVATE_KEY`（鍵の中身かファイルのパス）と `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` を設定します．
- 公開鍵は `src-tauri/tauri.conf.json` の `plugins.updater.pubkey` にあります．秘密鍵をなくすと，すでに配った版へ更新を届けられなくなります．秘密鍵はリポジトリに入れません．
