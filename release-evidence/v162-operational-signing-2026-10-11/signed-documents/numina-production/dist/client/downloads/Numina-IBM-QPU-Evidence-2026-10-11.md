# Retained IBM Quantum evidence

The Numina tree retains a completed IBM Quantum job observation for **`ibm_kingston`**, job **`dakfqqvi3e6s738rfnqg`**, with **1,024 reported shots**. The counts are `00=325`, `01=106`, `10=143`, and `11=450`, totaling 1,024. This identifies the earlier result precisely. It does not identify a Nighthawk execution.

The original [provider-UI observation](../release-evidence/quantum-job-observation-2026-09-18.json) has SHA-256 `0c1a46e06c89e72279a7468dd04813241948905658906189eb6b7e64502b4432`. It records an authenticated browser read on 18 September 2026 at 20:53:28 UTC. IBM's displayed job creation and completion times were 15 September 2026, 03:10 and 03:11, with the display timezone explicitly unverified. Reported completion duration was 1 minute 39 seconds and usage was 2 seconds. The retained record remains unchanged.

This is a dated provider-UI observation, not a signed provider receipt or an independent hardware audit. No fresh provider result, Nighthawk allocation, or hardware upgrade is established by this review. No provider credential was read, authentication performed, or new job submitted.

The canonical application's [measurement backend](../src/quantum-backend.js) is `numina-statevector`, a classical simulator. Its measurement route reports `hardwareExecution=false`. The separate [IBM connection module](../src/ibm-quantum.js) supports owner-authorized credential exchange and backend catalog discovery; it reports `jobSubmissionEnabled=false`. Access to an online backend would establish catalog access, while a circuit execution requires its own matching provider job and result.

The retained hardware workflow's source selects the least busy operational hardware through Qiskit. Its 256-shot default and trigger establish workflow configuration, not a completed job, and do not pin Nighthawk. A future Nighthawk claim requires the exact allocated backend name and a matching result with job identity, shots, counts, and observation time. This review performs no such submission and changes no treasury state.

The [bounded machine-readable readback](../config/numina-ibm-qpu-observation.v1.json) records these identities and limits. It is an unsigned source review, separate from the retained provider observation and completed Ed25519 document packages.
