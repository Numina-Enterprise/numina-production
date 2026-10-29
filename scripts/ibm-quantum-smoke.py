#!/usr/bin/env python3
"""Minimal Numina IBM Quantum validation workload.

Local simulation is the default. Real IBM Quantum hardware is used only when
--submit is explicitly supplied and QiskitRuntimeService credentials are
already configured on the machine.

Recommended versions (IBM docs, September 2026):
  qiskit[all]~=2.5.2
  qiskit-ibm-runtime~=0.47.0
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler


def bell_circuit() -> QuantumCircuit:
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    qc.measure_all()
    return qc


def emit(receipt: dict, path: str | None) -> None:
    payload = json.dumps(receipt, indent=2, sort_keys=True)
    print(payload)
    if path:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(payload + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--submit", action="store_true", help="Submit to a real IBM QPU")
    parser.add_argument("--wait", action="store_true", help="Wait for the hardware result")
    parser.add_argument("--shots", type=int, default=256)
    parser.add_argument("--receipt", help="Optional JSON receipt path")
    args = parser.parse_args()

    qc = bell_circuit()
    now = datetime.now(timezone.utc).isoformat()

    if not args.submit:
        sampler = StatevectorSampler(seed=42)
        result = sampler.run([qc], shots=args.shots).result()[0]
        emit({
            "schema": "numina.ibm-quantum-smoke.v1",
            "mode": "local-simulation",
            "submitted_at": now,
            "shots": args.shots,
            "counts": result.data.meas.get_counts(),
            "external_qpu_execution": False,
        }, args.receipt)
        return 0

    from qiskit.transpiler import generate_preset_pass_manager
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2 as Sampler

    service = QiskitRuntimeService()
    backend = service.least_busy(operational=True, simulator=False)
    pm = generate_preset_pass_manager(backend=backend, optimization_level=1)
    isa_qc = pm.run(qc)
    job = Sampler(mode=backend).run([isa_qc], shots=args.shots)

    receipt = {
        "schema": "numina.ibm-quantum-smoke.v1",
        "mode": "ibm-quantum-hardware",
        "submitted_at": now,
        "backend": backend.name,
        "job_id": job.job_id(),
        "shots": args.shots,
        "external_qpu_execution": True,
        "status_at_receipt": str(job.status()),
    }

    if args.wait:
        result = job.result()[0]
        receipt["completed_at"] = datetime.now(timezone.utc).isoformat()
        receipt["final_status"] = str(job.status())
        receipt["counts"] = result.data.meas.get_counts()

    emit(receipt, args.receipt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
