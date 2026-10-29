# Numina Agentforce execution

The canonical source is `/workspace/numina-production`. The [task ledger](../config/numina-agentforce-tasks.v1.json) assigns one concrete next action to each of the 100 prepared Agentforce configuration IDs in [the workspace manifest](../config/numina-workspaces.v1.json). Engineering, deployment, proofs, signatures and review each own 20 actions.

The execution assignments use the six existing cloud reviewers. Prepared Salesforce configurations, actual cloud reviewers and activated Salesforce agents are separate states. The ledger creates neither a Salesforce session nor 100 concurrent workers. Existing-org metadata, entitlement, agent identity and activation still need matching authenticated evidence; cloud source review can continue independently.

Open `/task-ledger.html` to filter the tasks by team, status or evidence readiness. The reader loads the published `/tasks.json` and `/workspaces.json` and checks their configuration-ID mapping. It shows the assigned action, target, dependencies, failure handoff and recorded receipt. A publication failure or absent ledger is shown explicitly with a manual read-again control.

| Status | Meaning |
| --- | --- |
| `queued` | Work is assigned; no execution is claimed. |
| `executing` | An actual executor/run and start record are linked. |
| `completed` | A matching receipt satisfies the action's stated acceptance condition. |
| `needs_evidence` | An exact input, supported access or external observation is unavailable. |
| `failed` | An attempted action has a failure record and a visible next handoff. |

Readiness is separate from status. A queued source review can read available records; a queued provider readback can remain dependent on an actual publication receipt. An input record marked available does not complete its task. Every initial task is queued with zero attempts and no acceptance receipt.

Each task requires a receipt under `release-evidence/agentforce-execution/<run-id>/<task-id>.json`. Bind the task and run IDs, canonical root/commit, prepared-manifest digest, exact target and input identities, observation time, method, result, scope limits and output identities. Link the receipt through `lastReceipt`; never set completed from a prepared configuration, self-reported pass flag, old result for a different target or missing receipt. Retain failed and superseded records alongside later outcomes.

The ledger permits one retry after a transient read-only transport/provider failure, for at most two attempts. Missing authorization, identity/policy disagreement, missing exact inputs and any write need a visible dependency handoff instead. There is no hidden retry loop. Actual dispatch and durable receipt recording require the canonical cloud executor; the JSON queue and browser reader do not themselves perform those actions.

This queue starts no test suite, proof compiler, signing operation or manuscript edit. Financial actions and autonomous provider mutations are disabled. The final signed manuscript and signing identity remain intact. Root handles any already-authorized publication and the reviewed Slack update; no task treats a signature or queued action as permission for financial effects. No Mac installation or operation is part of this cloud queue.

Use the existing engineering/root Slack handoffs and existing access/intake/alignment tasks in the ledger. Do not create duplicate intake work or publish private room messages. Public status must distinguish connected MCP initialization/tool readbacks, website publication, actual companion use, bounded proof results and an editorial acceptance decision.

Next action: record the cloud executor's exact run identity and completed artifact receipts, then obtain actual published ledger/MCP readbacks. Keep unavailable Salesforce activation and concrete companion proof inputs visible until matching evidence exists.
