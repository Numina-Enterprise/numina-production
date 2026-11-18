#!/usr/bin/env python3
"""Deterministic, offline Numina 5 benchmark harness. No model execution is implied."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

def evaluate(cases, responses, candidate_id, checkpoint_digest):
    if not candidate_id or not checkpoint_digest:
        raise ValueError("candidate_id and checkpoint_digest are required")
    if not isinstance(cases, list) or not cases:
        raise ValueError("nonempty cases list required")
    if not isinstance(responses, dict):
        raise ValueError("responses must be an object keyed by case ID")
    ids = [c["id"] for c in cases]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate case ID")
    results = []
    for c in cases:
        case_id = c["id"]
        expected = c["expected"]
        observed = responses.get(case_id)
        if not isinstance(expected, str):
            raise ValueError("expected must be string")
        status = "NOT_RUN" if observed is None else ("PASS" if isinstance(observed, str) and observed == expected else "FAIL")
        results.append({"id": case_id, "status": status})
    passed = sum(r["status"] == "PASS" for r in results)
    attempted = sum(r["status"] != "NOT_RUN" for r in results)
    return {
        "schema_id": "numina.model-evaluation.v1",
        "candidate_id": candidate_id,
        "checkpoint_digest": checkpoint_digest,
        "dataset_sha256": hashlib.sha256(json.dumps(cases, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
        "scoring": "exact_match_v1",
        "total": len(results),
        "attempted": attempted,
        "passed": passed,
        "score": passed / len(results),
        "disposition": "INCONCLUSIVE" if attempted < len(results) else ("PASS" if passed == len(results) else "FAIL"),
        "results": results,
        "note": "Offline fixture scoring only. No inference, model provenance, safety, or production admission verified."
    }

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--cases", required=True)
    p.add_argument("--responses", required=True)
    p.add_argument("--candidate-id", required=True)
    p.add_argument("--checkpoint-digest", required=True)
    p.add_argument("--output", required=True)
    a = p.parse_args()
    cases = json.loads(Path(a.cases).read_text(encoding="utf-8"))
    responses = json.loads(Path(a.responses).read_text(encoding="utf-8"))
    report = evaluate(cases, responses, a.candidate_id, a.checkpoint_digest)
    report["generated_at"] = datetime.now(timezone.utc).isoformat()
    Path(a.output).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(report["disposition"], report["passed"], "/", report["total"])

if __name__ == "__main__":
    main()
