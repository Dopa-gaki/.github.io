# 別オリジン編集画面への移行（v4）

**GitHubへのWorkerコード保存と，Cloudflareへのデプロイは別操作です．**
現行のGitHubリポジトリと日記公開URLは変えません．Cloudflareの既存 `diary-auth` Workerが編集用HTML・CSS・JavaScript・公開済み日記JSON・写真を安全な許可リストから配信します．

- **新しい編集画面**：https://diary-auth.ueda-photo-11.workers.dev/editor.html
- **新しいプレビュー**：https://diary-auth.ueda-photo-11.workers.dev/preview.html
- **公開ページ（変更なし）**：https://dopa-gaki.github.io/.github.io/diary/
- **旧下書きの書き出し**：https://dopa-gaki.github.io/.github.io/diary/migrate.html
- **新しい下書きへの取り込み**：https://diary-auth.ueda-photo-11.workers.dev/import.html

## Cloudflareで必要な最後の操作
Cloudflare → Workers & Pages → `diary-auth` → Edit code で，GitHubの `diary/auth/diary-secure-worker.js` を全文コピーして置き換え，Deployしてください．
すでに登録した Client ID，Client Secret，App ID，Private Key，`DIARY_SESSIONS` KVバインディングは変更しません．
**新しい編集URLはWorkerのデプロイ後に使えるようになります．**

## 旧下書きを残したまま移行する
旧ドメインの `migrate.html` で **バックアップを保存** → 新ドメインの `import.html` で取り込む → 新しい編集画面で文章・写真を確認 → 旧 `migrate.html` で元データを削除します．
バックアップJSONには私的な日記と写真が含まれるため，安全に保管し，移行後は削除してください．**元の下書きは自動削除しません．**

## 安全性の範囲
独立したWorkerオリジン上のIndexedDBを，GitHub Pages側のPNmapなどのJavaScriptが直接読み取ることはできません．ただし，GitHub AppのContents権限そのものは同じリポジトリ全体に及ぶため，Workerの秘密鍵漏えいまでは防げません．

---

# 日記サイト（安全な公開機能）

- 編集：`editor.html`
- 確認：`preview.html`
- 公開：`index.html`

日記は `posts/YYYY-MM-DD.json` に1日1ファイル，記事一覧は `data/index.json`，写真は `images/` に保存します．写真ごとにタイトル・キャプションを記入できます．

## 公開済み日記の編集・削除

編集画面の「公開済み」を開き，過去の記事を選択すると本文と写真を再編集できます．「公開する」で同じ記事を上書きします．「公開を削除」で削除確認が開き，「削除」と入力して確定すると，公開記事・その記事に付属する画像・一覧登録をGitHubから削除します．Gitの履歴や第三者のコピーまでは消えません．

## 安全なGitHub認証への移行（Cloudflareで追加設定が必要）

**GitHub Pagesにコードをアップロードしただけでは認証サーバーは切り替わりません．** Cloudflareの既存 `diary-auth` Workerを [新しいWorkerコード](auth/diary-secure-worker.js) で置き換える必要があります．古い `auth/github-device-worker.js` は廃止します．

新方式の仕様：

- GitHub App OAuth Web Flow（PKCE / state），本人のGitHubアカウント確認
- GitHubのユーザーアクセストークン・インストールトークン・秘密鍵は**ブラウザに送信しない**
- GitHubのClient Secretと秘密鍵はCloudflare **Secrets** に保管
- ブラウザには4時間で失効するランダムな日記専用セッションのみ渡す．メモリだけに保持するため，リロードでログアウト
- Cloudflare Worker側で日記ファイルに限定して公開・更新・削除を処理
- GitHub AppのContents権限自体はリポジトリ全体に及ぶため，**Cloudflareの秘密鍵が漏れた場合の影響まで完全には限定できない**

### 1．GitHub App側

https://github.com/settings/apps にアクセスし，作成済みの日記用Appで以下を設定してください．

1. **Callback URL**：`https://diary-auth.ueda-photo-11.workers.dev/auth/callback`
2. **Generate a new client secret** からClient Secretを生成
3. **Private keys → Generate a private key** でPEM秘密鍵をダウンロード
4. App ID（数値）・Client IDを控える
5. Repository permissions → **Contents: Read and write**，Install App → **Only select repositories** → `.github.io` のみ

**Client Secret・PEM秘密鍵はGitHubリポジトリ，日記，チャットへ貼り付けないでください．** GitHubのDevice Flowは新方式では使用しません．移行完了後は無効化できます．

### 2．Cloudflare側

Cloudflare Dashboard → Workers & Pages → `diary-auth` → Settings → Variables and Secrets

| 名前 | 種類 | 値 |
|---|---|---|
| `GITHUB_CLIENT_ID` | Text | 既存のGitHub App Client ID |
| `GITHUB_CLIENT_SECRET` | **Secret** | GitHub AppのClient Secret |
| `GITHUB_APP_ID` | Text | GitHub Appの数値App ID |
| `GITHUB_APP_PRIVATE_KEY` | **Secret** | GitHub AppのPEM秘密鍵の全文 |
| `ALLOWED_ORIGIN` | Text | `https://dopa-gaki.github.io`（従来値） |

次に，Cloudflare → **Storage & databases → KV** から，例えば `diary-sessions` のKV namespaceを新規作成します．`diary-auth` の **Bindings → Add binding → KV namespace** で，**Variable name を `DIARY_SESSIONS`** として追加します．KVにはGitHub秘密鍵を入れません．

最後に Workers & Pages → `diary-auth` → **Edit code** で `auth/diary-secure-worker.js` を全文貼り付けて **Deploy** します．Worker URLは変わりません．

### 3．ログインを検証

https://dopa-gaki.github.io/.github.io/diary/editor.html

「GitHubでログイン」→ GitHub上で承認 → 編集ページの「接続済み」を確認．以前の8文字コード入力は不要です．Workerの切り替え前はログインできません．

## 注意点

- GitHub Pages上の `editor.html` は誰でも開けますが，記事の公開・編集・削除にはGitHubで本人認証が必要です．
- ブラウザの下書きは IndexedDB に保存されます．同じGitHub Pagesオリジンで動く他のアプリとブラウザ保存領域を共有するため，同一オリジンの悪意あるスクリプトから下書きを完全に隔離することはできません．
- GitHubに公開した写真と文章は公開情報です．削除後もGit履歴，キャッシュ，第三者の保存に残ることがあります．
- Cloudflareアカウントには2段階認証を設定してください．

既存のPNmap・SNmap・彗星マップ・捕獲かんらん岩マップのファイルは変更しません．
