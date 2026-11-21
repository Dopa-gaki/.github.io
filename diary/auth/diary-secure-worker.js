/**
 * 日記専用 Cloudflare Worker（GitHub App OAuth Web Flow + PKCE）
 * GitHub AppのClient SecretとPrivate KeyはCloudflare Secretsだけに保存する。
 * ブラウザにはGitHubのトークンを渡さず、短期間の専用セッションのみ発行する。
 * 書き込みをdiary/の3つのパス群に限定。KV binding: DIARY_SESSIONS。
 */
const REPO_OWNER='Dopa-gaki',REPO_NAME='.github.io',REPO_BRANCH='main';
const DIR='diary/',EDITOR_URL='https://diary-auth.ueda-photo-11.workers.dev/editor.html';
const PAGE_ORIGIN='https://diary-auth.ueda-photo-11.workers.dev',ALLOWED_LOGIN='Dopa-gaki';
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
  const response=await fetch(url,{...options,headers:{'Accept':'application/vnd.github+json','User-Agent':'Dopa-gaki-Diary-Worker','Authorization':'Bearer '+token,'X-GitHub-Api-Version':API_VERSION,...options.headers},cache:'no-store'});
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
    method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded','User-Agent':'Dopa-gaki-Diary-Worker'},
    body:new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:callback,code_verifier:verifier})
  });
  if(!tokenResponse.ok)return failure('GitHub認証に接続できませんでした');
  const tokenInfo=await tokenResponse.json();
  if(!tokenInfo.access_token)return failure('GitHub認証が完了しませんでした');
  let user;
  try{user=await github('https://api.github.com/user',tokenInfo.access_token);}catch(e){return failure('GitHubアカウントを確認できませんでした：'+(e instanceof PublicError?e.message:'GitHubへの通信に失敗しました'));}
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
async function appJwt(env){
  const key=await crypto.subtle.importKey('pkcs8',rsaKeyDer(env.GITHUB_APP_PRIVATE_KEY),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const now=Math.floor(Date.now()/1000);
  const b64Json=o=>b64u(enc.encode(JSON.stringify(o)));
  const payload=b64Json({iat:now-60,exp:now+540,iss:String(env.GITHUB_APP_ID)});
  const unsigned=b64Json({alg:'RS256',typ:'JWT'})+'.'+payload;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(unsigned));
  return unsigned+'.'+b64u(new Uint8Array(signature));
}
async function installationToken(env){
  const jwt=await appJwt(env);
  const installation=await github('https://api.github.com/repos/'+REPO_OWNER+'/'+REPO_NAME+'/installation',jwt);
  if(!Number.isSafeInteger(installation.id))throw new PublicError(503,'GitHub Appが対象リポジトリにインストールされていません');
  const result=await github('https://api.github.com/app/installations/'+installation.id+'/access_tokens',jwt,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repositories:[REPO_NAME],permissions:{contents:'write'}})
  });
  if(!result.token)throw new PublicError(503,'書き込み用トークンを作成できません');
  return result.token;
}
function ghReq(token,path,method='GET',body){
  return github('https://api.github.com/repos/'+REPO_OWNER+'/'+REPO_NAME+path,token,{
    method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined
  });
}
function decodeGitHubBase64(str){return dec.decode(Uint8Array.from(atob(str.replace(/\s/g,'')),x=>x.charCodeAt(0)));}
function validDate(date){if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;const d=new Date(date+'T12:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===date;}
function validId(id){return typeof id==='string'&&/^[A-Za-z0-9_-]{8,110}$/.test(id);}
function imagePrefix(id){return 'images/'+id.replace(/[^A-Za-z0-9_-]/g,'')+'/';}
function ownImage(path,id){return typeof path==='string'&&path.startsWith(imagePrefix(id))&&/^images\/[\w-]+\/[\w-]+\.(?:webp|png|jpe?g)$/.test(path);}
function validateEntry(entry){
  if(!entry||!validId(entry.id)||!validDate(entry.date)||typeof entry.title!=='string'||entry.title.length>140||!entry.title.trim())throw new PublicError(400,'日付・タイトル・記事IDを確認してください');
  if(!Array.isArray(entry.body)||entry.body.length<1||entry.body.length>150||entry.body.some(x=>typeof x!=='string'||x.length>12000))throw new PublicError(400,'本文が不正です');
  if(!Array.isArray(entry.tags)||entry.tags.length>20||entry.tags.some(x=>typeof x!=='string'||x.length>80))throw new PublicError(400,'タグの形式が不正です');
  if(!Array.isArray(entry.photos)||entry.photos.length>30)throw new PublicError(400,'写真が多すぎます');
  const seen=new Set();
  for(const p of entry.photos){
    if(!p||!ownImage(p.src,entry.id)||seen.has(p.src)||['title','alt','caption'].some(k=>typeof p[k]!=='string'||p[k].length>800))throw new PublicError(400,'写真のデータが不正です');
    seen.add(p.src);
  }
  if(['weather','mood'].some(k=>typeof entry[k]!=='string'||entry[k].length>150))throw new PublicError(400,'記事の設定が不正です');
  return {id:entry.id,date:entry.date,title:entry.title.trim(),weather:entry.weather,mood:entry.mood,tags:entry.tags,body:entry.body,photos:entry.photos};
}
const base64bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
function validImageBytes(bytes,mime){
  if(mime==='image/webp')return bytes.length>12&&dec.decode(bytes.slice(0,4))==='RIFF'&&dec.decode(bytes.slice(8,12))==='WEBP';
  if(mime==='image/png')return bytes.length>8&&[137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x);
  if(mime==='image/jpeg')return bytes.length>4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  return false;
}
async function loadManifest(token){
  const result=await ghReq(token,'/contents/'+urlPath(DIR+'data/index.json')+'?ref='+REPO_BRANCH);
  if(!result.content)throw new PublicError(502,'公開記事の一覧を読み込めません');
  const rows=JSON.parse(decodeGitHubBase64(result.content));
  if(!Array.isArray(rows))throw new PublicError(502,'記事一覧が不正です');
  return rows;
}
async function loadPost(token,date){
  const result=await ghReq(token,'/contents/'+urlPath(DIR+'posts/'+date+'.json')+'?ref='+REPO_BRANCH);
  return JSON.parse(decodeGitHubBase64(result.content));
}
function cleanIndexRow(post){return {id:post.id,date:post.date,title:post.title,weather:post.weather,mood:post.mood,tags:post.tags};}
function base64(bytes){return b64u(bytes).replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-bytes.length%3)%3);}
async function commitChanges(token,files,deletes,message){
  const ref=await ghReq(token,'/git/ref/heads/'+REPO_BRANCH);
  const base=await ghReq(token,'/git/commits/'+ref.object.sha);
  const tree=[];
  for(const file of files){
    if(!file.path.startsWith(DIR))throw new Error('BUG: file out of scope');
    const blob=await ghReq(token,'/git/blobs','POST',{content:base64(file.bytes),encoding:'base64'});
    tree.push({path:file.path,type:'blob',mode:'100644',sha:blob.sha});
  }
  for(const path of new Set(deletes)){
    if(!path.startsWith(DIR+'posts/')&&!path.startsWith(DIR+'images/'))throw new Error('BUG: deletion out of scope');
    tree.push({path,type:'blob',mode:'100644',sha:null});
  }
  const newTree=await ghReq(token,'/git/trees','POST',{base_tree:base.tree.sha,tree});
  const commit=await ghReq(token,'/git/commits','POST',{message,tree:newTree.sha,parents:[ref.object.sha]});
  await ghReq(token,'/git/refs/heads/'+REPO_BRANCH,'PATCH',{sha:commit.sha,force:false});
  return commit.sha;
}
async function publish(request,env){
  const requestLength=Number(request.headers.get('Content-Length')||0);
  if(requestLength>MAX_REQUEST_BYTES)throw new PublicError(413,'送信する写真が大きすぎます');
  const {entry,images=[]}=await request.json();
  const post=validateEntry(entry);
  if(!Array.isArray(images)||images.length>post.photos.length)throw new PublicError(400,'写真の形式が不正です');
  const uploadPaths=new Set(),fileData=[];
  for(const x of images){
    if(!x||!ownImage(x.path,post.id)||!post.photos.some(p=>p.src===x.path)||uploadPaths.has(x.path)||!['image/webp','image/jpeg','image/png'].includes(x.mime)||typeof x.base64!=='string'||x.base64.length>5.6e6)throw new PublicError(400,'写真の送信形式が不正です');
    let bytes;try{bytes=base64bytes(x.base64);}catch{throw new PublicError(400,'写真の内容を読み込めません');}
    if(bytes.length>4*1024*1024||!validImageBytes(bytes,x.mime))throw new PublicError(400,'画像の形式またはサイズが不正です');
    fileData.push({path:DIR+x.path,bytes});uploadPaths.add(x.path);
  }
  const token=await installationToken(env);
  const manifest=await loadManifest(token);
  const old=manifest.find(x=>x.id===post.id);
  if(manifest.some(x=>x.date===post.date&&x.id!==post.id))throw new PublicError(409,'同じ日付に別の日記があります');
  const previous=old?await loadPost(token,old.date):null;
  if(!previous&&old)throw new PublicError(409,'過去の記事を取得できません');
  const oldImagePaths=new Set((previous?.photos||[]).map(x=>x.src).filter(x=>ownImage(x,post.id)));
  for(const p of post.photos){if(!oldImagePaths.has(p.src)&&!uploadPaths.has(p.src))throw new PublicError(400,'未アップロードの写真が指定されています');}
  const files=[...fileData,{path:DIR+'posts/'+post.date+'.json',bytes:enc.encode(JSON.stringify(post,null,2)+'\n')}];
  const next=manifest.filter(x=>x.id!==post.id);next.push(cleanIndexRow(post));next.sort((a,b)=>b.date.localeCompare(a.date));
  files.push({path:DIR+'data/index.json',bytes:enc.encode(JSON.stringify(next,null,2)+'\n')});
  const deletes=[];
  if(old&&old.date!==post.date)deletes.push(DIR+'posts/'+old.date+'.json');
  for(const p of oldImagePaths)if(!post.photos.some(x=>x.src===p))deletes.push(DIR+p);
  const sha=await commitChanges(token,files,deletes,'日記を公開: '+post.date+' '+post.title);
  return {ok:true,commit:sha,index:next};
}
async function deletePost(request,env){
  const data=await request.json();
  if(!validId(data?.id)||!validDate(data?.date))throw new PublicError(400,'削除する日記が指定されていません');
  const token=await installationToken(env);
  const manifest=await loadManifest(token);
  const found=manifest.find(x=>x.id===data.id&&x.date===data.date);
  if(!found)throw new PublicError(409,'公開済み記事が見つかりません．再読み込みしてください');
  const old=await loadPost(token,data.date);
  if(old.id!==data.id)throw new PublicError(409,'記事IDが一致しません');
  const next=manifest.filter(x=>x.id!==data.id);
  const files=[{path:DIR+'data/index.json',bytes:enc.encode(JSON.stringify(next,null,2)+'\n')}];
  const deletes=[DIR+'posts/'+data.date+'.json'];
  for(const p of (old.photos||[]))if(ownImage(p.src,data.id))deletes.push(DIR+p.src);
  const sha=await commitChanges(token,files,deletes,'日記を削除: '+data.date);
  return {ok:true,commit:sha,index:next};
}

