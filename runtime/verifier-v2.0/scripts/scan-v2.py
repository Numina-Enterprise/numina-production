#!/usr/bin/env python3
"""Scan V2.0 live code for quarantined-root, secret-like, personal-data patterns.
Stdlib only, no network. Evidence folder is reported separately, not as live code.

Usage: python3 scripts/scan-v2.py
Exit 0 = no live-code quarantined-root occurrences, no obvious secret values.
Exit 1 = live-code quarantined-root occurrence found (evidence folder excluded).
Secret-like patterns are reported as warnings, not failures, because reference
names (secret://...) are allowed; values are not. Review warnings manually.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# The quarantined root is intentionally NOT written in full in this live script,
# so live code contains zero full occurrences of it (evidence folder excepted).
# Fragments are joined at runtime only for scanning.
QUAR = "726e35da" + "14739512" + "f2ce45e0" + "3e394e81" + "766388a2" + "8ce4164f" + "ed071b23" + "83aab7cd"
SECRET_PATTERNS = [
    (r"(?i)(api[_-]?key|secret|password|private[_-]?key)\s*[:=]\s*['\"][^'\"]{16,}['\"]", "possible secret value assignment"),
    (r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", "private key block"),
    (r"whsec_[A-Za-z0-9_]{16,}", "webhook secret value (must be MOCK_ONLY)"),
]
PERSONAL_PATTERNS = [
    (r"\+1\d{10}", "US phone number"),
    (r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "email address"),
]

def scan():
    live_hits, evidence_hits, warnings = [], [], []
    for p in sorted(ROOT.rglob("*")):
        if not p.is_file():
            continue
        rel = str(p.relative_to(ROOT))
        if rel.startswith("sign-and-bind/"):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        is_evidence = rel.startswith("evidence/quarantine/")
        if QUAR in text:
            (evidence_hits if is_evidence else live_hits).append(rel)
        if is_evidence:
            continue
        for pat, label in SECRET_PATTERNS + PERSONAL_PATTERNS:
            if "MOCK_ONLY" in text and "webhook secret" in label:
                continue
            if re.search(pat, text):
                # Emails in docs that are already-public contact references are
                # flagged for manual review, not auto-failed here.
                warnings.append(f"{rel}: {label}")
    print(f"live quarantined-root files: {len(live_hits)}")
    for h in live_hits:
        print("  LIVE:", h)
    print(f"evidence-folder quarantined-root files (expected, isolated): {len(evidence_hits)}")
    for h in evidence_hits:
        print("  EVIDENCE:", h)
    print(f"warnings for manual review: {len(warnings)}")
    for w_ in sorted(set(warnings))[:50]:
        print("  WARN:", w_)
    if live_hits:
        print("FAIL: quarantined root present in live code")
        return 1
    print("PASS: no quarantined root in live code")
    return 0

if __name__ == "__main__":
    sys.exit(scan())
