#!/usr/bin/env python3
"""Numina local inference adapter for an operator-provided llama.cpp CLI + GGUF weights.

No download, shell, remote API, credentials or deployment. Actual generation occurs
only when the caller supplies an installed binary and local model path.
"""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def infer(cli, model, prompt, max_tokens=128, timeout=120, runner=subprocess.run):
    cli, model = Path(cli).resolve(strict=True), Path(model).resolve(strict=True)
    if not cli.is_file() or not model.is_file():
        raise ValueError("CLI and model must be regular files")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 16000:
        raise ValueError("prompt must contain 1-16000 characters")
    if not 1 <= max_tokens <= 1024 or not 1 <= timeout <= 600:
        raise ValueError("generation bounds exceeded")
    model_digest = sha256_file(model)
    command = [str(cli), "-m", str(model), "-p", prompt, "-n", str(max_tokens),
               "--temp", "0", "--no-display-prompt"]
    start = time.monotonic()
    proc = runner(command, capture_output=True, text=True, timeout=timeout, check=False)
    if proc.returncode != 0:
        raise RuntimeError("local inference failed (exit " + str(proc.returncode) + ")")
    return {"schema_id": "numina.local-inference.v1",
            "runtime": "llama.cpp-cli",
            "model_sha256": model_digest,
            "response": proc.stdout,
            "elapsed_ms": round((time.monotonic()-start)*1000),
            "evidence": "locally_executed_unverified_model_quality"}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--cli", required=True, help="Path to local llama-cli executable")
    p.add_argument("--model", required=True, help="Path to operator-provided GGUF file")
    p.add_argument("--prompt", required=True)
    p.add_argument("--max-tokens", type=int, default=128)
    p.add_argument("--timeout", type=int, default=120)
    p.add_argument("--output", required=True)
    a = p.parse_args()
    result = infer(a.cli, a.model, a.prompt, a.max_tokens, a.timeout)
    Path(a.output).write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")
    print("Local inference completed; report written.")

if __name__ == "__main__":
    main()