/* Separate the diary editor browser origin from the public GitHub Pages site.
   No arbitrary URL proxy; only known public diary files are served here. */
const DIARY_PUBLIC='https://dopa-gaki.github.io/.github.io/diary/';
const EDITOR_ASSETS=new Set(['style.css','minimal.css','storage.js','site.js','auth-config.js','auth.js','editor.js','import-drafts.js']);
function editorResource(pathname){
  if(pathname==='/editor.html'||pathname==='/preview.html'||pathname==='/import.html')return pathname.slice(1);
  if(pathname==='/data/index.json')return pathname.slice(1);
  if(/^\/posts\/\d{4}-\d{2}-\d{2}\.json$/.test(pathname))return pathname.slice(1);
  const asset=/^\/assets\/([A-Za-z0-9_-]+\.(?:js|css))$/.exec(pathname);
  if(asset&&EDITOR_ASSETS.has(asset[1]))return pathname.slice(1);
  if(/^\/images\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:webp|png|jpe?g)$/.test(pathname))return pathname.slice(1);
  return null;
}
async function serveEditorResource(request){
  const pathname=new URL(request.url).pathname;
  if(!['GET','HEAD'].includes(request.method))return error(405,'この操作はできません');
  const relative=editorResource(pathname);
  if(!relative)return error(404,'ページが見つかりません');
  const upstream=await fetch(new URL(relative,DIARY_PUBLIC).toString(),{method:'GET',redirect:'follow',headers:{Accept:'*/*'},cache:'no-store'});
  if(!upstream.ok)return error(502,'日記ファイルを取得できませんでした');
  let mime='application/octet-stream';
  if(relative.endsWith('.html'))mime='text/html; charset=utf-8';
  else if(relative.endsWith('.js'))mime='text/javascript; charset=utf-8';
  else if(relative.endsWith('.css'))mime='text/css; charset=utf-8';
  else if(relative.endsWith('.json'))mime='application/json; charset=utf-8';
  else if(relative.endsWith('.png'))mime='image/png';
  else if(relative.endsWith('.jpg')||relative.endsWith('.jpeg'))mime='image/jpeg';
  else if(relative.endsWith('.webp'))mime='image/webp';
  const headers={
    'Content-Type':mime,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Cross-Origin-Resource-Policy':'same-origin'
  };
  if(relative.endsWith('.html'))headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
  return new Response(request.method==='HEAD'?null:upstream.body,{status:200,headers});
}

