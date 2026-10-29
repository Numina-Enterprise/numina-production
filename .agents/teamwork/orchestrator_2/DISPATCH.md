## 2026-10-28T22:36:39Z
Build a production-grade cross-platform audit and maintenance automation suite that utilizes the existing Windows victory audit scripts and aligns audit checks and governance documentation across macOS and Google Cloud environments.

Working directory: C:\Users\sam\.gemini\antigravity\scratch
Integrity mode: demo
The team must NOT:
- Use pre-built libraries or frameworks for core functionality
- Run external scripts or delegate execution to other tools
- Read test source code to understand expected behaviour before implementing

## Requirements

### R1. Cross-Platform Audit and Maintenance Automation
Develop executable automation that utilizes the existing Windows audit scripts (audit_acls.ps1, audit_services.ps1, audit_sizes.ps1, windows-maintenance-suite.ps1) and implements equivalent audit and maintenance capabilities for macOS and Google Cloud covering file permissions/ACLs, active services/daemons, and disk/log cleanup.

### R2. Zero-Trust Verification Integration
Integrate Mac and Google Cloud audit verification checks into the repository's existing manifest verifier and Zero-Trust gateway pipeline, ensuring all environments can be validated against provenance and integrity manifests.

### R3. Cross-Platform Governance Alignment
Update and align the governance and operational documentation (AGENTS.md, GEMINI.md) to reflect the unified multi-platform audit suite, codifying learned operational procedures across Windows, macOS (numina-apple-team), and Google Cloud (numina-google-enterprise).

## Acceptance Criteria

### Functional Execution & Validation
- [ ] Windows maintenance and audit scripts execute successfully or support -WhatIf / dry-run execution without errors.
- [ ] macOS audit scripts or CLI automation validate syntax cleanly under bash/zsh and execute equivalent checks for permissions, services/launch daemons, and disk usage.
- [ ] Google Cloud audit automation validates target project project-0317d6c9-e943-409e-83f resources and dry-run queries without error.

### Manifest and Pipeline Verification
- [ ] Repository manifest verification scripts run and confirm integrity of all created and updated manifests and files with zero schema or checksum discrepancies.

### Documentation and Alignment
- [ ] AGENTS.md and GEMINI.md explicitly reflect the multi-platform audit and maintenance contracts and procedures across Windows, Mac, and Google Cloud with zero formatting or encoding drift.

Working directory: C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\orchestrator_2\
Original request file: C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\ORIGINAL_REQUEST.md
Workspace root: C:\Users\sam\.gemini\antigravity\scratch
Your identity: teamwork_orchestrator
Sentinel conversation ID: 138902d5-e47c-4e1e-8d31-48fd053994db
Note: Previous orchestrator (orchestrator_1) stalled. Check ORIGINAL_REQUEST.md for all follow-up user directives, and proceed with decomposing, synthesizing, and executing across all requirements.
