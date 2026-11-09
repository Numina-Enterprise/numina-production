import unittest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
from unittest.mock import patch
import verify_authority as v
class AuthorityTests(unittest.TestCase):
    def setUp(self):
        self.key=Ed25519PrivateKey.generate();self.pub=self.key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
        self.der=self.key.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
        import hashlib
        self.fp=hashlib.sha256(self.der).hexdigest();self.message=b'{"authority":"NUMINA"}';self.sig=self.key.sign(v.PREFIX+self.message)
    def test_valid_signature_with_pinned_fingerprint(self):
        with patch.object(v,'FINGERPRINT',self.fp):self.assertEqual(v.verify(self.message,self.sig,self.pub)['result'],'PASS')
    def test_wrong_fingerprint_rejected(self):
        with self.assertRaisesRegex(ValueError,'fingerprint'):v.verify(self.message,self.sig,self.pub)
    def test_tampered_message_rejected(self):
        with patch.object(v,'FINGERPRINT',self.fp):
            with self.assertRaises(Exception):v.verify(self.message+b' ',self.sig,self.pub)
    def test_wrong_domain_rejected(self):
        bad=self.key.sign(self.message)
        with patch.object(v,'FINGERPRINT',self.fp):
            with self.assertRaises(Exception):v.verify(self.message,bad,self.pub)
if __name__=='__main__':unittest.main()
