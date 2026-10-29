import prepareHandler from '../runtime/vercel-production/api/execution-prepare.js';
import submitHandler from '../runtime/vercel-production/api/execution-submit.js';

export default async function handler(req,res){
  const url=new URL(req.url,'https://numinalabs.xyz');
  if(String(url.searchParams.get('mode')||'').toLowerCase()==='submit')return submitHandler(req,res);
  return prepareHandler(req,res);
}
