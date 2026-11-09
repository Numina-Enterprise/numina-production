#!/usr/bin/env python3
"""NUMINA topology evidence gate. Never deploys or enables replication."""
import argparse, json, pathlib
PROVIDERS=('gcp','aws','azure','cloudflare','ibm_cloud','ibm_quantum','tailscale')
REQUIRED=('workload_id','provider','environment','region','artifact_sha256','identity')

def reconcile(canonical, observed):
    findings=[]
    def block(kind, **extra): findings.append({'kind':kind,'status':'BLOCKED',**extra})
    if canonical.get('authority')!='NUMINA':block('canonical_authority_missing')
    # A self-declared boolean is never evidence of cryptographic verification.
    att=canonical.get('signature_attestation')
    if not isinstance(att,dict) or att.get('verifier_result')!='PASS' or not att.get('receipt_sha256') or not att.get('trust_anchor_id'):
        block('independent_signature_receipt_missing')
    if observed.get('authority')!='observational_only':block('observation_provenance_invalid')
    statuses=observed.get('providers',{})
    for provider in PROVIDERS:
        entry=statuses.get(provider)
        if not isinstance(entry,dict) or entry.get('status')!='observed' or not entry.get('inventory_sha256'):
            block('provider_inventory_unverified',provider=provider)
    expected=canonical.get('workloads'); actual=observed.get('workloads')
    if not isinstance(expected,list) or not isinstance(actual,list):
        block('workload_inventory_missing')
        expected=expected if isinstance(expected,list) else []
        actual=actual if isinstance(actual,list) else []
    def index(items,source):
        out={}
        for item in items:
            if not isinstance(item,dict) or any(not item.get(k) for k in REQUIRED):
                block('invalid_workload',source=source);continue
            key=item['workload_id']
            if key in out:block('duplicate_workload',source=source,workload_id=key)
            out[key]=item
        return out
    exp=index(expected,'canonical');obs=index(actual,'observed')
    for key,item in exp.items():
        if key not in obs:block('missing_workload',workload_id=key);continue
        drift=[k for k in REQUIRED if obs[key].get(k)!=item.get(k)]
        if drift:block('workload_drift',workload_id=key,fields=drift)
    for key in obs.keys()-exp.keys():block('unmanaged_workload',workload_id=key)
    rep=canonical.get('replication',[])
    if not isinstance(rep,list):block('invalid_replication_contract');rep=[]
    for edge in rep:
        if not isinstance(edge,dict) or any(not edge.get(k) for k in ('source','destination','direction','rpo_seconds','rto_seconds','integrity_policy','encryption_policy','conflict_policy','test_receipt_sha256')):
            block('replication_evidence_missing',edge=str(edge)[:100]);continue
        if edge['source']==edge['destination'] or edge['direction'] not in ('one_way','bidirectional'):
            block('invalid_replication_edge',source=edge['source'],destination=edge['destination'])
    if not rep:block('replication_contract_missing')
    return {'schema':'numina.topology.reconciliation.v3','status':'BLOCKED' if findings else 'REVIEW','deployment_authorized':False,'replication_authorized':False,'findings':findings}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--canonical',required=True);p.add_argument('--observed',required=True);p.add_argument('--out',required=True);a=p.parse_args()
    result=reconcile(json.loads(pathlib.Path(a.canonical).read_text()),json.loads(pathlib.Path(a.observed).read_text()))
    pathlib.Path(a.out).write_text(json.dumps(result,indent=2,sort_keys=True)+'\n');print(result['status'],len(result['findings']))
