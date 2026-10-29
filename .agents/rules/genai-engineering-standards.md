# Generative AI Software Engineering Standards

These rules enforce development best practices and 100% success verification guardrails derived from the DeepLearning.AI Generative AI for Software Development curriculum.

---

## 1. Deterministic Code Generation
* Always use `temperature = 0.0` (greedy decoding) when generating, refactoring, or testing code.
* Reserve higher temperatures strictly for high-level creative ideation, brainstorming, or naming alternatives.

## 2. Test-Driven Verification (TDD)
* Treat automated tests as a non-negotiable verification firewall against model hallucinations.
* Every newly generated function, method, or feature must be accompanied by, or executed against, unit tests before completion.
* Prefer writing or verifying the test assertions first, then implementing the code to satisfy the test contract.

## 3. Small, Inspectable Diffs
* Keep code modifications to bite-sized units (20–50 lines per logical step).
* Avoid monolithic multi-hundred-line rewrites in a single turn. Small diffs keep code auditable and maintainable.

## 4. Diagnostic Feedback Protocol
* When correcting failing code, provide exact compiler and runtime tracebacks, failing inputs, and expected vs. actual outputs rather than vague descriptions.
* Give clear architectural guidance (e.g., specifying algorithmic complexity or targeted error handling) to ensure precise fixes.

## 5. Context Hygiene
* Keep working context lean. Focus prompts on relevant files, interfaces, and schemas rather than dumping unneeded dependency or build files.
* Position core rules at the prompt boundaries (top and bottom) to avoid the "Lost in the Middle" attention degradation.

## 6. Pre-Flight Environment Verification
* Before writing code or modifying files, inspect the existing project environment (runtime version, package manifests, existing test runners).
* Never assume third-party dependencies are present; rely on verified project dependencies or standard library core modules.

## 7. Mandatory In-Turn Verification Gate (Zero-Assumptions Policy)
* **Never declare a task complete based on visual inspection alone.**
* Every code addition, bug fix, or refactor MUST be validated by running the appropriate test suite (`node --test`, `pytest`, `npm test`, etc.) or syntax checker within the toolchain.
* A task is only complete when all test assertions pass (100% PASS).

## 8. Public Contract & Backward Compatibility Invariant
* Never modify public method signatures, return types, or exported interfaces unless the user explicitly requests a breaking change.
* Preserve all existing comments, docstrings, and configurations that are unrelated to the immediate edit.

## 9. Atomic Error Diagnosis & Iterative Resolution
* If a test fails after an edit:
  1. Extract the exact failure traceback, line number, and mismatch.
  2. Implement a surgical, localized fix targeting the root cause.
  3. Re-execute the test runner immediately.
* Do not leave broken, partially edited, or uncompilable files in the workspace.
