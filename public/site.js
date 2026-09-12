(async()=>{
  const setStatus=(id,text,ok)=>{const el=document.getElementById(id);if(el){el.textContent=text;el.className='status '+(ok?'ok':'bad')}};
  try{
    const r=await fetch('/v1/status',{cache:'no-store'});const j=await r.json();const ok=r.ok&&j.frozen_core?.valid&&j.conformance?.valid;
    setStatus('status-line',ok?'VERIFIED':'NOT VERIFIED',ok);
    const pre=document.getElementById('status-json');if(pre)pre.textContent=JSON.stringify(j,null,2);
    const cv=document.getElementById('core-version');if(cv)cv.textContent='Numina Core v'+String(j.core_version||'1.8').replace(/\.0$/,'');
    const pv=document.getElementById('production-version');if(pv)pv.textContent='v'+String(j.production_version||'1.9.0-rc20').replace(/\.0-rc/i,' RC');
    const cf=document.getElementById('core-conformance');if(cf){const n=j.conformance?.passing_tests||j.core_conformance_passing_tests||0;cf.textContent=n+' / 309'}
  }catch(e){setStatus('status-line','UNAVAILABLE',false);const pre=document.getElementById('status-json');if(pre)pre.textContent=String(e)}
  try{
    const r=await fetch('/v1/release/supply-chain',{cache:'no-store'});const j=await r.json();const ok=r.ok&&j.valid===true;
    setStatus('supply-chain-line',ok?'VERIFIED':'NOT VERIFIED',ok);
    const pre=document.getElementById('supply-chain-json');if(pre)pre.textContent=JSON.stringify(j,null,2);
    const badge=document.getElementById('supply-chain-status');if(badge)badge.textContent=ok?'VERIFIED':'UNVERIFIED';
  }catch(e){setStatus('supply-chain-line','UNAVAILABLE',false);const pre=document.getElementById('supply-chain-json');if(pre)pre.textContent=String(e)}
})();
