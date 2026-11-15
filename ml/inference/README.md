# Numina local GGUF inference adapter

This is a real local execution path to a separately installed `llama-cli` (llama.cpp) executable and operator-supplied GGUF weights. It does not bundle, download, select, or license model weights. No hosted inference is contacted. It is not a production API.

```bash
python3 ml/inference/numina_local.py --cli /absolute/path/to/llama-cli --model /absolute/path/to/model.gguf --prompt "Explain the result." --output local-result.json
python3 -m unittest discover -s ml/inference -p 'test_*.py' -v
```

The adapter hashes the full model file and records local stdout. An installed compatible binary and licensed weights are required to perform real generation. Tests use an injected subprocess stand-in and **do not establish a real model inference run**. Evaluate licensing, prompt privacy, tokenizer, checkpoint identity, quality, and resource budgets before use. Keep production, treasury, access and release authority locked.
