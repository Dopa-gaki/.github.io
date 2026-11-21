(() => {
'use strict';
const $=s=>document.querySelector(s),Store=window.JournalStore;
const status=s=>{$('#status').textContent=s;};
function fromBase64(encoded,mime){
  const bin=atob(encoded),bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return new Blob([bytes],{type:mime});
}
function normalizedText(x,max=12000){return typeof x==='string'?x.slice(0,max):'';}
function cleanEntry(e){
  if(!e||typeof e!=='object'||!Store.validDate(e.date)||typeof e.id!=='string'||e.id.length>110||!Array.isArray(e.photos)||e.photos.length>40)throw new Error('下書きの形式が正しくありません');
  if(!Array.isArray(e.body)||!Array.isArray(e.tags))throw new Error('下書きの本文やタグが不正です');
  const photos=e.photos.map(p=>{
    if(!p||typeof p!=='object')throw new Error('写真情報が不正です');
    const photo={id:normalizedText(p.id,110)||Store.newId(),src:Store.safeImageSrc(p.src),title:normalizedText(p.title,250),alt:normalizedText(p.alt,400),caption:normalizedText(p.caption,5000),originalName:normalizedText(p.originalName,256),filenameExt:['webp','png','jpg','jpeg'].includes(p.filenameExt)?p.filenameExt:'webp'};
    if(p.blobBase64!==undefined){
      if(typeof p.blobBase64!=='string'||p.blobBase64.length>6e6||!/^[A-Za-z0-9+/]*={0,2}$/.test(p.blobBase64))throw new Error('写真データの形式が不正です');
      const mime=['image/webp','image/png','image/jpeg'].includes(p.blobType)?p.blobType:'image/webp';
      photo.blob=fromBase64(p.blobBase64,mime);
    }
    return photo;
  });
  return {id:e.id,date:e.date,title:normalizedText(e.title,140),weather:normalizedText(e.weather,100),mood:normalizedText(e.mood,100),tags:e.tags.filter(x=>typeof x==='string').slice(0,20).map(x=>x.slice(0,80)),body:e.body.filter(x=>typeof x==='string').slice(0,150).map(x=>x.slice(0,12000)),photos,updatedAt:new Date().toISOString()};
}
async function run(){
  const f=$('#file').files?.[0];if(!f){status('バックアップファイルを選択してください．');return;}
  if(f.size>120*1024*1024){status('ファイルが大きすぎます．');return;}
  $('#import').disabled=true;
  try{
    const o=JSON.parse(await f.text());
    if(o.format!=='diary-drafts-backup-v1'||!Array.isArray(o.entries)||o.entries.length>2000)throw new Error('対応していないバックアップです');
    const originals=await Store.getDrafts(),used=new Set(originals.map(e=>e.id));
    let added=0;
    for(const source of o.entries){
      const entry=cleanEntry(source);
      if(used.has(entry.id))entry.id=Store.newId();
      used.add(entry.id);
      await Store.putDraft(entry);added++;
    }
    status(added+' 件を取り込みました．記事と写真を確認してから旧データを削除してください．');
  }catch(e){status('取り込みに失敗：'+e.message);}finally{$('#import').disabled=false;}
}
$('#import').addEventListener('click',run);
})();