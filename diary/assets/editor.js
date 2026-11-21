(() => {
  'use strict';
  const $=selector=>document.querySelector(selector);
  const Store=window.JournalStore;
  const dom={
    list:$('#draft-list'),published:$('#published-list'),form:$('#entry-form'),status:$('#save-status'),
    photos:$('#photo-list'),photoStatus:$('#photo-status'),publishStatus:$('#publish-status')
  };
  const createBlank=()=>({id:Store.newId(),date:Store.localDate(),title:'',weather:'',mood:'',tags:[],body:[],photos:[],updatedAt:new Date().toISOString()});
  let current=createBlank(), drafts=[],published=[],dirty=false,saveTimer=null,writing=Promise.resolve();
  const photoUrls=new Set();
  const node=(tag,cls,value)=>{const item=document.createElement(tag);if(cls)item.className=cls;if(value!==undefined)item.textContent=value;return item;};
  function showStatus(el,text,state=''){el.textContent=text;el.dataset.state=state;}
  function normalizeTags(value){return [...new Set(value.split(/[,，、]/).map(x=>x.trim()).filter(Boolean))].slice(0,20);}
  function bodyParagraphs(text){return text.trim().split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);}
  function readForm(){
    current.date=$('#entry-date').value;
    current.title=$('#entry-title').value;
    current.weather=$('#entry-weather').value;
    current.mood=$('#entry-mood').value;
    current.tags=normalizeTags($('#entry-tags').value);
    current.body=bodyParagraphs($('#entry-body').value);
    return current;
  }
  function setForm(entry){
    $('#entry-date').value=entry.date||Store.localDate();
    $('#entry-title').value=entry.title||'';
    $('#entry-weather').value=entry.weather||'';
    $('#entry-mood').value=entry.mood||'';
    $('#entry-tags').value=(entry.tags||[]).join('，');
    $('#entry-body').value=(entry.body||[]).join('\n\n');
    $('#draft-indicator').textContent='編集中の下書き';
    showStatus(dom.status,'');
    renderPhotos();
    renderLists();
  }
  function changePending(){
    dirty=true;
    $('#draft-indicator').textContent='未保存の変更があります';
    showStatus(dom.status,'自動保存しています…');
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>saveNow(false),850);
  }
  async function saveNow(report=true){
    clearTimeout(saveTimer);saveTimer=null;
    if(!dirty && !report)return;
    readForm();
    current.updatedAt=new Date().toISOString();
    const record=structuredClone(current);
    dirty=false;
    writing=writing.then(()=>Store.putDraft(record));
    try{
      await writing;
      drafts=await Store.getDrafts();
      $('#draft-indicator').textContent='下書きを保存しました';
      if(report)showStatus(dom.status,'下書きをこのブラウザに保存しました．','success');
      else showStatus(dom.status,'自動保存しました．','success');
      renderLists();
    }catch(error){
      dirty=true;
      showStatus(dom.status,'保存できません：'+error.message,'error');
      throw error;
    }
  }
  async function leaveCurrent(){if(dirty)await saveNow(false);}
  async function switchTo(entry){
    await leaveCurrent();
    current=structuredClone(entry||createBlank());dirty=false;
    setForm(current);
    window.scrollTo({top:120,behavior:'smooth'});
  }
  function shortDate(date){return date || '日付なし';}
  function renderLists(){
    dom.list.replaceChildren();
    if(!drafts.length)dom.list.append(node('p','muted-small','まだ下書きはありません．'));
    for(const draft of drafts){
      const btn=node('button','draft-item'+(draft.id===current.id?' active':''));btn.type='button';
      btn.append(node('strong','',draft.title||'無題の下書き'),node('span','',shortDate(draft.date)+' · 下書き'));
      btn.addEventListener('click',async()=>{try{await switchTo(draft);}catch{}});dom.list.append(btn);
    }
    dom.published.replaceChildren();
    if(!published.length)dom.published.append(node('p','muted-small','まだ公開記事はありません．'));
    for(const item of [...published].sort((a,b)=>b.date.localeCompare(a.date))){
      const btn=node('button','draft-item');btn.type='button';
      btn.append(node('strong','',item.title||'無題'),node('span','',shortDate(item.date)+' · 公開済み'));
      btn.addEventListener('click',async()=>{
        try{
          await leaveCurrent();
          const existing=await Store.getDraft(item.id);
          const full=existing||await Store.loadEntry(item.date);
          const candidate=existing||{...structuredClone(full),photos:(full.photos||[]).map(photo=>({...photo,id:Store.newId()})),updatedAt:new Date().toISOString()};
          await switchTo(candidate);
        }catch(e){showStatus(dom.status,e.message,'error');}
      });dom.published.append(btn);
    }
  }
  function photoInput(placeholder,value,change){
    const input=node('input','editor-input');input.type='text';input.value=value||'';input.placeholder=placeholder;
    input.addEventListener('input',()=>{change(input.value);changePending();});return input;
  }
  function renderPhotos(){
    for(const url of photoUrls)URL.revokeObjectURL(url);
    photoUrls.clear();dom.photos.replaceChildren();
    if(!(current.photos||[]).length){dom.photos.append(node('p','muted-small','まだ写真はありません．必要なければ空欄のままで大丈夫です．'));return;}
    current.photos.forEach((photo,index)=>{
      const row=node('div','photo-row');
      const img=node('img');img.alt=photo.alt||'追加した写真';
      if(photo.blob instanceof Blob){img.src=URL.createObjectURL(photo.blob);photoUrls.add(img.src);}else img.src=Store.safeImageSrc(photo.src);
      const fields=node('div','photo-fields');
      fields.append(photoInput('写真の説明（代替テキスト）',photo.alt,value=>photo.alt=value));
      fields.append(photoInput('写真のキャプション',photo.caption,value=>photo.caption=value));
      const tools=node('div','photo-tools');
      const del=node('button','small-button','削除');del.type='button';
      del.addEventListener('click',()=>{current.photos.splice(index,1);renderPhotos();changePending();});
      const up=node('button','small-button','↑ 上へ');up.type='button';up.disabled=index===0;
      up.addEventListener('click',()=>{[current.photos[index-1],current.photos[index]]=[current.photos[index],current.photos[index-1]];renderPhotos();changePending();});
      const down=node('button','small-button','↓ 下へ');down.type='button';down.disabled=index===current.photos.length-1;
      down.addEventListener('click',()=>{[current.photos[index+1],current.photos[index]]=[current.photos[index],current.photos[index+1]];renderPhotos();changePending();});
      tools.append(up,down,del);fields.append(tools);row.append(img,fields);dom.photos.append(row);
    });
  }
  async function addPhotos(files){
    const arr=[...files].filter(file=>file.type.startsWith('image/'));
    if(!arr.length)return;
    showStatus(dom.photoStatus,arr.length+'枚の写真を処理しています…');
    let added=0;
    for(const file of arr){
      try{
        const photo=await Store.shrinkImage(file);
        current.photos.push(photo);added++;
      }catch(error){showStatus(dom.photoStatus,file.name+'：'+error.message,'error');}
    }
    renderPhotos();
    if(added){changePending();showStatus(dom.photoStatus,added+'枚の写真を追加しました（自動保存します）','success');}
  }
  function validateEntry(){
    readForm();
    if(!Store.validDate(current.date))throw new Error('正しい日付を入力してください．');
    if(!current.title.trim())throw new Error('タイトルを入力してください．');
    if(!current.body.length)throw new Error('本文を入力してください．');
  }
  function publishData(existing){
    const latest=[...existing];
    // 1日1ファイル．他の記事と同じ日付への上書きは防止する．
    if(latest.some(item=>item.date===current.date && item.id!==current.id)){
      throw new Error(current.date+' は既に別の日記が公開されています．左側の「公開済みの記事」からその記事を編集してください．');
    }
    const row=Store.manifestEntry(Store.publishable(current));
    const i=latest.findIndex(item=>item.id===current.id);
    if(i>=0)latest[i]=row;else latest.push(row);
    latest.sort((a,b)=>b.date.localeCompare(a.date));
    return latest;
  }
  function previousPath(existing){
    const previous=existing.find(item=>item.id===current.id);
    return previous&&previous.date!==current.date?Store.pathForDate(previous.date):null;
  }
  function filesForPublication(index){
    const post=Store.publishable(current);
    const files=[
      {path:'data/index.json',mime:'application/json',bytes:new TextEncoder().encode(JSON.stringify(index,null,2)+'\n')},
      {path:Store.pathForDate(post.date),mime:'application/json',bytes:new TextEncoder().encode(JSON.stringify(post,null,2)+'\n')}
    ];
    current.photos.forEach((photo,i)=>{
      if(photo.blob instanceof Blob)files.push({path:post.photos[i].src,blob:photo.blob,mime:photo.blob.type});
    });
    return files;
  }
  function persistedConfig(){
    const config={owner:$('#github-owner').value.trim(),repo:$('#github-repo').value.trim(),branch:$('#github-branch').value.trim()||'main',dir:$('#github-dir').value.trim().replace(/^\/+|\/+$/g,'')};
    if(!/^[a-z\d-]+$/i.test(config.owner)||!/^[a-z\d._-]+$/i.test(config.repo))throw new Error('GitHubアカウント名とリポジトリ名を確認してください．');
    if(!/^[\w./-]+$/.test(config.branch)||config.branch.includes('..'))throw new Error('ブランチ名が正しくありません．');
    if(config.dir && (!/^[\w/-]+$/.test(config.dir)||config.dir.split('/').some(p=>!p||p==='.'||p==='..')))throw new Error('設置フォルダの形式が正しくありません．');
    try{localStorage.setItem('diary-github-settings',JSON.stringify(config));}catch{}
    return config;
  }
  function loadConfig(){
    try{
      const v=JSON.parse(localStorage.getItem('diary-github-settings')||'{}');
      for(const [key,id] of Object.entries({owner:'#github-owner',repo:'#github-repo',branch:'#github-branch',dir:'#github-dir'}))if(v[key]!==undefined)$(id).value=v[key];
    }catch{}
  }
  const bytesToBase64=bytes=>{
    let raw='';const step=0x8000;
    for(let i=0;i<bytes.length;i+=step)raw+=String.fromCharCode(...bytes.subarray(i,i+step));
    return btoa(raw);
  };
  const base64ToText=string=>{
    const raw=atob(string.replace(/\s+/g,'')),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  };
  async function githubPublish(){
    try{
      validateEntry();await saveNow();
      const cfg=persistedConfig();const token=$('#github-token').value.trim();
      if(!token)throw new Error('GitHubのトークンを入力してください．トークンはブラウザに保存されません．');
      if(!window.confirm(`「${current.title}」を ${cfg.owner}/${cfg.repo} の ${cfg.branch} ブランチに公開しますか？\n設置先：${cfg.dir||'(リポジトリ直下)'}`))return;
      $('#publish-github').disabled=true;
      showStatus(dom.publishStatus,'GitHub上の現在の記事を確認しています…');
      const base=`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
      const req=async(method,path,body)=>{
        const res=await fetch(base+path,{method,headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
        if(!res.ok){let detail='';try{detail=(await res.json()).message||'';}catch{}throw new Error('GitHub API '+res.status+'：'+detail);}
        return res.json();
      };
      const prefix=cfg.dir?cfg.dir+'/':'';
      const postPath=prefix+'data/index.json';
      const contents=await req('GET','/contents/'+postPath.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(cfg.branch));
      if(!contents.content)throw new Error('GitHub上のdata/index.jsonが読み取れません．初回は新しいサイト一式を配置してください．');
      const latestPublished=JSON.parse(base64ToText(contents.content));
      if(!Array.isArray(latestPublished))throw new Error('GitHub上の記事一覧が配列ではありません．');
      const updated=publishData(latestPublished);
      const oldPath=previousPath(latestPublished);
      const files=filesForPublication(updated);
      const ref=await req('GET','/git/ref/heads/'+cfg.branch.split('/').map(encodeURIComponent).join('/'));
      const oldCommit=await req('GET','/git/commits/'+encodeURIComponent(ref.object.sha));
      const tree=[];
      for(const [i,file] of files.entries()){
        showStatus(dom.publishStatus,`公開ファイルを送信中… ${i+1}/${files.length}`);
        const bytes=file.bytes||(new Uint8Array(await file.blob.arrayBuffer()));
        const blob=await req('POST','/git/blobs',{content:bytesToBase64(bytes),encoding:'base64'});
        tree.push({path:prefix+file.path,mode:'100644',type:'blob',sha:blob.sha});
      }
      if(oldPath)tree.push({path:prefix+oldPath,mode:'100644',type:'blob',sha:null});
      const newTree=await req('POST','/git/trees',{base_tree:oldCommit.tree.sha,tree});
      const commit=await req('POST','/git/commits',{message:'日記を公開: '+current.date+' '+current.title,tree:newTree.sha,parents:[ref.object.sha]});
      await req('PATCH','/git/refs/heads/'+cfg.branch.split('/').map(encodeURIComponent).join('/'),{sha:commit.sha,force:false});
      published=updated;
      await Store.deleteDraft(current.id);
      drafts=await Store.getDrafts();
      current=createBlank();dirty=false;setForm(current);
      renderLists();
      showStatus(dom.publishStatus,'GitHubへの公開が完了しました．Pagesへの反映には少し時間がかかる場合があります．','success');
    }catch(error){showStatus(dom.publishStatus,'公開に失敗しました：'+error.message,'error');}
    finally{$('#publish-github').disabled=false;$('#github-token').value='';}
  }
  // Simple, dependency-free ZIP writer (uncompressed, UTF-8 file paths).
  const crcTable=(()=>{const result=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);result.push(c>>>0);}return result;})();
  function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
  function concat(arrays){const output=new Uint8Array(arrays.reduce((sum,array)=>sum+array.length,0));let offset=0;for(const item of arrays){output.set(item,offset);offset+=item.length;}return output;}
  async function zipBundle(files){
    const local=[],central=[];let offset=0;
    for(const file of files){
      const name=new TextEncoder().encode(file.path),bytes=file.bytes||new Uint8Array(await file.blob.arrayBuffer());
      const crc=crc32(bytes),size=bytes.length;
      const loc=new Uint8Array(30+name.length),l=new DataView(loc.buffer);
      l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x0800,true);l.setUint16(8,0,true);
      l.setUint32(14,crc,true);l.setUint32(18,size,true);l.setUint32(22,size,true);l.setUint16(26,name.length,true);
      loc.set(name,30);local.push(loc,bytes);
      const cen=new Uint8Array(46+name.length),c=new DataView(cen.buffer);
      c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);
      c.setUint16(8,0x0800,true);c.setUint16(10,0,true);
      c.setUint32(16,crc,true);c.setUint32(20,size,true);c.setUint32(24,size,true);c.setUint16(28,name.length,true);
      c.setUint32(42,offset,true);cen.set(name,46);central.push(cen);
      offset+=loc.length+bytes.length;
    }
    const dir=concat(central),end=new Uint8Array(22),e=new DataView(end.buffer);
    e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);
    e.setUint32(12,dir.length,true);e.setUint32(16,offset,true);
    return new Blob([...local,dir,end],{type:'application/zip'});
  }
  async function exportZip(){
    try{
      validateEntry();await saveNow();
      showStatus(dom.publishStatus,'ZIPを書き出しています…');
      const files=filesForPublication(publishData(published));
      const oldPath=previousPath(published);
      if(oldPath)files.push({path:'DELETE_OLD_FILE.txt',bytes:new TextEncoder().encode('日付を変更したため，GitHub上の '+oldPath+' を手動で削除してください．\n')});
      const blob=await zipBundle(files),url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download='diary-publish-'+current.date+'.zip';document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      showStatus(dom.publishStatus,'ZIPを出力しました．展開したdata/index.json・posts/日付.json・images/をGitHubへ配置してください．','success');
    }catch(error){showStatus(dom.publishStatus,'出力できません：'+error.message,'error');}
  }
  async function init(){
    try{drafts=await Store.getDrafts();}
    catch(error){showStatus(dom.status,'このブラウザでは下書きを保存できません：'+error.message,'error');}
    try{published=await Store.loadPublished();}
    catch(error){showStatus(dom.publishStatus,'公開済み記事の取得に失敗しました：'+error.message,'error');}
    loadConfig();
    current=createBlank();setForm(current);
    dom.form.addEventListener('submit',async event=>{event.preventDefault();try{dirty=true;await saveNow();}catch{}});
    for(const id of ['#entry-date','#entry-title','#entry-weather','#entry-mood','#entry-tags','#entry-body'])$(id).addEventListener('input',changePending);
    $('#new-entry').addEventListener('click',async()=>{try{await switchTo(null);}catch{}});
    $('#open-preview').addEventListener('click',async()=>{
      // Open a tab synchronously, before waiting for IndexedDB; otherwise some browsers block the popup.
      const tab=window.open('about:blank','_blank');
      if(tab)try{tab.opener=null;tab.document.title='プレビューを準備しています';}catch{}
      try{
        if(dirty)await saveNow(false);
        else if(current.title||current.body.length)await saveNow(true);
        const url='preview.html?id='+encodeURIComponent(current.id);
        if(tab)tab.location.replace(url);else window.location.href=url;
      }catch{if(tab)tab.close();}
    });
    $('#delete-entry').addEventListener('click',async()=>{
      if(!drafts.some(x=>x.id===current.id)){current=createBlank();dirty=false;setForm(current);return;}
      if(!confirm('この下書きを削除しますか？公開済みの記事には影響しません．'))return;
      clearTimeout(saveTimer);dirty=false;await Store.deleteDraft(current.id);
      drafts=await Store.getDrafts();current=createBlank();setForm(current);showStatus(dom.status,'下書きを削除しました．','success');
    });
    $('#select-photos').addEventListener('click',()=>$('#photo-picker').click());
    $('#photo-picker').addEventListener('change',async e=>{await addPhotos(e.target.files);e.target.value='';});
    const drop=$('#photo-drop');
    drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});
    drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
    drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragover');addPhotos(e.dataTransfer.files);});
    $('#publish-github').addEventListener('click',githubPublish);
    $('#export-zip').addEventListener('click',exportZip);
    for(const id of ['#github-owner','#github-repo','#github-branch','#github-dir'])$(id).addEventListener('change',()=>{try{persistedConfig();}catch{}});
  }
  init();
})();
