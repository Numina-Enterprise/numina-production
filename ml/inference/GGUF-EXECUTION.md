# Numina GGUF checkpoint and real inference

Status: PROVISIONING IMPLEMENTED; NO MODEL WEIGHTS OR REAL GENERATION RECEIPT YET.

1. Select a GGUF checkpoint with a verified redistribution/use license and published immutable SHA-256. Confirm it fits the available RAM/VRAM and llama.cpp architecture support.
2. Provision the exact checkpoint without committing model weights:

```bash
python3 ml/inference/provision_gguf.py --url 'https://approved.example/model.gguf' --sha256 '<64-character-published-digest>' --output ml/models/local/model.gguf
```

The URL and digest above are placeholders, not a valid model source. HTTPS redirects, missing digests, mismatched hashes and invalid GGUF headers are rejected. Provision receipt proves file integrity only.

3. Install a reviewed compatible llama.cpp binary separately and execute:

```bash
python3 ml/inference/numina_local.py --cli /absolute/path/to/llama-cli --model ml/models/local/model.gguf --prompt 'Explain why independent evidence matters.' --output ml/models/local/inference-receipt.json
```

4. Preserve binary version/digest, model license, checkpoint digest, invocation, stdout and timing as evidence. Run evaluation suite against actual generated outputs before any quality or production claim.

CI deliberately tests parser/provisioner and subprocess adapter without downloading unreviewed weights or executing untrusted model binaries. No model weights are bundled. Production, signing, release and treasury are unchanged.
