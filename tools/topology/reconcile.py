#!/usr/bin/env python3
"""Fail-closed comparison of NUMINA canonical topology against read-only observations."""
import argparse, hashlib, json, pathlib
REQUIRED = ('workload_id','provider','environment','region','artifact_sha256','identity')
def reconcile(canonical, observed):
    expected = canonical.get('workloads', [])
    actual = observed.get('workloads', [])
    findings=[]
    if canonical.get('authority') != 'NUMINA' or not canonical.get('verified_signatures'):
        findings.append({'kind':'untrusted_canonical_manifest','status':'BLOCKED'})
    if not isinstance(expected,list) or not isinstance(actual,list):
        return {'status':'BLOCKED','findings':[{'kind':'invalid_inventory_shape','status':'BLOCKED'}]}
    by_id={}
    for item in actual:
        key=item.get('workload_id') if isinstance(item,dict) else None
        if not key or key in by_id:
            findings.append({'kind':'invalid_or_duplicate_observation','status':'BLOCKED'})
        else:by_id[key]=item
    expected_ids=set()
    for item in expected:
        if not isinstance(item,dict) or any(not item.get(k) for k in REQUIRED):
            findings.append({'kind':'invalid_canonical_entry','status':'BLOCKED'});continue
        key=item['workload_id']
        if key in expected_ids:findings.append({'kind':'duplicate_canonical_entry','workload_id':key,'status':'BLOCKED'})
        expected_ids.add(key)
        match=by_id.get(key)
        if match is None:
            findings.append({'kind':'missing_observation','workload_id':key,'status':'BLOCKED'});continue
        differences=[k for k in REQUIRED if match.get(k)!=item[k]]
        if differences:findings.append({'kind':'drift','workload_id':key,'fields':differences,'status':'BLOCKED'})
        else:findings.append({'kind':'matched_fields_not_attested','workload_id':key,'status':'REVIEW'})
    for key in sorted(set(by_id)-expected_ids):findings.append({'kind':'unmanaged_observation','workload_id':key,'status':'BLOCKED'})
    # Matching metadata does not establish cryptographic provenance or runtime readiness.
    return {'schema':'numina.topology.reconciliation.v1','status':'BLOCKED' if any(x['status']=='BLOCKED' for x in findings) else 'REVIEW','replication_authorized':False,'deployment_authorized':False,'findings':findings}
def main():
    p=argparse.ArgumentParser();p.add_argument('--canonical',required=True);p.add_argument('--observed',required=True);p.add_argument('--out',required=True);a=p.parse_args()
    canonical=json.loads(pathlib.Path(a.canonical).read_text());observed=json.loads(pathlib.Path(a.observed).read_text())
    result=reconcile(canonical,observed)
    pathlib.Path(a.out).write_text(json.dumps(result,indent=2,sort_keys=True)+'\n')
    print(result['status'],len(result['findings']))
if __name__=='__main__':main()
