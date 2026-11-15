#!/usr/bin/env python3
"""Numina 5 candidate registry admission guard. No network or production access."""
import argparse
import json
from pathlib import Path

ALLOWED = {"HOLD", "NOT_RUN", "INCONCLUSIVE", "FAIL", "PASS"}
def validate(data):
    errors = []
    if data.get("schema_id") != "numina.model-candidates.v1": errors.append("schema mismatch")
    if data.get("canonical_identity") != "NUMINA": errors.append("canonical identity mismatch")
    for flag in ("production_change_authorized", "treasury_change_authorized"):
        if data.get(flag) is not False: errors.append(f"{flag} must be false")
    candidates = data.get("candidates")
    if not isinstance(candidates, list) or len(candidates) < 4:
        return errors + ["at least four candidate lanes required"]
    ids = [c.get("id") for c in candidates if isinstance(c, dict)]
    if len(ids) != len(candidates) or any(not isinstance(i, str) or not i for i in ids) or len(ids) != len(set(ids)):
        errors.append("candidate IDs must be unique nonempty strings")
    for c in candidates:
        if not isinstance(c, dict): errors.append("candidate must be an object"); continue
        if c.get("admission") not in ALLOWED: errors.append(f"invalid admission state: {c.get('id')}")
        if c.get("admission") == "PASS":
            if not all(c.get(k) for k in ("weights_digest", "license", "checkpoint_label", "evaluation_evidence")):
                errors.append(f"PASS lacks required evidence: {c.get('id')}")
    a = next((c for c in candidates if isinstance(c, dict) and c.get("id") == "N5-CAND-A"), None)
    if not a or a.get("checkpoint_label") != "Numina 5" or a.get("category") != "Other":
        errors.append("Candidate A identity mismatch")
    elif (a.get("submitted_score") != 100 or a.get("submitted_score_type") != "provisional_self_assessment"
          or a.get("verified_score") is not None or a.get("admission") != "HOLD"):
        errors.append("Candidate A provisional evidence boundary violated")
    return errors

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("registry", nargs="?", default="ml/model-registry/numina-5-candidates.json")
    args = parser.parse_args()
    errors = validate(json.loads(Path(args.registry).read_text(encoding="utf-8")))
    if errors:
        for error in errors: print("FAIL:", error)
        raise SystemExit(1)
    print("PASS: Numina 5 registry structure and evidence boundaries")

if __name__ == "__main__":
    main()
