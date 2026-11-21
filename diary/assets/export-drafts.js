(() => {
'use strict';
const $=s=>document.querySelector(s),Store=window.JournalStore;
const status=s=>{$('#status').textContent=s;};
async function getAll(){return await Store.getDrafts();}
async function refresh(){try{const a=await getAll();$('#summary').textContent='このブラウザの旧下書き：'+a.length+' 件';}catch(e){status(e.message);}}
function bytesToBase64(bytes){let raw='';for(let i=0;i<bytes.length;i+=0x8000)raw+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(raw);}
async function exportAll(){
  $('#export').disabled=true;
  try{
    const drafts=await getAll();
    if(!drafts.length){status('移行する下書きはありません．');return;}
    const entries=[];
    for(const entry of drafts){
      const photos=[];
      for(const p of entry.photos||[]){
        const copy={id:p.id||'',src:p.src||'',title:p.title||'',alt:p.alt||'',caption:p.caption||'',originalName:p.originalName||'',filenameExt:p.filenameExt||'webp'};
        if(p.blob instanceof Blob){
          copy.blobType=p.blob.type;
          copy.blobBase64=bytesToBase64(new Uint8Array(await p.blob.arrayBuffer()));
        }
        photos.push(copy);
      }
      entries.push({id:entry.id,date:entry.date,title:entry.title,weather:entry.weather||'',mood:entry.mood||'',tags:entry.tags||[],body:entry.body||[],photos,updatedAt:entry.updatedAt||''});
    }
    const blob=new Blob([JSON.stringify({format:'diary-drafts-backup-v1',exportedAt:new Date().toISOString(),entries})],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='diary-drafts-backup-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    status(entries.length+' 件をバックアップしました．新しい編集ページに取り込んでください．');
  }catch(e){status('書き出し失敗：'+e.message);}finally{$('#export').disabled=false;}
}
async function clearAll(){
  if(prompt('新しい編集ページへ取り込んだことを確認してください．旧下書きを削除する場合は「削除」と入力')!=='削除')return;
  try{for(const item of await getAll())await Store.deleteDraft(item.id);await refresh();status('このブラウザの旧下書きを削除しました．');}catch(e){status('削除に失敗：'+e.message);}
}
$('#export').addEventListener('click',exportAll);$('#clear').addEventListener('click',clearAll);refresh();
})();