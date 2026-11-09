import unittest
from reconcile import reconcile
BASE={'workload_id':'n1','provider':'gcp','environment':'prod','region':'us-central1','artifact_sha256':'a'*64,'identity':'service-a'}
class Tests(unittest.TestCase):
 def canonical(self,**kw):return {'authority':'NUMINA','verified_signatures':True,'workloads':[dict(BASE,**kw)]}
 def observed(self,**kw):return {'workloads':[dict(BASE,**kw)]}
 def test_matching_is_review_not_release(self):
  r=reconcile(self.canonical(),self.observed());self.assertEqual(r['status'],'REVIEW');self.assertFalse(r['replication_authorized'])
 def test_unsigned_blocks(self):
  c=self.canonical();c['verified_signatures']=False;self.assertEqual(reconcile(c,self.observed())['status'],'BLOCKED')
 def test_missing_blocks(self):self.assertEqual(reconcile(self.canonical(),{'workloads':[]})['status'],'BLOCKED')
 def test_drift_blocks(self):self.assertEqual(reconcile(self.canonical(),self.observed(region='eastus'))['status'],'BLOCKED')
 def test_extra_blocks(self):self.assertEqual(reconcile({'authority':'NUMINA','verified_signatures':True,'workloads':[]},self.observed())['status'],'BLOCKED')
 def test_duplicate_blocks(self):self.assertEqual(reconcile(self.canonical(),{'workloads':[BASE,BASE]})['status'],'BLOCKED')
 def test_invalid_entry_blocks(self):self.assertEqual(reconcile({'authority':'NUMINA','verified_signatures':True,'workloads':[{}]},self.observed())['status'],'BLOCKED')
if __name__=='__main__':unittest.main()
