# 日記サイト（GitHub Pages）

## 画面

- `editor.html`：下書き・写真の追加（端末内に保存）
- `preview.html`：公開前の確認
- `index.html`：公開済み記事のみ表示

記事は `posts/YYYY-MM-DD.json` に1日1ファイル，公開順の軽量な一覧は `data/index.json` に保存されます．写真は `images/` に保存します．

## 編集

編集画面の「詳細」を開くと，天気・タグ・ひとことを入力できます．写真は複数枚選択でき，**写真ごとにタイトル・キャプションを独立して設定**できます．保存とプレビューに反映されます．下書きは IndexedDB に端末内保存されます．

## GitHubログインの準備

GitHub Pagesは静的サイトのため，OAuth認証に追加のサービスが必要です．GitHub AppのDevice FlowとCloudflare Workerの組み合わせを想定しています．準備が完了するまでは編集画面の「GitHubでログイン」ボタンは利用できません．「接続設定」から既存PATを入力して公開する機能は残しています．

1. GitHubで**GitHub App**を作成し，Repository permissionsの **Contents: Read and write** を許可．Appを `Dopa-gaki/.github.io` **だけ**にインストール．GitHub App設定で **Device Flow を有効化**．
2. `auth/github-device-worker.js` を Cloudflare Workers にデプロイ．Worker環境変数 `GITHUB_CLIENT_ID` に GitHub AppのClient ID，`ALLOWED_ORIGIN` に `https://dopa-gaki.github.io` を設定．WorkerにはClient Secretを置く必要はありません．本番利用時はWorker側でレート制限を有効化してください．
3. `assets/auth-config.js` の `workerUrl` にWorkerのHTTPS URLを設定し，日記フォルダにコミット．**アクセストークンやClient Secretはこのファイルに記載しないでください．**
4. 編集画面の「GitHubでログイン」を押すとGitHubの認証ページが開きます．編集画面に表示されるコードを入力してください．本人確認が完了すると，ログインは同じタブ内のセッション中だけ維持されます．
5. `公開する` を押すと，選択中の記事JSON・記事一覧・新規画像を1コミットにまとめてGitHubへ保存します．

GitHubのリポジトリ設定やGitHub Appのインストール範囲はユーザー自身が管理します．公開フォルダのHTMLは誰でも開けますが，認証済みかつGitHub Appが権限を持つアカウントしか書き込みできません．ログインのトークンはブラウザ内の `sessionStorage` に保存するため，端末とブラウザのセキュリティには注意してください．

## ZIPで公開

ログイン設定前でも「ZIP出力」で記事・写真をダウンロードできます．ZIPを展開して日記フォルダ内の対応する場所へアップロードしてください．
