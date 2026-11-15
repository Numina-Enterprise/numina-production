import tempfile
import unittest
from pathlib import Path
from provision_gguf import provision, validate_gguf

class ProvisionTests(unittest.TestCase):
    def test_reject_http(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError, "HTTPS"):
                provision("http://example.com/model.gguf", "a"*64, Path(d)/"model.gguf")
    def test_reject_missing_hash(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                provision("https://example.com/model.gguf", "bad", Path(d)/"model.gguf")
    def test_reject_fake_gguf(self):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/"fake.gguf"
            f.write_bytes(b"not-a-gguf")
            with self.assertRaisesRegex(ValueError, "GGUF"):
                validate_gguf(f)
    def test_reject_empty_tensor_table(self):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/"fake.gguf"
            f.write_bytes(b"GGUF"+(3).to_bytes(4,"little")+(0).to_bytes(8,"little")+(1).to_bytes(8,"little"))
            with self.assertRaisesRegex(ValueError, "header"):
                validate_gguf(f)

if __name__ == "__main__":
    unittest.main()
