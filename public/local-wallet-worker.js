import {encryptLocalWallet} from './local-wallet-crypto.js';
let started=false;
self.onmessage=async event=>{
 if(started)return;started=true;
 let password=event.data?.password;
 if(event.data)event.data.password=null;
 try{
  if(!self.isSecureContext||typeof crypto?.getRandomValues!=='function')throw Error('Secure context required');
  const result=await encryptLocalWallet(password,progress=>self.postMessage({type:'progress',progress}));
  self.postMessage({type:'ready',...result});
 }catch{self.postMessage({type:'failed'});}
 finally{password='';self.close();}
};
