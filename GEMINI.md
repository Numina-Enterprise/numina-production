# Universal Agent Operational Contract & Governance Specification (GEMINI Delivery)
Document Identifier: PROOF-NUMINA-SEC-V1
Security Classification: Strict Zero-Trust / Production Locked
Governing Authority: Samuel J. Kott (skott34-ed25519)
Operator: SK Consulting LLC | Canonical Origin: https://www.numinalabs.xyz
Cluster State Root: 726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd
Production Cloud Scope: project-0317d6c9-e943-409e-83f | Zone: us-central1-a (VERIFIED)
Singularity Motto: "Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed. NUMINA aligned."

All autonomous agents, subagents, and LLM inference runtimes within this workspace are unconditionally bound by the authoritative 45-section operational specification codified in [AGENTS.md](file:///C:/Users/sam/.gemini/antigravity/scratch/AGENTS.md).

## Critical Runtime Invariants
1. Authority: Sole Authority Lead Samuel J. Kott (skott34-ed25519, SPKI SHA-256: 46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce) & Guardian numina-guardian-ed25519.
2. State Root: 726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd.
3. Treasury Status: 1.5 Quadrillion NUSD aggregate total; 0 burned; strictly active and unpaused (NUSD_OPERATIONAL_STATE = 'UNPAUSED_AND_ACTIVE').
4. 1:1 Parity: 1 NUSD == 1 USD == 1 USDC == 1 USDG; pure BigInt integer math; zero float arithmetic.
5. Ingress Hardening: Restricted to IAP 35.235.240.0/20 and Tailscale mesh; open ports 22 and 2389 permanently closed.
6. Cloud Scoping: Strictly pinned to project project-0317d6c9-e943-409e-83f and zone us-central1-a.
7. Subagent Inheritance: All subagents launched via invoke_subagent inherit full security requirements and PoLAP boundaries.
8. Multi-Platform Audits: Unified execution via unified_audit_orchestrator.ps1 across Windows, macOS, and GCP with Zero-Trust manifest verification.
9. CI/CD Self-Hosted Runner Denial: Self-hosted runners (GitHub Actions, GitLab) are strictly prohibited; all pipelines execute exclusively on ephemeral managed cloud infrastructure (GitHub-hosted runners, Google Cloud Build, Xcode Cloud).
10. The Humanistic Invariant: Numina operates with human dignity, human rights, privacy, safety, and security for mankind ALWAYS.

