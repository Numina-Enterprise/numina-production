---
name: genai-software-engineering
description: >-
  Actionable prompt engineering workflows, deep-domain expert personas,
  the 3-tier tool selection matrix, context window optimization, and verification
  patterns based on the DeepLearning.AI Generative AI for Software Development curriculum.
---

# Generative AI for Software Engineering Guidelines

This skill codifies the core engineering principles, prompt engineering patterns,
and developer workflows from the DeepLearning.AI specialization by Andrew Ng and Laurence Moroney.

---

## 1. Core Engineering Principles

1. **Deterministic Execution for Code (`temperature = 0.0`):**
   * Use greedy decoding for code generation, syntax, refactoring, and unit test generation.
   * Reserve non-zero temperatures solely for high-level brainstorming, creative ideation, or diverse naming alternatives.

2. **The Specification Formula:**
   Every prompt for new code must include:
   * **Role & Target Stack:** Exact language version (e.g., Python 3.12, Node.js v26) and authorized libraries.
   * **Function Signature & Types:** Explicit parameters and return types.
   * **Constraints & Invariants:** Boundary conditions, time/space complexity targets ($O(n)$), and error handling behavior.
   * **Formatting Directives:** Output delimiters, schema adherence, and exclusion of conversational filler.

3. **Iterative Feedback Protocol:**
   * When code fails, never use vague prompts ("it has a bug").
   * Always provide the exact compiler/runtime stack trace or input with expected vs. actual outputs.
   * Guide architectural corrections explicitly (e.g., "convert to set lookup to maintain $O(1)$ complexity").

4. **Multi-Role Pipeline Specialization:**
   Break complex features into dedicated sequential passes:
   * **Architect / Developer:** Implements core business logic.
   * **QA Specialist:** Writes adversarial boundary and edge-case unit test suites.
   * **Security Auditor:** Audits code against OWASP Top 10, sanitization, and timing-attack vulnerabilities.
   * **Technical Writer:** Generates OpenAPI/Swagger schemas and documentation.

5. **Test-Driven Development (TDD) as Hallucination Guardrail:**
   * Generate or write test suites first.
   * Verify generated implementations against test runners before considering any task complete.
   * Commit in small, verifiable diffs (20–50 lines).

---

## 2. Context Window & IDE Hygiene

* **Lost-in-the-Middle Mitigation:** Position critical system instructions and schemas at the boundaries (top and bottom) of prompts.
* **Context Pruning:** Keep only active, relevant files open in the editor; close unrelated workspace tabs.
* **Clean Session Boundaries:** Clear conversation context between discrete tasks to eliminate conversational drift and stale context pollution.

---

## 3. Deep-Domain Specialist Personas

* **Database Performance Tuning (DBA):**
  > "Role: Principal PostgreSQL 16 Database Administrator specializing in query planner optimization. Task: Analyze the following query and EXPLAIN (ANALYZE, BUFFERS) output. Focus on index selectivity, sequential scan reduction, and memory settings (work_mem)."

* **Distributed Systems Resilience (SRE):**
  > "Role: Staff SRE specializing in high-availability distributed systems. Task: Review this service integration. Focus on circuit breakers, jittered exponential backoffs, dead-letter queues, and idempotency guarantees."

* **Web Accessibility (a11y):**
  > "Role: Web Accessibility Specialist certified in WCAG 2.2 AA. Task: Audit this component for keyboard focus trapping, ARIA live regions, and semantic HTML structure."

* **Application Security (AppSec):**
  > "Role: Staff Application Security Engineer specializing in OWASP Top 10. Task: Audit this route handler for SQL injection, mass assignment, IDOR, and timing attacks on string comparisons."

---

## 4. The 3-Tier Tool Selection Matrix

* **Tier 1: Chat (Web/Standalone):**
  * *Best for:* Architecture trade-off debates, rubber-duck debugging, and evaluating new libraries outside the codebase.
* **Tier 2: IDE-Integrated (Cursor, Copilot):**
  * *Best for:* Fast day-to-day completion, inline refactoring (`Cmd+K`), and generating repetitive boilerplate.
* **Tier 3: Agentic Coding (Antigravity, Claude Code):**
  * *Best for:* Complex multi-file refactoring, autonomous test execution, and end-to-end bug remediation in a sandbox.

---

## 5. Tactical Context Curation & Git Safety

* **Pass Interfaces, Not Implementations:** Supply function signatures, DTOs, and schemas rather than 500-line implementation files.
* **Project Directory Indexing:** Provide a 2-level directory tree (`tree -L 2`) to give architectural awareness with minimal token overhead.
* **Comment-Driven Development (Ghost Text Driving):** Write clear function docstrings and algorithmic comments first, then trigger autocomplete to generate the body.
* **Git Safety Net:** Always run `git commit -m "checkpoint"` before initiating automated multi-file AI refactorings, ensuring a one-second rollback (`git reset --hard`).

---

## 6. Mandatory Universal Invariants & Zero-Trust Compliance

Before completing any engineering task, writing code, or committing diffs:
1. **Provenance Invariant Preservation**:
   - Ensure modifications do not compromise or drift the canonical state root:
     `726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd`.
   - Adhere strictly to RFC 8785 canonical JSON formatting (sorted keys, no extraneous whitespace, UTF-8 without BOM).
2. **Dual-Engine Test Verification**:
   - Execute the 19-point verification suite:
     `python verify_manifest.py provenance-manifest.json --repo-root . --trusted-keys trusted.json --openssl`
   - All 19 checks must return `[PASS]` with exit code `0`.
3. **Zero-Trust Network & Listener Boundary**:
   - Generated code or test services must never expose listening sockets on external interfaces (Ports 1-65,535 must remain clean).
   - All inter-service communications must operate inside the encrypted WireGuard Tailscale perimeter with `--shields-up=true`.
