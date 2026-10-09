const el=id=>document.getElementById(id);
export async function refreshControlRoom(){
  const read=async url=>{const r=await fetch(url,{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Unavailable');return r.json();};
  const outcomes=await Promise.allSettled([read('/api/control/v2/head'),read('/v2/network/status')]);
  const head=outcomes[0],chain=outcomes[1];
  if(head.status==='fulfilled'){const h=head.value;el('canonical-head').textContent=h.head;el('canonical-root').textContent=h.rootHash;el('head-revision').textContent=String(h.revision);el('head-state').textContent=h.journalContinuity?'Canonical journal connected':'Journal continuity unavailable';}
  else {for(const id of ['canonical-head','canonical-root','head-revision','head-state'])el(id).textContent='Unavailable';}
  if(chain.status==='fulfilled'){const c=chain.value;el('chain-state').textContent=c.status==='connected'?'Kaleido connected · Chain '+c.chainId:'Connection unavailable';el('chain-height').textContent=c.latestBlock?.number??'Unavailable';el('chain-observed').textContent=c.observedAt??'Unavailable';}
  else {for(const id of ['chain-state','chain-height','chain-observed'])el(id).textContent='Unavailable';}
}
