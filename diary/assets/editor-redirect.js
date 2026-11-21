(() => {
'use strict';
// Legacy GitHub Pages editing remains available until the isolated Worker is deployed.
if(location.origin!=='https://dopa-gaki.github.io')return;
const newOrigin='https://diary-auth.ueda-photo-11.workers.dev';
const relative=location.pathname.replace(/^\/\.github\.io\/diary/,'');
if(relative!=='/editor.html'&&relative!=='/preview.html')return;
const target=newOrigin+relative+location.search+location.hash;
fetch(newOrigin+'/editor-version',{cache:'no-store',mode:'cors'})
  .then(async r=>{if(r.ok&&(await r.json()).isolated)location.replace(target);})
  .catch(()=>{});
})();