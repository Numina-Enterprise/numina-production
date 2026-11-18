"""Tests for locked model/runtime integrity; fixtures are NOT real weights."""
import hashlib
import json
import struct
import tempfile
import unittest
from pathlib import Path
from verify_inference_lock import verify_lock

class LockTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name)
        self.model=root/"fixture.gguf"
        self.model.write_bytes(b"GGUF"+struct.pack("<IQQ",3,1,1)+b"fixture")
        self.runtime=root/"llama-cli"
        self.runtime.write_bytes(b"fixture runtime")
        self.lock=root/"lock.json"
        self.data={
          "schema_id":"numina.inference-lock.v1",
          "model":{"path":str(self.model),"sha256":hashlib.sha256(self.model.read_bytes()).hexdigest(),"source_url":"https://example.org/model"},
          "runtime":{"path":str(self.runtime),"sha256":hashlib.sha256(self.runtime.read_bytes()).hexdigest(),"source_url":"https://example.org/runtime"},
          "license":{"spdx_id":"MIT","source_url":"https://example.org/license","reviewed_by":"fixture-only"}
        }
    def check(self):
        self.lock.write_text(json.dumps(self.data))
        return verify_lock(self.lock)
    def test_valid_fixture_is_integrity_only(self):
        self.assertEqual(self.check()["status"],"INTEGRITY_VERIFIED_NOT_EXECUTED")
    def test_tampered_model_rejected(self):
        self.model.write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError,"model SHA-256"):
            self.check()
    def test_tampered_runtime_rejected(self):
        self.runtime.write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError,"runtime SHA-256"):
            self.check()
    def test_missing_license_rejected(self):
        self.data["license"].pop("reviewed_by")
        with self.assertRaisesRegex(ValueError,"license"):
            self.check()
    def test_unpinned_hash_rejected(self):
        self.data["model"]["sha256"]=""
        with self.assertRaisesRegex(ValueError,"SHA-256"):
            self.check()
    def test_relative_path_rejected(self):
        self.data["runtime"]["path"]="llama-cli"
        with self.assertRaisesRegex(ValueError,"absolute"):
            self.check()
if __name__=="__main__":
    unittest.main()
