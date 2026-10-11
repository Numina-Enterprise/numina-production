The inspected Numina tree does not establish whole-protocol correctness. This is an unsigned successor observation of clean commit `9b744f6354c4e1259c7e0c8626c6e67fc78fe5ac`; it changes neither signed evidence nor runtime behavior.

The [retained JSON report](/workspace/scratch/numina-whole-protocol/implementation-conformance-review.json) pins 13 relevant source files by byte count and SHA-256, records 10 actual source/config/test search roots, and retains locally executed probe inputs, output bytes and tool versions. The bounded search found no companion schema, framing or private-reference field markers. This finding does not cover private stores, omitted artifacts, prior Git history or every external system.

The [executable probe](/workspace/scratch/numina-whole-protocol/probe-runtime-canonicalization.py) imports the existing Python canonicalizer and browser module, rather than reproducing either implementation. It confirms:

- Python emits `1.0` and `-0.0`; the browser module emits `1` and `0`.
- The two implementations order supplementary-plane and BMP property names differently.
- The browser module accepts a lone surrogate that Python cannot encode as UTF-8.
- Native parsers collapse `x` and escaped `\u0078` before canonicalization. This is a parser-boundary observation, not an endpoint audit.

These examples prevent treating unrestricted runtime JSON canonicalization as established RFC 8785/I-JSON conformance. Previously verified restricted ASCII/integer runtime receipts remain valid.

The probe inputs are not complete schema-valid companion envelopes. A strict fixed-field/safe-integer profile could exclude several examples; its actual intake enforcement and restricted-domain correctness still require separate evidence.

The runtime signs `{artifact_type,key_id,payload}` with a 24-hex key ID. The proposed companion uses its domain prefix, a NUL separator, JCS payload bytes and a full `sha256:` fingerprint. Current `universal-pair.v4` exposes one source and a `1x2` projection; the manuscript's companion proposal retains two ordered historical commitments. Their acceptance claims require distinct normative contracts.

Closure requires the selected protocol's exact implementation and adopted profile; strict intake/schema and independent canonicalization/Ed25519 vectors; authenticated key scope, validity and revocation; accepted revision and predecessor/fork/replay evidence; immutable artifact/profile pins; authorized private-reference resolution; and end-to-end implementation/runtime evidence that discharges the model's assumptions. Valid delivery signatures supply byte integrity, not these missing facts.

Reproduce the retained counterexamples without writing an output file:

```sh
python /workspace/scratch/numina-whole-protocol/probe-runtime-canonicalization.py
```

The probe rejects a changed repository HEAD and disables Python bytecode writes. Its optional `--output` argument writes only the requested successor report.
