import {requestJson} from './http-client.js';
try{
 const session=await requestJson('/api/reviewer/v1/session');
 if(session.active||session.hasSession){
  document.documentElement.dataset.reviewWorkspace='true';
  const banner=document.createElement('aside');banner.className='reviewer-banner';banner.setAttribute('aria-label','Reviewer workspace');
  const label=document.createElement('strong');label.textContent=session.active?'Reviewer account · production':'Reviewer session expired';
  const text=document.createElement('span');text.textContent=session.active?'Only this account’s records are available. Checkout is live and can charge money.':'Open Reviewer access to sign in again, or exit this session.';
  const exit=document.createElement('button');exit.type='button';exit.textContent='Exit review workspace';
  exit.addEventListener('click',async()=>{exit.disabled=true;try{await requestJson('/api/reviewer/v1/logout',{method:'POST'});location.assign('/reviewer');}catch{exit.disabled=false;exit.textContent='Sign-out failed — try again';}});
  banner.append(label,text,exit);document.body.prepend(banner);
 }
}catch{/* Public pages remain usable when session status is unavailable. */}
