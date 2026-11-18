#!/usr/bin/env python3
"""Fail-closed, reproducible local GGUF inference acceptance runner.

Operator supplies reviewed local binary, checkpoint, and published SHA-256.
No model download, production access, or synthetic PASS receipts.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from numina_local import infer, sha256_file
from provision_gguf import validate_gguf

def accept(cli, model, expected_model_sha256, output, prompt, *, max_tokens=64):
    cli, model, output = Path(cli).resolve(strict=True), Path(model).resolve(strict=True), Path(output)
    if not cli.is_file() or not model.is_file():
        raise ValueError("runtime and model must be files")
    if not isinstance(expected_model_sha256,str) or len(expected_model_sha256)!=64 or any(c not in "0123456789abcdef" for c in expected_model_sha256.lower()):
        raise ValueError("valid published checkpoint SHA-256 required")
    actual=sha256_file(model)
    if actual!=expected_model_sha256.lower():
        raise ValueError("checkpoint SHA-256 mismatch")
    header=validate_gguf(model)
    cli_digest=sha256_file(cli)
    result=infer(cli,model,prompt,max_tokens=max_tokens)
    if not result["response"].strip():
        raise RuntimeError("empty real model generation")
    receipt={
        "schema_id":"numina.gguf-real-inference-acceptance.v1",
        "status":"GENERATED_UNEVALUATED",
        "observed_at":datetime.now(timezone.utc).isoformat(),
        "model_sha256":actual,
        "runtime_sha256":cli_digest,
        "gguf_header":header,
        "prompt_sha256":hashlib.sha256(prompt.encode()).hexdigest(),
        "max_tokens":max_tokens,
        "elapsed_ms":result["elapsed_ms"],
        "response":result["response"],
        "evidence":"real_local_execution_not_quality_or_production_approval"
    }
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open("x",encoding="utf-8") as stream:
        json.dump(receipt,stream,indent=2)
        stream.write("\n")
    return receipt

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--cli",required=True)
    parser.add_argument("--model",required=True)
    parser.add_argument("--model-sha256",required=True)
    parser.add_argument("--output",required=True)
    parser.add_argument("--prompt",default="Explain why reproducible model evidence matters.")
    parser.add_argument("--max-tokens",type=int,default=64)
    args=parser.parse_args()
    receipt=accept(args.cli,args.model,args.model_sha256,args.output,args.prompt,max_tokens=args.max_tokens)
    print(json.dumps({"status":receipt["status"],"model_sha256":receipt["model_sha256"],"runtime_sha256":receipt["runtime_sha256"],"receipt_path":args.output}))

if __name__=="__main__":
    main()
