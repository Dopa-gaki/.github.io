/**
 * 日記専用 Cloudflare Worker（GitHub App OAuth Web Flow + PKCE）
 * GitHub AppのClient SecretとPrivate KeyはCloudflare Secretsだけに保存する。
 * ブラウザにはGitHubのトークンを渡さず、短期間の専用セッションのみ発行する。
 * 書き込みをdiary/の3つのパス群に限定。KV binding: DIARY_SESSIONS。
 */
const REPO_OWNER='Dopa-gaki',REPO_NAME='.github.io',REPO_BRANCH='main';
const DIR='diary/',EDITOR_URL='https://dopa-gaki.github.io/.github.io/diary/editor.html';
const PAGE_ORIGIN='https://dopa-gaki.github.io',ALLOWED_LOGIN='Dopa-gaki';
const API_VERSION='2022-11-28',MAX_REQUEST_BYTES=12*1024*1024,SESSION_TTL=4*60*60,DEVICE_COOKIE='diary_oauth';
const enc=new TextEncoder(),dec=new TextDecoder();
function b64u(bytes){
  let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function randomId(n=32){const bytes=new Uint8Array(n);crypto.getRandomValues(bytes);return b64u(bytes);}
async function sha256(s){return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))));}
function json(body,status=200,origin=null){
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  if(origin===PAGE_ORIGIN)Object.assign(headers,{'Access-Control-Allow-Origin':PAGE_ORIGIN,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'});
  return new Response(JSON.stringify(body),{status,headers});
}
function redirect(url,cookie=''){return new Response(null,{status:302,headers:{Location:url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...(cookie?{'Set-Cookie':cookie}:{})}});}
function error(status,message,origin){return json({error:message},status,origin);}
function urlPath(path){return path.split('/').map(encodeURIComponent).join('/');}
function authCookie(value,maxAge=600){return DEVICE_COOKIE+'='+value+'; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge;}
function getCookie(request,name){return(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';}
function secretReady(env){return Boolean(env.GITHUB_CLIENT_ID&&env.GITHUB_CLIENT_SECRET&&env.GITHUB_APP_ID&&env.GITHUB_APP_PRIVATE_KEY&&env.DIARY_SESSIONS);}
function cleanError(e){return e instanceof PublicError?e.message:'処理に失敗しました．再試行してください．';}
class PublicError extends Error{constructor(status,message){super(message);this.status=status;}}
async function github(url,token,options={}){
  const response=await fetch(url,{...options,headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,'X-GitHub-Api-Version':API_VERSION,...options.headers},cache:'no-store'});
  if(!response.ok)throw new PublicError(response.status===409?409:502,'GitHub APIでエラーが発生しました（'+response.status+'）');
  return response.json();
}
async function oauthStart(request,env){
  if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||!env.DIARY_SESSIONS)return error(503,'Cloudflare認証設定が未完了です');
  const state=randomId(24),nonce=randomId(24),verifier=randomId(48);
  const challenge=await sha256(verifier);
  await env.DIARY_SESSIONS.put('oauth:'+state,JSON.stringify({nonce,verifier}),{expirationTtl:600});
  const callback=new URL('/auth/callback',request.url).toString();
  const u=new URL('https://github.com/login/oauth/authorize');
  for(const [k,v] of Object.entries({client_id:env.GITHUB_CLIENT_ID,redirect_uri:callback,state,code_challenge:challenge,code_challenge_method:'S256'}))u.searchParams.set(k,v);
  return redirect(u.toString(),authCookie(nonce));
}
async function oauthCallback(request,env){
  const u=new URL(request.url),state=u.searchParams.get('state')||'',code=u.searchParams.get('code')||'';
  const failure=reason=>redirect(EDITOR_URL+'#auth_error='+encodeURIComponent(reason),authCookie('',0));
  if(u.searchParams.get('error'))return failure('GitHub認証がキャンセルされました');
  if(!/^[A-Za-z0-9_-]{30,80}$/.test(state)||!code)return failure('認証の確認に失敗しました');
  const record=await env.DIARY_SESSIONS.get('oauth:'+state);
  if(!record)return failure('認証が期限切れです．もう一度ログインしてください');
  await env.DIARY_SESSIONS.delete('oauth:'+state);
  const {nonce,verifier}=JSON.parse(record);
  if(!nonce||getCookie(request,DEVICE_COOKIE)!==nonce)return failure('認証が別のブラウザで開始されました');
  const callback=new URL('/auth/callback',request.url).toString();
  const tokenResponse=await fetch('https://github.com/login/oauth/access_token',{
    method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:callback,code_verifier:verifier})
  });
  if(!tokenResponse.ok)return failure('GitHub認証に接続できませんでした');
  const tokenInfo=await tokenResponse.json();
  if(!tokenInfo.access_token)return failure('GitHub認証が完了しませんでした');
  let user;
  try{user=await github('https://api.github.com/user',tokenInfo.access_token);}catch{return failure('GitHubアカウントを確認できませんでした');}
  if(String(user.login||'').toLowerCase()!==ALLOWED_LOGIN.toLowerCase())return failure('指定されたアカウント以外は使用できません');
  const session=randomId(48),sessionKey='session:'+await sha256(session);
  await env.DIARY_SESSIONS.put(sessionKey,JSON.stringify({login:ALLOWED_LOGIN,userId:user.id,createdAt:Date.now()}),{expirationTtl:SESSION_TTL});
  return redirect(EDITOR_URL+'#diary_session='+encodeURIComponent(session),authCookie('',0));
}
async function validateSession(request,env){
  const h=request.headers.get('Authorization')||'',m=/^Bearer ([A-Za-z0-9_-]{64,128})$/.exec(h);
  if(!m)throw new PublicError(401,'ログインが必要です');
  const key='session:'+await sha256(m[1]),record=await env.DIARY_SESSIONS.get(key);
  if(!record)throw new PublicError(401,'ログインの有効期限が切れました');
  const value=JSON.parse(record);
  if(value.login!==ALLOWED_LOGIN)throw new PublicError(403,'操作できないアカウントです');
  return {key,...value};
}
function derLen(n){if(n<128)return[n];let a=[];for(;n;n>>=8)a.unshift(n&255);return[0x80|a.length,...a];}
function tlv(tag,bytes){return new Uint8Array([tag,...derLen(bytes.length),...bytes]);}
function rsaKeyDer(pem){
  const raw=pem.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----|-----END (?:RSA )?PRIVATE KEY-----|\s/g,'');
  if(!raw)throw new Error('private key missing');
  const data=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
  if(pem.includes('BEGIN PRIVATE KEY'))return data;
  if(!pem.includes('BEGIN RSA PRIVATE KEY'))throw new Error('unsupported private key format');
  const alg=Uint8Array.from([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00]),octet=tlv(0x04,data);
  return tlv(0x30,new Uint8Array([0x02,0x01,0x00,...alg,...octet]));
}
