#!/usr/bin/env python3
"""Copy a locally saved IBM Quantum API key into GitHub Actions without printing it.

Requirements:
- qiskit-ibm-runtime installed and an IBM Quantum account already saved locally
- GitHub CLI (`gh`) authenticated for the target repository

The API key is passed to `gh secret set` over stdin, never as a command-line argument.
The IBM instance/CRN is optional on the modern ibm_quantum_platform channel.
"""

from __future__ import annotations

import argparse
import subprocess
from qiskit_ibm_runtime import QiskitRuntimeService


def run(cmd: list[str], *, stdin: str | None = None) -> None:
    subprocess.run(cmd, input=stdin, text=True, check=True)


def choose_account() -> dict:
    accounts = QiskitRuntimeService.saved_accounts(channel="ibm_quantum_platform")
    if not accounts:
        accounts = QiskitRuntimeService.saved_accounts()
    if not accounts:
        raise SystemExit("No saved IBM Quantum account found on this machine.")

    for account in accounts.values():
        if account.get("token") and account.get("is_default_account"):
            return account
    for account in accounts.values():
        if account.get("token"):
            return account
    raise SystemExit("Saved IBM Quantum account exists but has no usable token.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default="skott34-dot/numina-production")
    parser.add_argument("--dispatch", action="store_true")
    parser.add_argument("--shots", type=int, default=256)
    args = parser.parse_args()

    run(["gh", "auth", "status"])
    account = choose_account()
    token = account["token"]
    instance = (account.get("instance") or "").strip()

    run(["gh", "secret", "set", "IBM_QUANTUM_API_KEY", "--repo", args.repo], stdin=token)
    print("Configured GitHub secret IBM_QUANTUM_API_KEY from the saved local IBM account.")

    if instance:
        run(["gh", "secret", "set", "IBM_QUANTUM_INSTANCE", "--repo", args.repo], stdin=instance)
        print("Configured optional GitHub secret IBM_QUANTUM_INSTANCE.")
    else:
        print("No saved instance/CRN found; continuing without it (supported by ibm_quantum_platform).")

    if args.dispatch:
        run([
            "gh", "workflow", "run", "ibm-quantum-hardware.yml",
            "--repo", args.repo,
            "-f", f"shots={args.shots}",
        ])
        print("Dispatched IBM Quantum hardware validation workflow.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
