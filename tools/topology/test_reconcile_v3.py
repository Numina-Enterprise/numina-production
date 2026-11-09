import unittest
from reconcile_v3 import reconcile,PROVIDERS
class Tests(unittest.TestCase):
 def setUp(self):
  self.c={'authority':'NUMINA','signature_attestation':{'verifier_result':'PASS','receipt_sha256':'abc','trust_anchor_id':'external'},'workloads':[],'replication':[{'source':'gcp','destination':'aws','direction':'one_way','rpo_seconds':60,'rto_seconds':600,'integrity_policy':'sha256','encryption_policy':'kms','conflict_policy':'source_wins','test_receipt_sha256':'abc'}]}
  self.o={'authority':'observational_only','providers':{p:{'status':'observed','inventory_sha256':'abc'} for p in PROVIDERS},'workloads':[]}
 def test_review_not_authorized(self):
  r=reconcile(self.c,self.o);self.assertEqual(r['status'],'REVIEW');self.assertFalse(r['deployment_authorized'])
 def test_missing_provider(self):
  del self.o['providers']['ibm_quantum'];self.assertEqual(reconcile(self.c,self.o)['status'],'BLOCKED')
 def test_boolean_signature_is_insufficient(self):
  self.c.pop('signature_attestation');self.c['verified_signatures']=True;self.assertIn('independent_signature_receipt_missing',[x['kind'] for x in reconcile(self.c,self.o)['findings']])
 def test_replication_missing(self):
  self.c['replication']=[];self.assertEqual(reconcile(self.c,self.o)['status'],'BLOCKED')
 def test_missing_workload(self):
  self.c['workloads']=[dict(workload_id='a',provider='gcp',environment='prod',region='us',artifact_sha256='a',identity='x')];self.assertEqual(reconcile(self.c,self.o)['status'],'BLOCKED')
 def test_drift(self):
  w=dict(workload_id='a',provider='gcp',environment='prod',region='us',artifact_sha256='a',identity='x');self.c['workloads']=[w];self.o['workloads']=[dict(w,artifact_sha256='b')];self.assertIn('workload_drift',[x['kind'] for x in reconcile(self.c,self.o)['findings']])
 def test_unmanaged(self):
  self.o['workloads']=[dict(workload_id='a',provider='aws',environment='prod',region='us',artifact_sha256='a',identity='x')];self.assertEqual(reconcile(self.c,self.o)['status'],'BLOCKED')
 def test_duplicate(self):
  w=dict(workload_id='a',provider='gcp',environment='prod',region='us',artifact_sha256='a',identity='x');self.o['workloads']=[w,w];self.assertEqual(reconcile(self.c,self.o)['status'],'BLOCKED')
 def test_invalid_edge(self):
  self.c['replication'][0]['direction']='unknown';self.assertEqual(reconcile(self.c,self.o)['status'],'BLOCKED')
if __name__=='__main__':unittest.main()
