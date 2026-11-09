// Outbound request guard. With NUMINA_TREASURY_NETWORK_GUARD=loopback-only (set by the test
// suite) every request to a non-loopback host is refused before any socket opens.
export class NetworkGuardError extends Error{constructor(m){super(m);this.name='NetworkGuardError';this.code='NETWORK_GUARD';}}
const LOOPBACK=new Set(['127.0.0.1','localhost','[::1]','::1']);
export function guardedFetch(env=process.env,fetchImpl=globalThis.fetch){
  return async(url,init)=>{
    const u=new URL(url);
    if(env.NUMINA_TREASURY_NETWORK_GUARD==='loopback-only'&&!LOOPBACK.has(u.hostname))throw new NetworkGuardError(`blocked outbound request to ${u.host} (loopback-only guard)`);
    if(u.protocol!=='https:'&&!(u.protocol==='http:'&&LOOPBACK.has(u.hostname)))throw new NetworkGuardError(`refusing non-https request to ${u.host}`);
    return fetchImpl(url,{...init,redirect:'manual'});
  };
}
