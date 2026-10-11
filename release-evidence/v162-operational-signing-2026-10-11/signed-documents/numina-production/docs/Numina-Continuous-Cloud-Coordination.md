# Continuous cloud coordination

The Numina cloud service observes the canonical assignment ledger, workspace
links, task records, pinned Node executable, local public MCP preview, and
incoming reviewer receipts. It runs continuously while its managed cloud host
is available. The process does not reserve permanent hosting or activate model
executors or Salesforce agents.

The existing enabled platform oversight schedule was updated in place on
2026-10-11 to check the canonical cloud status and resume the service when
appropriate. Its hourly cadence is separate from this daemon's 60-second
coordination interval. Neither cadence establishes seven permanent agents,
100 activated Salesforce agents, or uninterrupted host availability.

The root operator controls the service from the canonical cloud tree:

```sh
python3 -B scripts/numina-cloud-work-loop.py start
python3 -B scripts/numina-cloud-work-loop.py status
python3 -B scripts/numina-cloud-work-loop.py refresh
python3 -B scripts/numina-cloud-work-loop.py stop
```

The default observation interval is 60 seconds and cannot be configured below
30 seconds. A held process lock prevents concurrent service instances. SIGTERM
and SIGINT produce a retained shutdown receipt. Linux process birth identity
prevents the controller from stopping a process that reused an earlier PID.

Private records live in the ignored `outputs/cloud-self-driving` directory:
`health.json` records the actual process, heartbeat, uptime, current queue and
visible failures; `latest-observation.json` records exact input identities and
per-task coordination states; `runs/<run-id>` retains dated observations and
shutdown records. The service log records startup failures. A stale heartbeat
or interrupted host must not be represented as continuous availability.

Observations execute when their own bounded input, listener, receipt, or explicit
refresh trigger changes. Idle intervals update the heartbeat without repeating
verification programs. A failed read-only transport observation may retry once,
after at least 60 seconds; exhausted attempts remain visible until a new input
or explicit refresh. Authorization and input-identity failures do not retry.
The launch record preserves the script and interpreter hashes separately from
later source observations; editing service source requires a process restart.
The registered actions use read-only files, the exact
Node `--version` command, Git commit readback, and loopback public HTTP
initialize/discovery. Configuration and ledger strings cannot introduce shell
commands, additional URLs, tests, private signing, or financial operations.
The MCP discovery record distinguishes four public data tools from three
owner-protected tools whose metadata is discoverable. The coordinator invokes
only initialize and tools/list; discovering protected metadata establishes no
owner authentication and does not call those protected tools.

The 100 canonical assignments remain unchanged. `input_observed` means a
registered input observation was recorded; `awaiting_executor` means actual
work and its acceptance receipt remain pending; `needs_evidence` preserves a
required dependency. None means that a Salesforce agent has been deployed or
the task has completed.

Reviewers may place new JSON receipts in `outputs/cloud-self-driving/incoming`.
The schema is `numina.cloud-task-review-receipt.v1`. A receipt must identify the
assigned `taskId`, `runId`, `target`, exact assigned `reviewer`, `observedAtUtc`,
`result: "completed"`, `scopeLimits` and `inputIdentities` arrays. The timestamp
must carry a timezone and the run identity must be a nonempty string. It must bind
the current `canonicalRoot`, `canonicalCommit`, `sourceIdentitySha256`,
`taskLedgerSha256`, and `preparedManifestSha256` copied from the latest observed
source identity. `passConditionSha256` is SHA-256 of the literal UTF-8 task
acceptance condition. Repeated JSON members and mismatched receipts are
rejected and reported. Matching records establish declaration/hash binding;
the reviewer name is self-reported and its authority or signature is not
authenticated by this intake. This
version has no registered full acceptance evaluators and changes no assignment
to completed. A receipt cannot authorize itself or establish whole-protocol
correctness, Independent Stream acceptance, external delivery, or treasury
settlement.
