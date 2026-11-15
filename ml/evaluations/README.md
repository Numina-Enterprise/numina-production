# Numina Model Foundry — offline evaluation slice

This is a local scoring harness, not an inference engine. It scores externally supplied string responses against a frozen case file using exact matching. It does not claim that any model produced the responses.

Example (non-production):

```bash
python3 -m unittest discover -s ml/evaluations -p 'test_numina5_*.py' -v
python3 ml/evaluations/numina5_benchmark.py --cases cases.json --responses responses.json --candidate-id N5-CAND-B --checkpoint-digest sha256:REPLACE_WITH_REAL_DIGEST --output report.json
```

Inputs: cases JSON array of objects with unique `id` and string `expected`; responses JSON object mapping IDs to strings. Missing response = NOT_RUN. Score denominator includes all cases; partial execution = INCONCLUSIVE.

A fixture PASS is not model admission. Before admission require verified checkpoint hashes, licenses, provenance, independently collected model outputs, held-out tasks, security evaluation, latency, cost and review approvals. No production or treasury access is granted by these scripts.
