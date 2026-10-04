export const NUMINA_SESSION_ORIGIN='https://personal-space-m7q9.skott34.chatgpt.site';
const customHosts=new Set(['numinalabs.xyz','www.numinalabs.xyz']);
const workspacePaths=new Map([
 ['/app','/app'],['/app/','/app'],['/app.html','/app'],
 ['/control','/control'],['/control/','/control'],['/control.html','/control'],
 ['/frontier','/frontier'],['/frontier/','/frontier'],['/frontier.html','/frontier'],
 ['/control-room','/frontier'],['/control-room/','/frontier']
]);
// Reuse the verified Numina browser session without transferring credentials
// between origins. API clients retain their existing authentication contract.
export function workspaceSessionTarget(href,method='GET'){
 const page=new URL(href),path=workspacePaths.get(page.pathname);
 if(!customHosts.has(page.hostname)||!['GET','HEAD'].includes(method)||!path)return null;
 return NUMINA_SESSION_ORIGIN+path+page.search+page.hash;
}
export function workspaceSignInUrl(href,returnTo){
 const target=new URL(returnTo,'https://numina.invalid');
 if(target.origin!=='https://numina.invalid'||!['/app','/control','/frontier'].includes(target.pathname))throw new Error('Invalid Numina continuation');
 const origin=customHosts.has(new URL(href).hostname)?NUMINA_SESSION_ORIGIN:'';
 return origin+'/signin-with-chatgpt?return_to='+encodeURIComponent(target.pathname+target.search+target.hash);
}

export function resumeWorkspaceSession(page){
 const target=workspaceSessionTarget(page.href);
 if(!target)return false;
 page.replace(target);return true;
}
