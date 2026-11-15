#!/usr/bin/env python3
"""Run locked, locally verified GGUF inference; never deploy or promote."""
import argparse
import json
from pathlib import Path
from verify_inference_lock import verify_lock
from accept_real_gguf import accept

def run_locked(lock_path, output, prompt, max_tokens=64):
    verified=verify_lock(lock_path)
    receipt=accept(
        verified["runtime"]["path"], verified["model"]["path"],
        verified["model"]["sha256"], output, prompt, max_tokens=max_tokens
    )
    if receipt["runtime_sha256"]!=verified["runtime"]["sha256"]:
        Path(output).unlink(missing_ok=True)
        raise RuntimeError("runtime changed during inference")
    return {"status":"GENERATED_UNEVALUATED","receipt_path":str(output),
            "model_sha256":receipt["model_sha256"],
            "runtime_sha256":receipt["runtime_sha256"]}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--lock",required=True)
    parser.add_argument("--output",required=True)
    parser.add_argument("--prompt",default="Explain why reproducible model evidence matters.")
    parser.add_argument("--max-tokens",type=int,default=64)
    args=parser.parse_args()
    print(json.dumps(run_locked(args.lock,args.output,args.prompt,args.max_tokens)))

if __name__=="__main__":
    main()
