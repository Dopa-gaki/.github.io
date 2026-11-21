(() => {
  'use strict';
  const DB_NAME='hibi-diary-drafts-v1';
  const STORE='drafts';
  let dbPromise;
  function openDB(){
    if(!('indexedDB' in window))return Promise.reject(new Error('このブラウザでは下書き保存が利用できません．'));
    if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('下書きの保存領域を開けません．'));
    });
    return dbPromise;
  }
  async function transact(mode,operation){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const t=db.transaction(STORE,mode);let value;const req=operation(t.objectStore(STORE));
      if(req)req.onsuccess=()=>{value=req.result;};
      t.oncomplete=()=>resolve(value);
      t.onabort=t.onerror=()=>reject(t.error||new Error('下書きを保存できませんでした．'));
    });
  }
  const getDrafts=async()=>(await transact('readonly',s=>s.getAll())).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
  const getDraft=id=>transact('readonly',s=>s.get(id));
  const putDraft=entry=>transact('readwrite',s=>s.put(entry));
  const deleteDraft=id=>transact('readwrite',s=>s.delete(id));
  const newId=()=>(window.crypto?.randomUUID?.()||('diary-'+Date.now()+'-'+Math.random().toString(36).slice(2)));
  const localDate=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  const validDate=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(new Date(date+'T12:00:00').getTime())&&new Date(date+'T12:00:00').getDate()===Number(date.slice(8));
  const pathForDate=date=>{if(!validDate(date))throw new Error('日付が正しくありません．');return 'posts/'+date+'.json';};
  async function fetchJSON(path){
    const res=await fetch(path+'?v='+Date.now(),{cache:'no-store'});
    if(!res.ok)throw new Error(path+' が取得できません（HTTP '+res.status+'）');
    return res.json();
  }
  async function loadPublished(){
    const rows=await fetchJSON('data/index.json');
    if(!Array.isArray(rows))throw new Error('data/index.jsonは配列である必要があります．');
    if(rows.some(row=>!row||!validDate(row.date)||typeof row.id!=='string'||typeof row.title!=='string'||!Array.isArray(row.tags)))throw new Error('data/index.jsonに不正な記事情報があります．');
    if(new Set(rows.map(row=>row.date)).size!==rows.length)throw new Error('記事一覧に同じ日付が重複しています．');
    return rows.sort((a,b)=>b.date.localeCompare(a.date));
  }
  async function loadEntry(date){
    const entry=await fetchJSON(pathForDate(date));
    if(!entry||entry.date!==date||typeof entry.title!=='string'||!Array.isArray(entry.body)||!Array.isArray(entry.photos))throw new Error(date+' の日記ファイルの形式が正しくありません．');
    return entry;
  }
  function safeImageSrc(src){
    if(typeof src!=='string')return '';
    const path=src.trim();
    if(/^images\/[a-zA-Z0-9_./-]+$/.test(path)&&!path.split('/').includes('..'))return path;
    if(/^https:\/\//i.test(path))return path;
    return '';
  }
  async function shrinkImage(file){
    if(!file?.type?.startsWith('image/'))throw new Error('画像ファイルを選んでください．');
    if(file.size>30*1024*1024)throw new Error('30MBを超える画像は追加できません．');
    let bitmap;
    try{bitmap=await createImageBitmap(file);}catch{
      bitmap=await new Promise((resolve,reject)=>{
        const u=URL.createObjectURL(file),img=new Image();
        img.onload=()=>{URL.revokeObjectURL(u);resolve(img);};
        img.onerror=()=>{URL.revokeObjectURL(u);reject(new Error('画像を読み込めません．'));};
        img.src=u;
      });
    }
    const width=bitmap.width||bitmap.naturalWidth,height=bitmap.height||bitmap.naturalHeight;
    if(!width||!height)throw new Error('画像のサイズが取得できません．');
    const ratio=Math.min(1,1800/Math.max(width,height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('画像を変換できません．');
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);if(bitmap.close)bitmap.close();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.84));
    if(!blob)throw new Error('画像を書き出せません．');
    return {id:newId(),blob,title:'',alt:'',caption:'',originalName:file.name,filenameExt:blob.type==='image/webp'?'webp':'png'};
  }
  function publishable(entry){
    return {
      id:entry.id,date:entry.date,title:entry.title.trim(),weather:(entry.weather||'').trim(),mood:(entry.mood||'').trim(),
      tags:Array.isArray(entry.tags)?entry.tags:[],body:Array.isArray(entry.body)?entry.body:[],
      photos:(entry.photos||[]).map(photo=>({
        src:safeImageSrc(photo.src)||`images/${entry.id.replace(/[^a-zA-Z0-9_-]/g,'')}/${(photo.id||newId()).replace(/[^a-zA-Z0-9_-]/g,'')}.${photo.filenameExt||'webp'}`,
        title:(photo.title||'').trim(),alt:(photo.alt||photo.title||photo.caption||'日記の写真').trim(),caption:(photo.caption||'').trim()
      }))
    };
  }
  const manifestEntry=entry=>({id:entry.id,date:entry.date,title:entry.title,weather:entry.weather||'',mood:entry.mood||'',tags:entry.tags||[]});
  window.JournalStore={getDrafts,getDraft,putDraft,deleteDraft,newId,localDate,validDate,pathForDate,loadPublished,loadEntry,safeImageSrc,shrinkImage,publishable,manifestEntry};
})();