export default {
  async fetch(request,env){
    const url=new URL(request.url),origin=request.headers.get('Origin');
    if((url.pathname==='/'||url.pathname==='/index.html')&&request.method==='GET')return redirect(DIARY_PUBLIC);
    if(editorResource(url.pathname))return serveEditorResource(request);
    if(url.pathname==='/auth/start'&&request.method==='GET')return oauthStart(request,env);
    if(url.pathname==='/auth/callback'&&request.method==='GET'){
      if(!env.DIARY_SESSIONS)return error(503,'Cloudflare KVが未設定です');
      return oauthCallback(request,env).catch(()=>redirect(EDITOR_URL+'#auth_error='+encodeURIComponent('認証を完了できませんでした')));
    }
    if(origin!==PAGE_ORIGIN)return error(403,'許可されていないアクセスです');
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':PAGE_ORIGIN,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'}});
    if(request.method!=='POST')return error(405,'利用できない操作です',origin);
    if(!secretReady(env))return error(503,'Cloudflareの認証設定が未完了です',origin);
    if(!['/api/session','/api/logout','/api/publish','/api/delete'].includes(url.pathname))return error(404,'存在しない操作です',origin);
    try{
      const session=await validateSession(request,env);
      if(url.pathname==='/api/session')return json({ok:true,login:session.login},200,origin);
      if(url.pathname==='/api/logout'){await env.DIARY_SESSIONS.delete(session.key);return json({ok:true},200,origin);}
      const result=url.pathname==='/api/publish'?await publish(request,env):await deletePost(request,env);
      return json(result,200,origin);
    }catch(e){return error(e instanceof PublicError?e.status:500,cleanError(e),origin);}
  }
};
