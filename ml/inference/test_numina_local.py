import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from numina_local import infer

class LocalInferenceTests(unittest.TestCase):
    def test_invokes_local_binary_without_shell(self):
        with tempfile.TemporaryDirectory() as d:
            cli = Path(d)/"llama-cli"
            model = Path(d)/"model.gguf"
            cli.write_bytes(b"fixture binary")
            model.write_bytes(b"fixture weights")
            calls = []
            def runner(args, **kwargs):
                calls.append((args, kwargs))
                return SimpleNamespace(returncode=0, stdout="generated", stderr="")
            result = infer(cli, model, "Hello", runner=runner)
            self.assertEqual(result["response"], "generated")
            self.assertEqual(len(result["model_sha256"]), 64)
            self.assertFalse(calls[0][1].get("shell", False))
    def test_rejects_missing_weights(self):
        with tempfile.TemporaryDirectory() as d:
            cli = Path(d)/"llama-cli"
            cli.write_bytes(b"fixture")
            with self.assertRaises(FileNotFoundError):
                infer(cli, Path(d)/"missing.gguf", "Hello")
    def test_rejects_empty_prompt(self):
        with tempfile.TemporaryDirectory() as d:
            cli = Path(d)/"llama-cli"
            model = Path(d)/"model.gguf"
            cli.write_bytes(b"fixture")
            model.write_bytes(b"fixture")
            with self.assertRaises(ValueError):
                infer(cli, model, "")
if __name__ == "__main__":
    unittest.main()
