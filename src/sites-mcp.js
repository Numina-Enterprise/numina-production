// The hosted plugin exposes only Numina's public, read-only discovery profile.
// Private control and treasury routes retain their existing authorization.
export async function sitesMcpHttp(req,env,discoveryHttp){
  const target=new URL(req.url);
  if(target.pathname!=='/mcp')return null;
  if(req.method!=='POST')return new Response(JSON.stringify({error:'METHOD_NOT_ALLOWED'}),{status:405,headers:{Allow:'POST','Content-Type':'application/json','Cache-Control':'no-store'}});
  target.pathname='/api/control/v2/discovery-mcp';
  return discoveryHttp(new Request(target,req),env);
}
