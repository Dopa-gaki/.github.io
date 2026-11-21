(() => {
  'use strict';
  const $=s=>document.querySelector(s);
  const Store=window.JournalStore;
  const mode=document.body.dataset.mode;
  const SETTINGS={browserTitle:'日記',brandName:'日記',label:'',titleLines:['日記'],intro:'',footerName:'日記'};
  const state={query:'',year:'all',tag:'all',visible:6,renderId:0};
  const week=['日','月','火','水','木','金','土'];
  const node=(tag,cls,value)=>{const element=document.createElement(tag);if(cls)element.className=cls;if(value!==undefined)element.textContent=value;return element;};
  const normalized=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ja-JP');
  const dateObj=date=>new Date(date+'T12:00:00');
  let entries=[];
  const draftById=new Map(),publishedCache=new Map(),objectUrls=new Set();
  async function getFull(entry){
    if(draftById.has(entry.id))return draftById.get(entry.id);
    if(!publishedCache.has(entry.date))publishedCache.set(entry.date,Store.loadEntry(entry.date).catch(e=>{publishedCache.delete(entry.date);throw e;}));
    return publishedCache.get(entry.date);
  }
  const basicMatch=entry=>(state.year==='all'||entry.date.startsWith(state.year+'-'))&&(state.tag==='all'||(entry.tags||[]).includes(state.tag));
  const searchText=entry=>normalized([entry.date,entry.title,entry.weather,entry.mood,...(entry.tags||[]),...(entry.body||[]),...(entry.photos||[]).flatMap(p=>[p.title||'',p.caption||''])].join(' '));
  function matchesSearch(entry,words){return words.every(word=>searchText(entry).includes(word));}
  function releaseImages(){for(const u of objectUrls)URL.revokeObjectURL(u);objectUrls.clear();}
  function renderEntry(entry){
    const article=node('article','entry'),left=node('div','entry-date');
    const day=node('time','entry-day',entry.date.slice(-2));day.dateTime=entry.date;
    left.append(day,node('span','entry-week',week[dateObj(entry.date).getDay()]));
    const content=node('div','entry-content');content.append(node('h3','entry-title',entry.title||'無題'));
    const meta=node('div','entry-meta');
    if(entry.weather)meta.append(node('span','','天気：'+entry.weather));
    if(entry.mood)meta.append(node('span','',entry.mood));
    if(meta.childElementCount)content.append(meta);
    const body=node('div','entry-body');for(const paragraph of entry.body||[])body.append(node('p','',paragraph));content.append(body);
    if(entry.photos?.length){
      const gallery=node('div','entry-photos');
      for(const photo of entry.photos){
        let src='';
        if(mode==='preview'&&photo.blob instanceof Blob){src=URL.createObjectURL(photo.blob);objectUrls.add(src);}
        else src=Store.safeImageSrc(photo.src);
        if(!src)continue;
        const figure=node('figure'),img=node('img');img.src=src;img.alt=photo.alt||'日記の写真';img.loading='lazy';img.decoding='async';
        figure.append(img);
        if(photo.title||photo.caption){
          const caption=node('figcaption','photo-caption');
          if(photo.title)caption.append(node('strong','photo-caption-title',photo.title));
          if(photo.caption)caption.append(node('span','photo-caption-body',photo.caption));
          figure.append(caption);
        }
        gallery.append(figure);
      }
      if(gallery.childElementCount)content.append(gallery);
    }
    if(entry.tags?.length){
      const tags=node('div','entry-tags');
      for(const tag of entry.tags){
        const button=node('button','entry-tag','# '+tag);button.type='button';
        button.addEventListener('click',()=>{state.tag=tag;state.visible=6;renderTags();render();$('#archive').scrollIntoView({behavior:'smooth'});});
        tags.append(button);
      }
      content.append(tags);
    }
    article.append(left,content);return article;
  }
  function renderTags(){
    const tags=[...new Set(entries.flatMap(entry=>entry.tags||[]))].sort();
    const target=$('#tag-filters');target.replaceChildren();
    if(state.tag!=='all'&&!tags.includes(state.tag))state.tag='all';
    if(target)target.hidden=!tags.length;
    for(const tag of tags.length?['all',...tags]:[]){
      const button=node('button','tag-filter',tag==='all'?'すべて':tag);button.type='button';button.setAttribute('aria-pressed',String(state.tag===tag));
      button.addEventListener('click',()=>{state.tag=tag;state.visible=6;renderTags();render();});target.append(button);
    }
  }
  async function render(){
    const id=++state.renderId;
    const target=$('#entries');releaseImages();target.replaceChildren(node('p','muted-small','日記を読み込んでいます…'));
    $('#more-button').hidden=true;
    const words=normalized(state.query).trim().split(/\s+/).filter(Boolean);
    const candidate=entries.filter(basicMatch);
    let filtered=candidate;
    let unread=0;
    if(words.length){
      // 本文検索時だけ日別ファイルを追加取得．通常表示は必要な6件のみ取得する．
      const rows=[];let cursor=0;
      const workers=Array.from({length:Math.min(6,candidate.length)},async()=>{
        while(cursor<candidate.length){
          const meta=candidate[cursor++];
          try{const full=await getFull(meta);if(matchesSearch(full,words))rows.push(meta);}catch{unread++;}
        }
      });
      await Promise.all(workers);
      filtered=rows.sort((a,b)=>b.date.localeCompare(a.date));
    }
    if(id!==state.renderId)return;
    $('#results-count').textContent=filtered.length?'全'+filtered.length+'件':'';
    target.replaceChildren();
    if(!filtered.length){
      const empty=node('div','empty');empty.append(node('strong','',mode==='preview'?'下書きはありません':'記事はありません'));
      if(mode==='preview'){const a=node('a','aside-link','編集画面を開く →');a.href='editor.html';empty.append(a);}
      target.append(empty);
    }else{
      const items=filtered.slice(0,state.visible),loaded=await Promise.all(items.map(item=>getFull(item).catch(e=>({error:e,date:item.date}))));
      if(id!==state.renderId)return;
      let month='',group=null;
      for(const full of loaded){
        if(full.error){unread++;const error=node('div','error-note',full.date+' の記事を読み込めません：'+full.error.message);target.append(error);continue;}
        const key=full.date.slice(0,7);
        if(key!==month){month=key;group=node('section','month-group');group.append(node('h3','month-heading',key.slice(0,4)+'年'+Number(key.slice(5))+'月'));target.append(group);}
        group.append(renderEntry(full));
      }
    }
    if(unread)target.prepend(node('div','error-note',unread+'件の記事を読み込めませんでした．ファイルの有無を確認してください．'));
    $('#more-button').hidden=filtered.length<=state.visible;
  }
  async function loadSiteName(){
    let title='日記';
    try{
      const response=await fetch('data/site.json?v='+Date.now(),{cache:'no-store'});
      if(response.ok){
        const settings=await response.json();
        if(typeof settings.title==='string'&&settings.title.trim()&&settings.title.length<=80)title=settings.title.trim();
      }
    }catch{}
    SETTINGS.browserTitle=title.replace(/\n/g,' ');SETTINGS.brandName='日記';SETTINGS.titleLines=title.split('\n');SETTINGS.footerName='日記';
    document.title=(mode==='preview'?'プレビュー｜':'')+SETTINGS.browserTitle;
    const header=document.querySelector('.simple-reader-head h1');
    if(header)header.textContent=title;
  }
  function setTheme(theme){
    document.documentElement.dataset.theme=theme;
    const button=$('#theme-button');button.setAttribute('aria-label',theme==='dark'?'ライトモードに切り替える':'ダークモードに切り替える');
    button.innerHTML=theme==='dark'?'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 15.1A9 9 0 0 1 8.9 3.4 9 9 0 1 0 20.6 15.1Z"/></svg>';
    $('meta[name="theme-color"]').content=theme==='dark'?'#171d1a':'#f6f5f0';
  }
  async function init(){
    await loadSiteName();
    document.title=(mode==='preview'?'プレビュー｜':'')+SETTINGS.browserTitle;
    $('#brand-name').textContent=SETTINGS.brandName;$('#site-label').textContent=SETTINGS.label;
    $('#site-title').replaceChildren(...SETTINGS.titleLines.map(line=>node('span','',line)));
    $('#site-intro').textContent=SETTINGS.intro;$('#footer-title').textContent=SETTINGS.footerName;
    $('#copyright-year').textContent=new Date().getFullYear();
    $('#search').addEventListener('input',e=>{state.query=e.target.value;state.visible=6;render();});
    $('#year-select').addEventListener('change',e=>{state.year=e.target.value;state.visible=6;render();});
    $('#more-button').addEventListener('click',()=>{state.visible+=6;render();});
    let theme;try{theme=localStorage.getItem('diary-theme');}catch{}
    setTheme(theme==='light'||theme==='dark'?theme:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
    $('#theme-button').addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';setTheme(next);try{localStorage.setItem('diary-theme',next);}catch{}});
    let published=[];
    try{published=await Store.loadPublished();}catch(e){$('#entries').before(node('div','error-note','公開済み記事の一覧を読み込めません：'+e.message));}
    let combined=published;
    if(mode==='preview'){
      try{
        const drafts=await Store.getDrafts();
        const wanted=new URLSearchParams(location.search).get('id');
        const shown=wanted?drafts.filter(item=>item.id===wanted):drafts;
        for(const entry of shown)draftById.set(entry.id,entry);
        const draftIds=new Set(shown.map(item=>item.id)),draftDates=new Set(shown.map(item=>item.date));
        combined=[...shown,...published.filter(item=>!draftIds.has(item.id)&&!draftDates.has(item.date))];
      }catch(e){$('#entries').before(node('div','error-note','下書きを読み込めません：'+e.message));}
    }
    entries=combined.filter(item=>item&&Store.validDate(item.date)).sort((a,b)=>b.date.localeCompare(a.date));
    $('#total-count').textContent=entries.length?entries.length+'件':'';
    for(const year of [...new Set(entries.map(item=>item.date.slice(0,4)))]){const opt=node('option','',year+'年');opt.value=year;$('#year-select').append(opt);}
    renderTags();render();
  }
  window.addEventListener('pagehide',releaseImages);
  init();
})();
