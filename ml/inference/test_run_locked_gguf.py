"""Lock-to-inference integration tests use mocks; never count as model generation."""
import unittest
from unittest.mock import patch
from run_locked_gguf import run_locked

VERIFIED={"runtime":{"path":"/trusted/llama-cli","sha256":"a"*64},
          "model":{"path":"/trusted/model.gguf","sha256":"b"*64}}
class LockedRunnerTests(unittest.TestCase):
    @patch("run_locked_gguf.accept")
    @patch("run_locked_gguf.verify_lock",return_value=VERIFIED)
    def test_verified_lock_drives_inference(self,verify,accept):
        accept.return_value={"runtime_sha256":"a"*64,"model_sha256":"b"*64}
        result=run_locked("/lock.json","/receipt.json","hello",32)
        accept.assert_called_once_with("/trusted/llama-cli","/trusted/model.gguf","b"*64,"/receipt.json","hello",max_tokens=32)
        self.assertEqual(result["status"],"GENERATED_UNEVALUATED")
    @patch("run_locked_gguf.accept")
    @patch("run_locked_gguf.verify_lock",side_effect=ValueError("bad model"))
    def test_bad_lock_blocks_execution(self,verify,accept):
        with self.assertRaisesRegex(ValueError,"bad model"):
            run_locked("/lock.json","/receipt.json","hello")
        accept.assert_not_called()
    @patch("run_locked_gguf.Path")
    @patch("run_locked_gguf.accept",return_value={"runtime_sha256":"c"*64,"model_sha256":"b"*64})
    @patch("run_locked_gguf.verify_lock",return_value=VERIFIED)
    def test_runtime_changed_blocks_receipt(self,verify,accept,path):
        with self.assertRaisesRegex(RuntimeError,"runtime changed"):
            run_locked("/lock.json","/receipt.json","hello")
        path.assert_called_once_with("/receipt.json")
        path.return_value.unlink.assert_called_once_with(missing_ok=True)
if __name__=="__main__":
    unittest.main()
