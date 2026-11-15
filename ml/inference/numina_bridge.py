#!/usr/bin/env python3
"""Strict JSON-stdin bridge to the existing Numina llama.cpp adapter.

Only trusted server-side code should launch this process. Never expose it as
an unauthenticated endpoint or allow clients to choose executable/model paths.
"""
import json
import os
import sys
from pathlib import Path
from numina_local import infer

def run(payload, inference=infer):
    if not isinstance(payload, dict) or set(payload) != {"prompt", "max_tokens"}:
        raise ValueError("unsupported bridge input")
    if not isinstance(payload["prompt"], str) or not payload["prompt"].strip():
        raise ValueError("prompt required")
    tokens = payload["max_tokens"]
    if type(tokens) is not int or not 1 <= tokens <= 1024:
        raise ValueError("invalid token bound")
    cli = os.environ.get("NUMINA_LLAMA_CLI")
    model = os.environ.get("NUMINA_GGUF_MODEL")
    if not cli or not model:
        raise RuntimeError("operator must configure CLI and GGUF paths")
    result = inference(Path(cli), Path(model), payload["prompt"], max_tokens=tokens)
    if not result.get("response", "").strip():
        raise RuntimeError("model produced no text")
    return {"text": result["response"], "model_sha256": result["model_sha256"],
            "runtime": result["runtime"], "elapsed_ms": result["elapsed_ms"]}

def main():
    try:
        if len(sys.argv) != 1:
            raise ValueError("no CLI arguments accepted")
        data = sys.stdin.read(65537)
        if len(data) > 65536:
            raise ValueError("request too large")
        output = run(json.loads(data))
        print(json.dumps(output))
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
