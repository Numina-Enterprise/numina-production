// Encrypted local OAuth session store (AES-256-GCM). One file per profile, outside the repo,
// mode 0600. The 32-byte key comes from an environment variable named in config; without it,
// nothing is written. Token values are never returned to callers that only list sessions.
import {readFileSync,writeFileSync,existsSync,mkdirSync,unlinkSync,renameSync,statSync} from 'node:fs';
import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import path from 'node:path';

export class TokenStoreError extends Error{constructor(m,code='TOKEN_STORE'){super(m);this.name='TokenStoreError';this.code=code;}}
function keyFrom(env,name){
  const raw=env[name];
  if(!raw)throw new TokenStoreError(`Set ${name} (base64 of 32 random bytes) to store OAuth sessions`, 'TOKEN_KEY_MISSING');
  const key=Buffer.from(raw,'base64');
  if(key.length!==32)throw new TokenStoreError(`${name} must decode to exactly 32 bytes`,'TOKEN_KEY_INVALID');
  return key;
}
export function createTokenStore({file,keyEnv,env=process.env,profile}){
  const aad=Buffer.from(`numina-treasury-mcp:${profile}`);
  return {
    file,profile,
    exists:()=>existsSync(file),
    save(session){
      const key=keyFrom(env,keyEnv);
      const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(aad);
      const body=Buffer.concat([c.update(JSON.stringify({...session,profile,savedAt:new Date().toISOString()})),c.final()]);
      mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
      const tmp=file+'.tmp';
      writeFileSync(tmp,JSON.stringify({v:1,alg:'AES-256-GCM',profile,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:body.toString('base64')}),{mode:0o600});
      renameSync(tmp,file);
    },
    load(){
      if(!existsSync(file))return null;
      const key=keyFrom(env,keyEnv);
      const box=JSON.parse(readFileSync(file,'utf8'));
      try{const d=createDecipheriv('aes-256-gcm',key,Buffer.from(box.iv,'base64'));d.setAAD(aad);d.setAuthTag(Buffer.from(box.tag,'base64'));
        return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data,'base64')),d.final()]).toString('utf8'));}
      catch{throw new TokenStoreError('session file failed to decrypt (wrong key or tampered)','TOKEN_DECRYPT_FAILED');}
    },
    // Metadata only: no token values leave this function.
    describe(){
      if(!existsSync(file))return {profile,stored:false,file};
      const st=statSync(file);let meta={};
      try{const s=this.load();meta={clientId:s.clientId?createHash('sha256').update(s.clientId).digest('hex').slice(0,12):null,scope:s.scope||null,expiresAt:s.expiresAt||null,savedAt:s.savedAt||null,hasRefreshToken:!!s.refreshToken,authorizationServer:s.issuer||null};}
      catch(e){meta={unreadable:e.code||'ERROR'};}
      return {profile,stored:true,file,modifiedAt:st.mtime.toISOString(),...meta};
    },
    revoke(){if(existsSync(file)){unlinkSync(file);return true;}return false;}
  };
}
