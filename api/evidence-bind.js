import evidenceBindHandler from '../runtime/vercel-production/api/evidence-bind.js';
import providerEvidenceIngestHandler from '../runtime/vercel-production/api/provider-evidence-ingest.js';

export default async function handler(req,res){
  const url=new URL(req.url,'https://numina-production.vercel.app');
  if(url.searchParams.get('mode')==='provider-observation-ingest')return providerEvidenceIngestHandler(req,res);
  return evidenceBindHandler(req,res);
}
