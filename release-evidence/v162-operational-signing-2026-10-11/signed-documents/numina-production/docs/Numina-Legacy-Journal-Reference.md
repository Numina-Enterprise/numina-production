# Numina schema-1 control journal reference

This reference documents the existing control journal defined in the Numina
source tree. It distinguishes that source-defined format from the selected
self-hosted readback preserved on October 2, 2026. The readback is historical
evidence, and does not establish current N50 state.

## Source identities

The definitions below were read from these exact current source bytes:

| Source | Bytes | SHA-256 |
| --- | ---: | --- |
| `src/control-store.js` | 8445 | `68271ed230d0f1c71411a80efce8e3b34ed5efd614b00f5808d161e6c27f24e6` |
| `src/control.js` | 14439 | `3851422e6d23b052cdb475814b7c1e8bae2cf8e695248cfe8a3e9a9a31d48a13` |

These source identities do not claim equivalence with the older N50 server
implementation. The retained October 2 packet records historical source hashes
but contains none of those historical source files.

## Stored rows and manifest

`CONTROL_SCHEMA` in `src/control-store.js` defines:

| Table | Fields |
| --- | --- |
| `numina_control_manifest` | `id`, `revision`, `manifest_json`, `manifest_hash`, `head_hash`, `mutation_id` |
| `numina_control_events` | `id`, `revision`, `actor`, `command_hash`, `event_json`, `hash` |

The manifest reader selects the row with `id=1`. Event revisions have a unique
index and are read in revision order. The source requires parsed manifest
`schema` to be the number `1`, and requires arrays named `grants`, `requests`,
`evidence` and `records`. Its initial manifest also contains `root` and
`createdAt`. This is the actual source definition; it is not a newly invented
schema for the selected report.

The source-defined bootstrap event contains `id='genesis'`, `revision=0`,
`actor`, `at`, `type='bootstrap'`, `previous=null` and `manifestHash`.
Subsequent committed events contain `id`, `revision`, `actor`, `at`, `type`,
`command`, `commandHash`, `previous`, `manifestHash`, `parents`, `result` and
`decisionsHash`. Complete event objects must be preserved when reproducing
their hashes; selected projections of these objects are insufficient.

## Hash construction and continuity

The current source's `stable` function serializes nulls and booleans with
`JSON.stringify`, serializes safe integer numbers other than negative zero as
decimal strings, serializes strings with `JSON.stringify`, preserves array
order, and sorts object keys with JavaScript's default key sorting. It rejects
other value types. `controlHash` applies SHA-256 to UTF-8 bytes of this
serialization for objects; a string argument is hashed directly. This
describes the current source implementation, and does not establish a different
canonicalization profile or the behavior of unavailable historical source.

`readControl` verifies these stored relationships:

1. The parsed manifest hash equals `manifest_hash`.
2. Event revisions begin at zero and are contiguous; each parsed event's
   revision and identifier match its row.
3. Each event's `previous` is the preceding row's hash; genesis starts at null.
4. Each complete parsed event hashes to its row's `hash`.
5. Event count equals manifest revision plus one, final event hash equals
   `head_hash`, and final event identifier equals `mutation_id`.
6. The final event's `manifestHash`, or its compatibility `stateHash` fallback,
   equals the stored `manifest_hash`.
7. Each manifest evidence node's hash matches the remaining node fields.

The commit path also constructs and stores a command hash. The bootstrap
command hash uses `{type:'bootstrap',owner}`; later events include their
complete command and its `commandHash`. The stored event reader's checks
should not be described as independently replaying every command or proving
the complete reducer's behavior.

## Retained October 2 packet

The explicitly identified Slack artifact `F0C68Q7B62H` was recovered through
the supported connector file transport and preserved unchanged in private
cloud scratch storage. The archive `selfhosted-journal-readback-20261002.zip`
contains 8761 bytes and has SHA-256
`b1a7a0dd3d0e205e6fedbc1fa599eb923f6b1eb6b91698c4080ea7da8ddffad7`.
Its six unique regular members are selected reports: an acceptance decision,
a Markdown readback, a journal selection, a public-response selection, a
provider selection and a treasury selection. Financial selections remain
private and are not included in this reference.

The journal selection is dated `2026-10-02T22:11:42.873706+00:00`. It records
revision 2 and three events. A fresh read-only comparison confirms its
selected revision sequence, identifier uniqueness, previous-hash links and
final selected head. The packet reports nine earlier successful integrity
checks and a SQLite integrity result of `ok`; those historical checks were
not repeated against a database in this cloud pass.

The archive contains no database, complete `manifest_json`, complete
`event_json`, full command inputs, historical source bytes or Ed25519 export
signature. Therefore event, command and manifest hashes cannot be independently
recomputed from this packet. Its selected links do not establish complete
journal verification, current N50 state, current Sites state, external
settlement or a completed private-route cutover.

## Inputs required for complete verification

A complete read-only export needs the immutable manifest row and every
ordered event row from the same consistent database snapshot, without omitted
or truncated JSON payloads. It also needs the exact applicable implementation
and hash profile identified separately from the export. Historical verification
requires the historical source bytes; current verification requires a current
consistent export bound to its current source. Preserve the original archive
and its historical labels when adding any later export.
