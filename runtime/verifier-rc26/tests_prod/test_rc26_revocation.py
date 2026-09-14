"""Isolated revocation regression checks; never use production keys or records."""
import gc,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException
from fastapi.testclient import TestClient
from numina_prod.config import Settings
from numina_prod.signing import SigningIdentity,verify_envelope
from numina_prod.evidence_network import EvidenceStore,EvidenceStoreConfig,REVOCATION_TYPE
with tempfile.TemporaryDirectory() as import_directory:
    with patch.dict('os.environ',{'NUMINA_DATA_DIR':import_directory,'NUMINA_ENV':'test','NUMINA_ROLE':'public-verifier','NUMINA_DATABASE_URL':'','DATABASE_URL':'','POSTGRES_URL':'','NUMINA_EVIDENCE_DATABASE_URL':''}):
        from numina_prod.service import create_app

class RevocationChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.identity=SigningIdentity(Ed25519PrivateKey.generate())
        cls.settings=Settings(environment='test',role='public-verifier',release='core-v1.8+prod-v1.9.0-rc26',data_dir=Path(cls.temp.name),signing_key_file=None,allow_ephemeral_key=True,require_frozen_core=True,public_url='https://numina-production.vercel.app',database_url=None,real_funds_enabled=False,employer_ip_enabled=False,trusted_hosts=('testserver',),arc_verification_enabled=False,owner_access_url='https://numinalabs.xyz/api/control/v2/runtime-access',owner_root_hash='51116c98ae1c5a9f58a59ff5c801a6b99413a3ef773a01091042866d4ee55db2')
        with patch('numina_prod.service.load_identity',return_value=cls.identity):cls.app=create_app(cls.settings)
        cls.store=EvidenceStore(EvidenceStoreConfig(Path(cls.temp.name)/'evidence-network.sqlite3'))
        cls.client=TestClient(cls.app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        gc.collect()
        cls.temp.cleanup()

    def post(self,payload,token='fixture-owner',origin=None):
        def owner_probe(settings,bearer):
            if bearer!='Bearer fixture-owner':raise HTTPException(403,'OWNER_REQUIRED')
        headers={'Authorization':'Bearer '+token} if token else {}
        if origin:headers['Origin']=origin
        with patch('numina_prod.owner_access._owner_probe',side_effect=owner_probe):
            return self.client.post('/v1/evidence/revoke',json=payload,headers=headers)

    def fixture(self,name):return self.store.put_artifact(state='INTELLIGENCE',artifact_type='ISOLATED_TEST',artifact={'fixture':name})

    def test_authorization_and_origin_fail_closed(self):
        record=self.fixture('auth');payload={'record_id':record['record_id'],'reason':'fixture'}
        self.assertEqual(self.post(payload,token=None).status_code,401)
        self.assertEqual(self.post(payload,token='not-owner').status_code,403)
        self.assertEqual(self.post(payload,origin='https://untrusted.invalid').status_code,403)
        self.assertFalse(self.store.get_record(record['record_id'])['revoked'])

    def test_signed_revocation_retains_artifact_and_original_receipt(self):
        record=self.fixture('retention');payload={'record_id':record['record_id'],'reason':' original reason ','evidence':{'fixture':True}}
        first=self.post(payload);self.assertEqual(first.status_code,200,first.text);first=first.json()
        retry=self.post({**payload,'reason':'different retry reason'}).json()
        self.assertEqual(first,retry)
        self.assertEqual(first['record']['artifact'],record['artifact'])
        self.assertEqual(first['record']['state'],record['state'])
        self.assertEqual(first['revocation']['artifact_root'],record['artifact_root'])
        self.assertEqual(first['revocation']['reason'],'original reason')
        self.assertTrue(verify_envelope(first['receipt'],expected_public_key_b64=self.identity.public_key_b64,expected_type=REVOCATION_TYPE))

    def test_invalid_unknown_and_oversized_requests(self):
        self.assertEqual(self.post({'record_id':'0'*64,'reason':'missing'}).status_code,404)
        self.assertEqual(self.post({'record_id':'bad','reason':'invalid'}).status_code,422)
        self.assertEqual(self.post({'record_id':'0'*64,'reason':'  '}).status_code,422)
        self.assertEqual(self.post({'record_id':'0'*64,'reason':'bounded','evidence':{'value':'x'*17000}}).status_code,413)

    def test_concurrent_store_revocation_preserves_first_receipt(self):
        record=self.fixture('concurrent')
        receipts=[self.identity.sign({'fixture':i},REVOCATION_TYPE) for i in range(8)]
        with ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(lambda receipt:self.store.revoke(record_id=record['record_id'],revocation=receipt),receipts))
        self.assertTrue(all(result['revocation']==results[0]['revocation'] for result in results))
        self.assertTrue(all(result['artifact']==record['artifact'] for result in results))

    def test_core_binding_is_signed_and_preserves_frozen_identity(self):
        response=self.client.get('/v1/release/core-binding');self.assertEqual(response.status_code,200)
        value=response.json();binding=value['binding']
        self.assertEqual(binding,value['receipt']['payload'])
        self.assertEqual(binding['root_count'],1)
        self.assertEqual(binding['core_version'],'1.8.0')
        self.assertEqual(binding['production_version'],'1.9.0-rc26')
        self.assertTrue(binding['frozen_core_valid']);self.assertEqual(binding['frozen_core_checked_files'],105)
        self.assertTrue(verify_envelope(value['receipt'],expected_public_key_b64=self.identity.public_key_b64,expected_type='NUMINA_CORE_RELEASE_BINDING'))

if __name__=='__main__':unittest.main()
