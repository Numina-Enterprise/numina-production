export function validWalletPasswords(password,confirmation){
 return typeof password==='string'&&password.length>=16&&password.length<=128&&password===confirmation;
}
export function walletBackup(result){
 if(!result||typeof result.address!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(result.address)||typeof result.keystore!=='string'||result.keystore.length>8192)throw Error('Wallet backup is unavailable.');
 let value;try{value=JSON.parse(result.keystore);}catch{throw Error('Wallet backup is unavailable.');}
 const c=value.Crypto,hex=(v,length)=>typeof v==='string'&&new RegExp('^[0-9a-fA-F]{'+length+'}$').test(v);
 if(value.version!==3||value.address?.toLowerCase()!==result.address.slice(2).toLowerCase()||!hex(value.address,40)||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(value.id??'')||c?.cipher!=='aes-128-ctr'||c.kdf!=='scrypt'||!hex(c.cipherparams?.iv,32)||!hex(c.ciphertext,64)||!hex(c.mac,64)||!hex(c.kdfparams?.salt,64)||c.kdfparams.n!==131072||c.kdfparams.r!==8||c.kdfparams.p!==1||c.kdfparams.dklen!==32)throw Error('Wallet backup is unavailable.');
 // Retain only the standard encrypted keystore fields, never arbitrary metadata.
 return {address:result.address,keystore:JSON.stringify({address:value.address,id:value.id,version:3,Crypto:{cipher:'aes-128-ctr',cipherparams:{iv:c.cipherparams.iv},ciphertext:c.ciphertext,kdf:'scrypt',kdfparams:{salt:c.kdfparams.salt,n:131072,r:8,p:1,dklen:32},mac:c.mac}})};
}
