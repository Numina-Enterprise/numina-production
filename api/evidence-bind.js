import evidenceBindHandler from '../runtime/vercel-production/api/evidence-bind.js';
import providerEvidenceIngestHandler from '../runtime/vercel-production/api/provider-evidence-ingest.js';
import trustedProductionReleaseIngestHandler from '../runtime/vercel-production/api/trusted-production-release-ingest.js';

export default async function handler(req,res){
  const url=new URL(req.url,'https://numina-production.vercel.app');
  const mode=url.searchParams.get('mode');
  if(mode==='provider-observation-ingest')return providerEvidenceIngestHandler(req,res);
  if(mode==='trusted-production-release-ingest')return trustedProductionReleaseIngestHandler(req,res);
  return evidenceBindHandler(req,res);
}
