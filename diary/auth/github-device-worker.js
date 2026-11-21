// Cloudflare Worker: GitHub App Device Flow 中継（GitHub Pages の外部にデプロイする）
// Worker environment variables:
// GITHUB_CLIENT_ID = GitHub App の Client ID（秘密ではない）
// ALLOWED_ORIGIN = https://dopa-gaki.github.io
// GitHub App は Device Flow を有効化し，対象リポジトリだけにインストールする．
const headersFor = origin => ({
  'Access-Control-Allow-Origin':origin,
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
  'Vary':'Origin',
  'Cache-Control':'no-store',
  'Content-Type':'application/json; charset=utf-8'
});
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin')||'';
    if(origin!==env.ALLOWED_ORIGIN)return new Response('Forbidden',{status:403});
    const h=headersFor(origin);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:h});
    if(request.method!=='POST')return new Response('{"error":"method_not_allowed"}',{status:405,headers:h});
    if(!env.GITHUB_CLIENT_ID)return new Response('{"error":"not_configured"}',{status:503,headers:h});
    const path=new URL(request.url).pathname;
    if(path!=='/device/start'&&path!=='/device/poll')return new Response('{"error":"not_found"}',{status:404,headers:h});
    let body={};
    try{if(path==='/device/poll')body=await request.json();}catch{return new Response('{"error":"invalid_request"}',{status:400,headers:h});}
    if(path==='/device/poll' && !/^[A-Za-z0-9_-]{8,256}$/.test(String(body.device_code||'')))return new Response('{"error":"invalid_device_code"}',{status:400,headers:h});
    const form=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID});
    if(path==='/device/poll'){
      form.set('device_code',body.device_code);
      form.set('grant_type','urn:ietf:params:oauth:grant-type:device_code');
    }
    const github=await fetch(path==='/device/start'?'https://github.com/login/device/code':'https://github.com/login/oauth/access_token',{
      method:'POST',headers:{'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded'},body:form
    });
    // トークンはログに書かず，そのまま呼び出し元だけに返す．
    const result=await github.text();
    return new Response(result,{status:github.status,headers:h});
  }
};
