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
    $('#draft-indicator').textContent='';
    showStatus(dom.status,'');
    renderPhotos();
    renderLists();
    updateDeleteButton();
  }
  function changePending(){
    dirty=true;
    $('#draft-indicator').textContent='未保存';
    showStatus(dom.status,'');
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
      $('#draft-indicator').textContent='保存済み';
      if(report)showStatus(dom.status,'保存しました','success');
      else showStatus(dom.status,'');
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
    if(!drafts.length)dom.list.append(node('p','muted-small','記事はありません'));
    for(const draft of drafts){
      const btn=node('button','draft-item'+(draft.id===current.id?' active':''));btn.type='button';
      btn.append(node('strong','',draft.title||'無題の下書き'),node('span','',shortDate(draft.date)+' · 下書き'));
      btn.addEventListener('click',async()=>{try{await switchTo(draft);}catch{}});dom.list.append(btn);
    }
    dom.published.replaceChildren();
    if(!published.length)dom.published.append(node('p','muted-small','記事はありません'));
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
  function photoField(labelText,value,change,placeholder,multiline=false){
    const field=node('label','photo-input-field');field.append(node('span','',labelText));
    const input=node(multiline?'textarea':'input','editor-input');
    if(!multiline)input.type='text';else input.rows=2;
    input.value=value||'';input.placeholder=placeholder||'';
    input.addEventListener('input',()=>{change(input.value);changePending();});
    field.append(input);return field;
  }
  function renderPhotos(){
    for(const url of photoUrls)URL.revokeObjectURL(url);
    photoUrls.clear();dom.photos.replaceChildren();
    if(!(current.photos||[]).length)return;
    current.photos.forEach((photo,index)=>{
      const row=node('div','photo-row');
      const img=node('img');img.alt=photo.alt||'追加した写真';
      if(photo.blob instanceof Blob){img.src=URL.createObjectURL(photo.blob);photoUrls.add(img.src);}else img.src=Store.safeImageSrc(photo.src);
      const fields=node('div','photo-fields');
      fields.append(photoField('写真のタイトル',photo.title||'',value=>photo.title=value,'例：雪の中島公園'));
      fields.append(photoField('キャプション',photo.caption||'',value=>photo.caption=value,'撮影場所，写真にまつわる出来事など',true));
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
  const bytesToBase64=bytes=>{
    let raw='';const step=0x8000;
    for(let i=0;i<bytes.length;i+=step)raw+=String.fromCharCode(...bytes.subarray(i,i+step));
    return btoa(raw);
  };
  function updateDeleteButton(){
    const button=$('#delete-published');
    if(button)button.hidden=!published.some(item=>item.id===current.id);
  }
  async function githubPublish(){
    try{
      validateEntry();await saveNow();
      if(!window.JournalAuth?.isLoggedIn?.())throw new Error('GitHubでログインしてください');
      if(!window.confirm(`「${current.title}」を公開しますか？`))return;
      $('#publish-github').disabled=true;
      showStatus(dom.publishStatus,'写真と記事を送信しています…');
      const post=Store.publishable(current);
      const images=[];
      for(let i=0;i<current.photos.length;i++){
        const photo=current.photos[i];
        if(photo.blob instanceof Blob){
          images.push({path:post.photos[i].src,mime:photo.blob.type,base64:bytesToBase64(new Uint8Array(await photo.blob.arrayBuffer()))});
        }
      }
      const result=await window.JournalAuth.request('/api/publish',{entry:post,images});
      published=result.index;
      await Store.deleteDraft(current.id);
      drafts=await Store.getDrafts();
      current=createBlank();dirty=false;setForm(current);
      showStatus(dom.publishStatus,'公開しました．反映には少し時間がかかる場合があります．','success');
    }catch(error){showStatus(dom.publishStatus,'公開できません：'+error.message,'error');}
    finally{$('#publish-github').disabled=false;}
  }
  async function deletePublished(){
    const item=published.find(x=>x.id===current.id);
    if(!item){showStatus(dom.publishStatus,'公開済みの記事を選んでください','error');return;}
    if(!window.JournalAuth?.isLoggedIn?.()){
      showStatus(dom.publishStatus,'GitHubでログインしてください','error');return;
    }
    const confirmText=window.prompt(`${item.date}「${item.title}」を完全に非公開にします．\nこの記事と公開した写真を削除します．\n実行するには「削除」と入力してください．`);
    if(confirmText!=='削除')return;
    $('#delete-published').disabled=true;
    try{
      showStatus(dom.publishStatus,'GitHub上の記事を削除しています…');
      const result=await window.JournalAuth.request('/api/delete',{id:item.id,date:item.date});
      published=result.index;
      const draft=await Store.getDraft(item.id);
      if(draft)await Store.deleteDraft(item.id);
      drafts=await Store.getDrafts();
      current=createBlank();dirty=false;setForm(current);
      showStatus(dom.publishStatus,'公開済みの記事を削除しました．Git履歴には過去の版が残ります．','success');
    }catch(e){showStatus(dom.publishStatus,'削除できません：'+e.message,'error');}
    finally{$('#delete-published').disabled=false;updateDeleteButton();}
  }
  // The public site heading is separate from individual post titles.
  function displaySiteName(title){
    document.querySelector('.simple-logo').textContent=title;
    document.title='書く｜'+title;
  }
  async function loadSiteName(){
    try{
      const response=await fetch('data/site.json?v='+Date.now(),{cache:'no-store'});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const data=await response.json();
      if(typeof data.title!=='string'||!data.title.trim())throw new Error('サイト名の形式が不正です');
      $('#site-name-input').value=data.title;
      displaySiteName(data.title);
    }catch(error){
      $('#site-name-input').value='日記';
      showStatus($('#site-name-status'),'現在のサイト名を取得できません．再読み込みしてください：'+error.message,'error');
    }
  }
  async function saveSiteName(){
    const title=$('#site-name-input').value.trim().normalize('NFC');
    if(!title||title.length>80||/[\u0000-\u001f\u007f]/.test(title)){
      showStatus($('#site-name-status'),'1〜80文字の名前を入力してください．改行は使用できません．','error');return;
    }
    if(!window.JournalAuth?.isLoggedIn?.()){
      showStatus($('#site-name-status'),'先にGitHubでログインしてください．','error');return;
    }
    const button=$('#save-site-name');button.disabled=true;
    try{
      showStatus($('#site-name-status'),'サイト名を公開しています…');
      const data=await window.JournalAuth.request('/api/site',{title});
      if(data.title!==title)throw new Error('サイト名を保存できませんでした');
      displaySiteName(title);
      showStatus($('#site-name-status'),'保存しました．公開ページへの反映には少し時間がかかる場合があります．','success');
    }catch(error){
      showStatus($('#site-name-status'),'保存できません：'+error.message,'error');
    }finally{button.disabled=false;}
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
    current=createBlank();setForm(current);
    await loadSiteName();
    $('#save-site-name').addEventListener('click',saveSiteName);
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
    $('#delete-published').addEventListener('click',deletePublished);
  }
  init();
})();
