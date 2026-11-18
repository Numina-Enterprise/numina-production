#!/usr/bin/env python3
"""Numina model/runtime lockfile verification; no unreviewed binary downloads.

A lockfile must contain operator-reviewed absolute local paths and published
SHA-256 values. Never promote this verification to a generation claim.
"""
import argparse
import json
import re
from pathlib import Path
from numina_local import sha256_file
from provision_gguf import validate_gguf

HEX = re.compile(r"^[0-9a-f]{64}$")

def verify_lock(path):
    path=Path(path).resolve(strict=True)
    lock=json.loads(path.read_text(encoding="utf-8"))
    if set(lock)!={"schema_id","model","runtime","license"} or lock["schema_id"]!="numina.inference-lock.v1":
        raise ValueError("invalid lockfile schema")
    license_data=lock["license"]
    if not isinstance(license_data,dict) or not all(isinstance(license_data.get(k),str) and license_data[k].strip() for k in ("spdx_id","source_url","reviewed_by")):
        raise ValueError("reviewed license metadata required")
    verified={}
    for name in ("model","runtime"):
        item=lock[name]
        if not isinstance(item,dict) or set(item)!={"path","sha256","source_url"}:
            raise ValueError("invalid "+name+" record")
        if not isinstance(item["sha256"],str) or not HEX.fullmatch(item["sha256"]):
            raise ValueError("invalid "+name+" SHA-256")
        if not isinstance(item["source_url"],str) or not item["source_url"].startswith("https://"):
            raise ValueError("HTTPS provenance required")
        local=Path(item["path"])
        if not local.is_absolute():
            raise ValueError("absolute "+name+" path required")
        local=local.resolve(strict=True)
        if not local.is_file() or sha256_file(local)!=item["sha256"]:
            raise ValueError(name+" SHA-256 mismatch")
        verified[name]={"path":str(local),"sha256":item["sha256"]}
    verified["gguf_header"]=validate_gguf(verified["model"]["path"])
    verified["license"]=license_data
    verified["status"]="INTEGRITY_VERIFIED_NOT_EXECUTED"
    return verified

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--lock",required=True)
    args=p.parse_args()
    print(json.dumps(verify_lock(args.lock),indent=2))

if __name__=="__main__":
    main()
