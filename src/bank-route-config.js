import {verifyTreasuryRecord} from '../public/treasury-proof.js';

// Private configuration read only; no ACH debit, credit, or bank API submission.
export async function readPrivateBankRoute(req,{env=process.env,fetcher=fetch,verify=verifyTreasuryRecord}={}){
  const authorization=req.headers?.authorization;
  const cookie=req.headers?.cookie;
  if(!authorization&&!cookie)throw Object.assign(Error('OWNER_AUTH_REQUIRED'),{status:401});
  const headers={Accept:'application/json'};
  if(typeof authorization==='string')headers.Authorization=authorization;
  if(typeof cookie==='string')headers.Cookie=cookie;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetcher('https://personal-space-m7q9.skott34.chatgpt.site/api/control/v1/treasury',{method:'GET',headers,redirect:'manual',signal:controller.signal});
    if(!response.ok||response.redirected)throw Object.assign(Error('OWNER_AUTH_UNAVAILABLE'),{status:[401,403].includes(response.status)?response.status:503});
    if(!response.body)throw Error('OWNER_AUTH_UNAVAILABLE');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>1048576){await reader.cancel();throw Error('OWNER_AUTH_UNAVAILABLE');}chunks.push(chunk.value);}}
    finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const treasury=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!await verify(treasury,{allowUninitialized:true}))throw Error('OWNER_AUTH_UNAVAILABLE');
    const account=env.NUMINA_BOFA_SAVINGS_ACCOUNT||'',routing=env.NUMINA_BOFA_ACH_ROUTING_NUMBER||'';
    const syntax=/^[0-9]{5,17}$/.test(account)&&/^[0-9]{9}$/.test(routing);
    const digits=syntax?[...routing].map(Number):[];
    const checksum=syntax&&(3*(digits[0]+digits[3]+digits[6])+7*(digits[1]+digits[4]+digits[7])+digits[2]+digits[5]+digits[8])%10===0&&!/^0+$/.test(routing);
    return {schema:'numina.treasury.bank-route.v1',identity:'NUMINA',providerLabel:'Bank of America',accountType:'savings',rail:'ACH',
      configurationStatus:checksum?'owner_provided_unverified':'not_configured',accountLast4:checksum?account.slice(-4):null,routingNumberStored:checksum,
      evidenceType:'owner_provided_configuration',ownerDeclaration:{ownershipVerified:true,achDebitAuthorized:true,evidenceType:'owner_statement',providerVerified:false},ownershipVerified:false,bankConnectionVerified:false,providerBalance:null,
      achSubmissionEnabled:false,submissionPerformed:false,receipt:null};
  }catch(error){
    throw Object.assign(Error([401,403].includes(error.status)?'OWNER_AUTH_REQUIRED':'BANK_ROUTE_UNAVAILABLE'),{status:[401,403].includes(error.status)?error.status:503});
  }finally{clearTimeout(timer);controller.abort();}
}
