import {validWalletPasswords,walletBackup} from './local-wallet-policy.js';
export function mountLocalWallet({isReady,onRecipient,doc=document,win=window,workerFactory=()=>new Worker(new URL('./local-wallet-worker.js',import.meta.url),{type:'module'})}){
 const $=id=>doc.getElementById('wallet-'+id);let worker=null,backup=null,busy=false,downloaded=false,operation=0,objectUrl=null;
 const status=text=>{$('status').textContent=text;};
 const clearPasswords=()=>{$('password').value='';$('confirmation').value='';};
 const revoke=()=>{if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}};
 function controls(){
  $('create').disabled=busy||Boolean(backup)||!isReady();$('password').disabled=busy||Boolean(backup);$('confirmation').disabled=busy||Boolean(backup);
  $('download').disabled=!backup;$('backup-confirmed').disabled=!backup||!downloaded;
  $('use').disabled=!backup||!downloaded||!$('backup-confirmed').checked||!isReady();$('cancel').hidden=!busy;
 }
 function stop(){operation++;worker?.terminate();worker=null;busy=false;clearPasswords();controls();}
 async function create(event){
  event.preventDefault();
  if(busy||backup||!isReady())return;
  if(!win.isSecureContext||typeof win.crypto?.getRandomValues!=='function'||typeof workerFactory!=='function'){clearPasswords();status('Wallet creation requires a secure browser with cryptographic randomness.');return;}
  let password=$('password').value;
  if(!validWalletPasswords(password,$('confirmation').value)){password='';clearPasswords();status('Use matching passwords with 16–128 characters.');return;}
  const current=++operation;busy=true;downloaded=false;$('backup-confirmed').checked=false;clearPasswords();controls();status('Creating and encrypting your wallet locally…');
  try{
   worker=workerFactory();
   worker.onmessage=event=>{
    if(current!==operation)return;
    const message=event.data;
    if(message?.type==='progress'){if(Number.isFinite(message.progress))status('Encrypting wallet locally · '+Math.round(Math.max(0,Math.min(1,message.progress))*100)+'%');return;}
    if(message?.type==='ready'){
     try{backup=walletBackup(message);$('address').textContent=backup.address;status('Wallet encrypted. Download the backup and keep its password separately before using this address.');}
     catch{backup=null;status('The encrypted backup could not be checked. No recipient was changed.');}
    }else{backup=null;status('Wallet creation did not finish. No recipient was changed.');}
    worker?.terminate();worker=null;busy=false;operation++;clearPasswords();controls();
   };
   worker.onerror=()=>{if(current!==operation)return;stop();status('Wallet creation did not finish. No recipient was changed.');};
   worker.postMessage({password});
  }catch{stop();status('Wallet creation is unavailable in this browser. No recipient was changed.');}
  finally{password='';}
 }
 $('form').addEventListener('submit',create);
 $('cancel').addEventListener('click',()=>{stop();status('Wallet creation cancelled. No recipient was changed.');});
 $('download').addEventListener('click',()=>{
  if(!backup)return;revoke();objectUrl=URL.createObjectURL(new Blob([backup.keystore+'\n'],{type:'application/json'}));
  const link=doc.createElement('a');link.href=objectUrl;link.download='Numina-wallet-'+backup.address.slice(2,10)+'.json';doc.body.append(link);link.click();link.remove();downloaded=true;controls();status('Download requested. Confirm the encrypted file is saved and keep the password separately.');
 });
 $('backup-confirmed').addEventListener('change',controls);
 $('use').addEventListener('click',()=>{
  if(!backup||!downloaded||!$('backup-confirmed').checked||!isReady())return;
  onRecipient(backup.address);status('Public address entered as the recipient. Network acceptance, reviews and funding remain unverified.');
 });
 const cleanup=()=>{stop();revoke();backup=null;downloaded=false;$('backup-confirmed').checked=false;$('address').textContent='No wallet created.';controls();status('Wallet session cleared. Keep your saved encrypted backup and password.');};
 win.addEventListener('pagehide',cleanup);
 win.addEventListener('beforeunload',event=>{if(busy||(backup&&!$('backup-confirmed').checked)){event.preventDefault();event.returnValue='';}});
 controls();return {setAvailable:controls,cleanup};
}
