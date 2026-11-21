(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const conf = window.DIARY_AUTH_CONFIG || {};
  const sessionKey = 'diary-github-session-v1';
  let activeToken = '';
  let authenticating = false;
  let stopping = false;
  function status(message){ const node=$('#login-status'); if(node)node.textContent=message; }
  function help(message){ const node=$('#login-help'); if(node)node.textContent=message; }
  function updateUI(){
    const logged=Boolean(activeToken);
    if($('#github-login'))$('#github-login').hidden=logged;
    if($('#github-logout'))$('#github-logout').hidden=!logged;
    if(logged)status('接続済み');
    else status('未接続');
  }
  const token = () => activeToken;
  function logout(){
    stopping=true;activeToken='';
    try{sessionStorage.removeItem(sessionKey);}catch{}
    updateUI();help('');
  }
  async function apiUser(value){
    const response=await fetch('https://api.github.com/user',{
      headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+value,'X-GitHub-Api-Version':'2022-11-28'},
      cache:'no-store'
    });
    if(!response.ok)throw new Error('GitHubへの接続を確認できません');
    return response.json();
  }
  async function login(){
    if(authenticating)return;
    const base=String(conf.workerUrl||'').trim().replace(/\/+$/,'');
    if(!/^https:\/\/[a-z0-9.-]+(?:\/[^?#]*)?$/i.test(base)){
      help('ログインの設定が未完了です。接続設定はREADMEを参照してください。');
      return;
    }
    authenticating=true;stopping=false;
    const button=$('#github-login');if(button)button.disabled=true;
    // User gestureで開く。サーバー応答後のpopupブロックを避ける。
    const loginTab=window.open('https://github.com/login/device','_blank','noopener');
    try{
      status('接続中');help('認証を準備しています…');
      const start=await fetch(base+'/device/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      if(!start.ok)throw new Error('認証サービスに接続できません');
      const authorization=await start.json();
      const code=String(authorization.user_code||'');
      const deviceCode=String(authorization.device_code||'');
      if(!code||!deviceCode)throw new Error('GitHubの認証コードを取得できません');
      help('GitHubの画面で「'+code+'」を入力してください。');
      if(!loginTab){const a=document.createElement('a');a.href='https://github.com/login/device';a.target='_blank';a.rel='noopener noreferrer';a.textContent=' 認証画面を開く';$('#login-help').append(a);}
      let interval=Math.max(5,Number(authorization.interval)||5);
      const expires=Date.now()+Math.max(60,Number(authorization.expires_in)||900)*1000;
      while(Date.now()<expires&&!stopping){
        await new Promise(resolve=>setTimeout(resolve,interval*1000));
        if(stopping)return;
        const response=await fetch(base+'/device/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_code:deviceCode})});
        if(!response.ok)throw new Error('認証を確認できません');
        const result=await response.json();
        if(result.error==='authorization_pending')continue;
        if(result.error==='slow_down'){interval+=Math.max(5,Number(result.interval)||5);continue;}
        if(result.error)throw new Error(result.error==='expired_token'?'認証の有効時間が切れました':'GitHubでの認証が完了しませんでした');
        const candidate=String(result.access_token||'');
        if(!candidate)throw new Error('ログイントークンを取得できません');
        const user=await apiUser(candidate);
        if(String(user.login||'').toLowerCase()!==String(conf.allowedLogin||'').toLowerCase())throw new Error('指定されたGitHubアカウントでログインしてください');
        activeToken=candidate;
        try{sessionStorage.setItem(sessionKey,candidate);}catch{}
        updateUI();help('');return;
      }
      if(!stopping)throw new Error('認証の有効時間が切れました');
    }catch(error){status('未接続');help(error.message);}
    finally{authenticating=false;if(button)button.disabled=false;}
  }
  async function init(){
    try{
      const previous=sessionStorage.getItem(sessionKey);
      if(previous){
        const user=await apiUser(previous);
        if(String(user.login||'').toLowerCase()===String(conf.allowedLogin||'').toLowerCase())activeToken=previous;
        else sessionStorage.removeItem(sessionKey);
      }
    }catch{try{sessionStorage.removeItem(sessionKey);}catch{}}
    updateUI();
    $('#github-login')?.addEventListener('click',login);
    $('#github-logout')?.addEventListener('click',logout);
  }
  window.JournalAuth={token,login,logout};
  init();
})();
