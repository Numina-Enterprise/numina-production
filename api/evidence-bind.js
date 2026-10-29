import evidenceBindHandler from '../runtime/vercel-production/api/evidence-bind.js';

function retiredMode(req){
  try{
    const mode=new URL(req.url,'https://numinalabs.xyz').searchParams.get('mode');
    return mode==='provider-observation-ingest'||mode==='trusted-production-release-ingest';
  }catch{return false;}
}

export default async function handler(req,res){
  if(retiredMode(req)){
    res.statusCode=410;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    return res.end(JSON.stringify({
      error:'RETIRED_EVIDENCE_INGEST_ROUTE',
      persistence:'numina_release_assets',
      canonical:'NUMINA'
    }));
  }
  return evidenceBindHandler(req,res);
}
