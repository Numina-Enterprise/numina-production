import {Wallet} from './vendor/ethers-6.15.0.min.js';
import {walletBackup} from './local-wallet-policy.js';
export async function encryptLocalWallet(password,onProgress=()=>{},walletFactory=()=>new Wallet(Wallet.createRandom().privateKey)){
 if(typeof password!=='string'||password.length<16||password.length>128)throw Error('A longer wallet password is required.');
 let wallet;
 try{
  wallet=walletFactory();
  if(wallet.provider!==null)throw Error('Connected wallets are not accepted.');
  const address=wallet.address;
  const keystore=await wallet.encrypt(password,onProgress);
  return walletBackup({address,keystore});
 }finally{wallet=null;password='';}
}
