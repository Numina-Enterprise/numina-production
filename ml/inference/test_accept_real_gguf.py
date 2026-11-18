"""Acceptance-runner unit tests: mocked generation, never real-model evidence."""
import hashlib
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from accept_real_gguf import accept

class AcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name)
        self.cli=root/"llama-cli"
        self.cli.write_bytes(b"reviewed-runtime-fixture")
        self.model=root/"model.gguf"
        self.model.write_bytes(b"GGUF"+struct.pack("<IQQ",3,1,1)+b"fixture")
        self.digest=hashlib.sha256(self.model.read_bytes()).hexdigest()
        self.out=root/"receipt.json"
    def generate(self,*args,**kwargs):
        return {"response":"fixture output","elapsed_ms":12}
    def test_receipt_contains_digests_and_is_not_production_approval(self):
        with patch("accept_real_gguf.infer",side_effect=self.generate) as fake:
            receipt=accept(self.cli,self.model,self.digest,self.out,"hello")
        self.assertEqual(receipt["status"],"GENERATED_UNEVALUATED")
        self.assertEqual(receipt["model_sha256"],self.digest)
        self.assertEqual(receipt["runtime_sha256"],hashlib.sha256(self.cli.read_bytes()).hexdigest())
        self.assertEqual(json.loads(self.out.read_text())["response"],"fixture output")
        fake.assert_called_once()
    def test_bad_digest_never_invokes_runtime(self):
        with patch("accept_real_gguf.infer",side_effect=AssertionError("must not run")):
            with self.assertRaisesRegex(ValueError,"mismatch"):
                accept(self.cli,self.model,"0"*64,self.out,"hello")
        self.assertFalse(self.out.exists())
    def test_invalid_gguf_never_invokes_runtime(self):
        self.model.write_bytes(b"not gguf")
        digest=hashlib.sha256(self.model.read_bytes()).hexdigest()
        with patch("accept_real_gguf.infer",side_effect=AssertionError("must not run")):
            with self.assertRaisesRegex(ValueError,"GGUF"):
                accept(self.cli,self.model,digest,self.out,"hello")
    def test_empty_generation_creates_no_receipt(self):
        with patch("accept_real_gguf.infer",return_value={"response":"  ","elapsed_ms":1}):
            with self.assertRaisesRegex(RuntimeError,"empty"):
                accept(self.cli,self.model,self.digest,self.out,"hello")
        self.assertFalse(self.out.exists())
    def test_duplicate_receipt_is_not_overwritten(self):
        self.out.write_text("original")
        with patch("accept_real_gguf.infer",side_effect=self.generate):
            with self.assertRaises(FileExistsError):
                accept(self.cli,self.model,self.digest,self.out,"hello")
        self.assertEqual(self.out.read_text(),"original")
    def test_missing_runtime_fails_closed(self):
        with self.assertRaises(FileNotFoundError):
            accept(self.cli.parent/"missing",self.model,self.digest,self.out,"hello")

if __name__=="__main__":
    unittest.main()
