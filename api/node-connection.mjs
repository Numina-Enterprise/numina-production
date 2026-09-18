import nodeHandler from '../runtime/vercel-production/api/node-connection.mjs';
import finalizeHandler from '../runtime/vercel-production/lib/finalize-numina.mjs';

export const maxDuration = 60;

export default async function handler(req,res){
  const url=new URL(req.url,'https://numina.invalid');
  if(url.searchParams.has('finalize')) return finalizeHandler(req,res);
  return nodeHandler(req,res);
}
