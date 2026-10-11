"""Read-only probes of the repository's real runtime canonicalizers.

This is a retained, unsigned successor observation, not companion acceptance.
It imports existing source and runs Node through stdin; it does not sign, read
private keys, change runtime behavior, or execute repository setup/build scripts.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

sys.dont_write_bytecode = True

EXPECTED_HEAD = "9b744f6354c4e1259c7e0c8626c6e67fc78fe5ac"
SOURCE_PATHS = [
    "public/runtime-release-model.js",
    "public/runtime-contract.js",
    "runtime/verifier-rc27/numina_prod/signing.py",
    "runtime/verifier-rc27/numina/canonical.py",
    "vendor/numina-core-v1.8/numina/canonical.py",
    "scripts/trusted-release-evidence.mjs",
    "config/numina-universal-pair-source-ids.json",
    "scripts/sync-universal-pair-source-ids.mjs",
    "public/final-manifest.json",
    "tests/runtime-rc27.test.mjs",
    "tests/trusted-release-evidence.test.mjs",
    "tests/runtime-revocation.test.mjs",
    "runtime/verifier-rc27/tests_prod/test_schema_contract.py",
]
SEARCH_ROOTS = [
    "src", "public", "scripts", "api", "config", "tests",
    "runtime/verifier-rc27/numina_prod",
    "runtime/verifier-rc27/numina",
    "runtime/verifier-rc27/tests_prod",
    "vendor/numina-core-v1.8/numina",
]
CASES = [
    {"id": "float_integral", "input_json": '{"x":1.0}'},
    {"id": "negative_zero", "input_json": '{"x":-0.0}'},
    {"id": "unicode_property_order", "input_json": r'{"\uE000":1,"\uD83D\uDE00":2}'},
    {"id": "unpaired_surrogate_value", "input_json": r'{"x":"\uD800"}'},
    {"id": "escaped_duplicate_member", "input_json": r'{"x":1,"\u0078":2}'},
]
NODE_PROBE = r"""
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const request = JSON.parse(readFileSync(0, 'utf8'));
const runtime = await import(pathToFileURL(request.module).href);
const results = request.cases.map(c => {
  try {
    const parsed = JSON.parse(c.input_json);
    const text = runtime.canonical(parsed);
    return {id:c.id, accepted:true, text, utf8_hex:Buffer.from(text,'utf8').toString('hex')};
  } catch (e) { return {id:c.id, accepted:false, error_type:e.name, error:e.message}; }
});
console.log(JSON.stringify({node_version:process.version, results,
  runtime_public_key:runtime.PINNED_RUNTIME_PUBLIC_KEY,
  runtime_key_id:runtime.PINNED_RUNTIME_KEY_ID}));
