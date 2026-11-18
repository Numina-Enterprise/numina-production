# Numina 5: actual model/runtime acceptance

The source tree now includes integrity verification, provisioning, execution,
and receipt creation. **No GGUF model weights or llama.cpp binary are checked
into Git.** Fixture tests are not evidence of real generation.

1. Select a legally usable GGUF checkpoint. Record its immutable artifact URL,
   published SHA-256, exact license, and human license review.
2. Build or obtain a reviewed compatible llama.cpp `llama-cli` executable.
   Record the source/release URL and SHA-256 of the exact executable.
3. Store both files outside Git and write a local lockfile with the schema below.
   Use real absolute paths and actual hashes; placeholder values will fail.
4. Run `python3 ml/inference/verify_inference_lock.py --lock /absolute/path/numina-lock.json`.
5. Run `python3 ml/inference/accept_real_gguf.py --cli /absolute/path/llama-cli --model /absolute/path/model.gguf --model-sha256 <published-checkpoint-sha256> --output /absolute/path/real-inference-receipt.json`.
6. Preserve the generated receipt and compare multiple prompts/runs in the
   benchmark harness. Require independent review of actual quality and security
   before any release promotion.

Example **schema only**, not an approved artifact:
```json
{
  "schema_id": "numina.inference-lock.v1",
  "model": {"path": "/absolute/path/model.gguf", "sha256": "<64 hex digits>", "source_url": "https://example.org/model"},
  "runtime": {"path": "/absolute/path/llama-cli", "sha256": "<64 hex digits>", "source_url": "https://example.org/runtime"},
  "license": {"spdx_id": "<reviewed SPDX ID>", "source_url": "https://example.org/license", "reviewed_by": "<reviewer>"}
}
```

The lock verifier checks local artifact integrity and GGUF header; it does not
verify the legal accuracy of supplied license metadata or runtime authenticity
independently. Acceptance receipt status `GENERATED_UNEVALUATED` means
execution only, not benchmark quality, production safety, or release approval.
No automatic deployment, merge, signing, or treasury actions.
