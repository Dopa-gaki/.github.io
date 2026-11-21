(() => {
  'use strict';
  const $=id=>document.querySelector(id);
  const config=window.DIARY_AUTH_CONFIG||{};
  const base=String(config.workerUrl||'').replace(/\/+$/,'');
  let session='';
  const setStatus=s=>{const target=$('#login-status');if(target)target.textContent=s;};
  const setHelp=s=>{const target=$('#login-help');if(target)target.textContent=s;};
  function draw(){
    if($('#github-login'))$('#github-login').hidden=Boolean(session);
    if($('#github-logout'))$('#github-logout').hidden=!session;
    setStatus(session?'接続済み':'未接続');
  }
  async function request(path,data={}){
    if(!session)throw new Error('GitHubでログインしてください');
    if(!/^https:\/\/[a-z0-9.-]+$/i.test(base))throw new Error('Cloudflareの接続設定が必要です');
    let response;
    try{
      response=await fetch(base+path,{
        method:'POST',mode:'cors',cache:'no-store',
        headers:{'Authorization':'Bearer '+session,'Content-Type':'application/json'},
        body:JSON.stringify(data)
      });
    }catch{throw new Error('Cloudflareに接続できません．Workerの設定を確認してください');}
    const body=await response.json().catch(()=>({}));
    if(!response.ok){
      if(response.status===401){session='';draw();}
      throw new Error(body.error||'処理に失敗しました（HTTP '+response.status+'）');
    }
    return body;
  }
  function login(){
    if(!/^https:\/\/[a-z0-9.-]+$/i.test(base)){
      setHelp('Cloudflare WorkerのURLが設定されていません');return;
    }
    // GitHub credentials stay on Cloudflare, only the diary session reaches this page.
    location.assign(base+'/auth/start');
  }
  async function logout(){
    try{if(session)await request('/api/logout');}catch{}
    session='';
    setHelp('');draw();
  }
  async function init(){
    // Remove any GitHub user token left by the old device-flow implementation.
    try{sessionStorage.removeItem('diary-github-session-v1');}catch{}
    const hash=new URLSearchParams(location.hash.slice(1));
    const returned=hash.get('diary_session');
    const err=hash.get('auth_error');
    if(returned||err)history.replaceState(null,'',location.pathname+location.search);
    if(err)setHelp(err);
    if(returned&&/^[A-Za-z0-9_-]{64,128}$/.test(returned))session=returned;
    draw();
    if(session){
      try{
        const r=await request('/api/session');
        if(r.login!==String(config.allowedLogin||''))throw new Error('アカウントが一致しません');
        setHelp('');
      }catch(e){session='';draw();setHelp(e.message);}
    }
    $('#github-login')?.addEventListener('click',login);
    $('#github-logout')?.addEventListener('click',logout);
  }
  window.JournalAuth={request,login,logout,isLoggedIn:()=>Boolean(session)};
  init();
})();