"""


def command(args, cwd=None):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def inspect(repo: Path):
    head = command(["git", "rev-parse", "HEAD"], cwd=repo)
    if head != EXPECTED_HEAD:
        raise RuntimeError(f"Inspected HEAD changed: expected {EXPECTED_HEAD}, observed {head}")
    status = command(["git", "status", "--porcelain=v1"], cwd=repo)
    before = {p: hashlib.sha256((repo / p).read_bytes()).hexdigest() for p in SOURCE_PATHS}
    spec = importlib.util.spec_from_file_location(
        "numina_canonicalization_probe_signing", repo / SOURCE_PATHS[2]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    python_results = []
    for case in CASES:
        try:
            # The existing runtime function accepts a parsed object. Using the
            # native parser here demonstrates that this boundary cannot recover
            # already-collapsed duplicate members; it is not an endpoint audit.
            data = module.canonical_bytes(json.loads(case["input_json"]))
            result = {"accepted": True, "text": data.decode("utf-8"), "utf8_hex": data.hex()}
        except Exception as error:
            result = {"accepted": False, "error_type": type(error).__name__, "error": str(error)}
        python_results.append({"id": case["id"], **result})
    node = subprocess.run(
        ["node", "--input-type=module", "-e", NODE_PROBE],
        input=json.dumps({"module": str(repo / SOURCE_PATHS[0]), "cases": CASES}),
        capture_output=True, text=True, check=True,
    )
    node_result = json.loads(node.stdout)
    observations = []
    for case, py, js in zip(CASES, python_results, node_result["results"], strict=True):
        if py["id"] != js["id"]:
            raise RuntimeError("Probe result ordering drift")
        observations.append({
            **case, "python_runtime": py, "browser_module_via_node": js,
            "same_acceptance": py["accepted"] == js["accepted"],
            "same_canonical_bytes": py.get("utf8_hex") == js.get("utf8_hex") if py["accepted"] and js["accepted"] else None,
        })
    for i in (0, 1, 2):
        if observations[i]["same_canonical_bytes"] is not False:
            raise RuntimeError("Previously observed byte mismatch did not reproduce")
    if observations[3]["python_runtime"]["accepted"] or not observations[3]["browser_module_via_node"]["accepted"]:
        raise RuntimeError("Previously observed surrogate acceptance mismatch did not reproduce")
    if not all(observations[4][side].get("text") == '{"x":2}' for side in ("python_runtime", "browser_module_via_node")):
        raise RuntimeError("Native-parser duplicate collapse did not reproduce")

    search_args = ["rg", "-n", "--glob", "*.{py,js,mjs,json,ts}",
                   r"numina\.pair-binding\.v1|NUMINA-PAIR-BINDING/V1|genesis_ref|previous_payload_sha256|signature_b64u|public_key_b64u",
                   *[str(repo / p) for p in SEARCH_ROOTS]]
    search = subprocess.run(search_args, capture_output=True, text=True)
    if search.returncode not in (0, 1):
        raise RuntimeError(search.stderr)
    after = {p: hashlib.sha256((repo / p).read_bytes()).hexdigest() for p in SOURCE_PATHS}
    if before != after or head != command(["git", "rev-parse", "HEAD"], cwd=repo):
        raise RuntimeError("Source changed during read-only observation")
    source_record = json.loads((repo / "config/numina-universal-pair-source-ids.json").read_bytes())
    projection = json.loads((repo / "public/final-manifest.json").read_bytes()).get("universalPair", {})
    import base64
    public = base64.b64decode(node_result["runtime_public_key"])
    return {
        "schema": "numina.implementation-conformance-review.v1",
        "observed_at_utc": datetime.now(timezone.utc).isoformat(),
        "status": "bounded_conformance_gaps_confirmed",
        "whole_protocol_correctness_established": False,
        "unsigned_successor_observation": True,
        "inspected_repository": str(repo), "inspected_head": head,
        "working_tree_clean": not bool(status), "working_tree_status": status,
        "source_inventory": [{"path": p, "bytes": (repo / p).stat().st_size, "sha256": before[p]} for p in SOURCE_PATHS],
        "source_bytes_unchanged_during_probe": True,
        "tools": {"python": sys.version, "node": node_result["node_version"]},
        "probe": {"path": str(Path(__file__).resolve()), "sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "cases": observations},
        "bounded_search": {
            "roots": [str(repo / p) for p in SEARCH_ROOTS],
            "command": search_args, "exit_code": search.returncode,
            "matches": search.stdout.splitlines(),
            "scope_limit": "Selected source/config/test roots and extensions only; no search of private stores, prior Git history, omitted binary artifacts or all external systems.",
        },
        "domain_distinctions": {
            "runtime_envelope": {"signed_members": ["artifact_type", "key_id", "payload"], "framing": "Runtime-specific recursive JSON sorting; no companion prefix", "key_id": node_result["runtime_key_id"], "raw_public_key_sha256": hashlib.sha256(public).hexdigest(), "encoding": "Standard padded base64; raw or accepted SPKI public-key form in browser verifier"},
            "proposed_companion": {"schema": "numina.pair-binding.v1", "envelope_members": ["payload", "signature_b64u"], "framing": "ASCII(NUMINA-PAIR-BINDING/V1) || 0x00 || UTF8(RFC8785_JCS(payload)); pure Ed25519", "key_id": "sha256: followed by full 64 lowercase hex digits of raw public key SHA-256", "encoding": "Canonical unpadded base64url; exactly 32-byte public key and 64-byte signature", "source_domain": "Two ordered frozen historical commitments, independently approved artifact/hash profiles and attribution; source order differs from personal display order", "candidate_profile_adoption": "NOT_ADOPTED in manuscript Appendix M"},
            "current_v4_projection": {"source_record": source_record, "observed_projection_schema": projection.get("schema"), "observed_projection_source_count": projection.get("sourceCount"), "observed_projection_source_ids": projection.get("sourceIds"), "comparison": "Current one-source universal-pair.v4 and historical two-source companion v1 are distinct reviewed subjects; neither correctness claim can be inferred from the other's name."},
        },
        "findings": [
            {"id": "CANONICAL_BYTES_DISAGREE", "status": "confirmed", "evidence_case_ids": ["float_integral", "negative_zero", "unicode_property_order"], "closure": "Use a versioned, conformance-tested canonicalizer for the selected protocol; require cross-language equality against RFC8785 vectors and adversarial Unicode/number fixtures. Do not rewrite historical signed bytes."},
            {"id": "INVALID_UNICODE_ACCEPTANCE_DIFFERS", "status": "confirmed", "evidence_case_ids": ["unpaired_surrogate_value"], "closure": "Reject invalid Unicode at the applicable decoded-string/name intake boundary and retain independently executed negative results."},
            {"id": "DUPLICATES_COLLAPSE_BEFORE_CANONICALIZER", "status": "confirmed_at_native_parser_probe_boundary", "evidence_case_ids": ["escaped_duplicate_member"], "closure": "For companion intake, detect duplicate member names after escape decoding before conversion to ordinary maps; endpoint behavior was not audited by this probe."},
            {"id": "COMPANION_IMPLEMENTATION_NOT_LOCATED", "status": "not_observed_in_bounded_search", "closure": "Identify exact accepted protocol version/source commit and locate or implement its strict byte intake, closed schema, size/depth/token/calendar/base64 rules and prefixed signature verifier, with normative-rule-to-code/test traceability."},
            {"id": "COMPANION_PROFILE_AND_ED25519_POLICY_ADOPTION", "status": "not_established", "closure": "Retain authenticated adoption of the exact profile and point/scalar/cofactor acceptance policy; run positive, tamper and adversarial vectors across pinned independent providers. Runtime delegation to WebCrypto/cryptography is a different observation."},
            {"id": "SCOPED_TRUST_CURRENT_STATE_AND_PRIVATE_MAPPING", "status": "not_established", "closure": "Retain independently authenticated key-role/project/release/source authorization, validity/revocation rules, accepted revision/predecessor/fork/replay evidence, original artifact/profile registry pins, and authorized opaque private-reference resolution receipt. A byte-valid operational delivery signature does not supply these facts."},
            {"id": "MODEL_IMPLEMENTATION_AND_OPERATIONAL_CLOSURE", "status": "not_established", "closure": "Tie exact implementation/artifacts to applicable proof assumptions and execute end-to-end accepted/rejected workflows, dependency failures and recovery under the adopted policy; retain matching release/runtime/current-state receipts. Generic conditional model theorems are bounded evidence."},
        ],
        "limitations": [
            "The counterexamples concern the unrestricted JSON domain of existing runtime canonicalization functions; previously verified restricted ASCII/integer runtime receipts remain valid.",
            "These probes are not complete schema-valid companion envelopes. A strictly enforced fixed-field/safe-integer profile could exclude several examples; that profile's parser/schema enforcement and restricted-domain correctness must be established separately.",
            "No operational private companion envelope or adopted policy was verified by this review.",
            "Current v4 projection consistency is observed metadata, not a whole-protocol correctness proof.",
            "All signed outputs and runtime behavior remain unchanged; no signing, deployment, key generation or private-key access was performed.",
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path("/workspace/numina-production"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = inspect(args.repo.resolve())
    rendered = json.dumps(report, indent=2, ensure_ascii=True) + "\n"
    if args.output:
        args.output.write_text(rendered)
    else:
        print(rendered, end="")
