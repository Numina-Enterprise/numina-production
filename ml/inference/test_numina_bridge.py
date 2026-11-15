"""Tests for the real llama.cpp bridge boundary (mocked inference, not real generation)."""
import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("numina_bridge", Path(__file__).with_name("numina_bridge.py"))
import sys
sys.path.insert(0, str(Path(__file__).parent))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class BridgeTests(unittest.TestCase):
    def test_missing_runtime_configuration_fails_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "configure"):
                bridge.run({"prompt":"hello","max_tokens":16})
    def test_client_cannot_override_model_or_executable(self):
        with self.assertRaisesRegex(ValueError, "unsupported"):
            bridge.run({"prompt":"hello","max_tokens":16,"cli":"/tmp/untrusted"})
    def test_rejects_non_integer_token_limit(self):
        with self.assertRaisesRegex(ValueError, "token"):
            bridge.run({"prompt":"hello","max_tokens":True})
    def test_server_selected_runtime_and_digest_propagate(self):
        def fake_infer(cli,model,prompt,max_tokens):
            self.assertEqual(str(cli),"/trusted/llama-cli")
            self.assertEqual(str(model),"/trusted/model.gguf")
            self.assertEqual(max_tokens,16)
            return {"response":"generated fixture","model_sha256":"a"*64,"runtime":"llama.cpp-cli","elapsed_ms":1}
        with patch.dict(os.environ,{"NUMINA_LLAMA_CLI":"/trusted/llama-cli","NUMINA_GGUF_MODEL":"/trusted/model.gguf"}):
            result=bridge.run({"prompt":"hello","max_tokens":16},inference=fake_infer)
        self.assertEqual(result["text"],"generated fixture")
        self.assertEqual(result["model_sha256"],"a"*64)
    def test_empty_output_fails_closed(self):
        with patch.dict(os.environ,{"NUMINA_LLAMA_CLI":"/trusted/llama-cli","NUMINA_GGUF_MODEL":"/trusted/model.gguf"}):
            with self.assertRaisesRegex(RuntimeError, "no text"):
                bridge.run({"prompt":"hello","max_tokens":16},inference=lambda *a,**k:{"response":""})
if __name__=="__main__":
    unittest.main()
