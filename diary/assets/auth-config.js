// GitHub App + Cloudflare Worker を使った日記の認証設定．
// このファイルにアクセストークン・Client Secret・パスワードを記入しないこと．
window.DIARY_AUTH_CONFIG = Object.freeze({
  workerUrl: 'https://diary-auth.ueda-photo-11.workers.dev',
  allowedLogin: 'Dopa-gaki'
});
