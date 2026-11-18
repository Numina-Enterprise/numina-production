# Numina Metrology — what Numina measures

A measurement standard for information operations in the Numina stack.
It measures only what is actually measurable in this codebase. Anything
else is reported as unmeasured, never invented.

This is a measurement standard, not a certification, not an authorization,
and not a physics proof. Nothing here claims Numina is compliant with
any external standard, and nothing here proves a physics claim.

## What Numina measures

| Quantity | Unit | How | Where |
|---|---|---|---|
| Canonical byte count of a payload | bytes | Length of its RFC 8785 (JCS) canonical bytes, from the same `canonicalize` package the verify module uses — never a re-derived canonicalizer | `src/numina-metrology.js:182` (`canonicalByteCount`), `:194` (`measureCanonical`) |
| Canonical bytes + SHA-256 digest of a payload | bytes, hex | `measureCanonical`: canonical bytes and their SHA-256 hex, as a pure measurement aid | `src/numina-metrology.js:194` |
| SHA-256 digests performed | count | Counted at the operation sites | `src/numina-pair-binding-raft.js:457` (`envelopeDigest`) |
| Ed25519 signs / verifies | count | Counted at the operation sites | `src/numina-protocol-sign.js:71` (sign), `src/numina-protocol-verify.js:126` (verify) |
| ML-DSA-65 signs / verifies | count | Counted at the operation sites | `src/numina-protocol-pqc.js:163` (sign), `:190` (verify) |
| Wall-clock time per operation | milliseconds | `timeSync(fn)` returns the result with its duration; the duration is an observation, never an exact value | `src/numina-metrology.js:212` |
| Landauer floor for a stated erasure | joules | `E >= N * kB * T * ln(2)` for a stated bit count at a stated temperature — a theoretical lower bound, see below | `src/numina-metrology.js:95`, `:120` |

Counters live on a meter created by `createMetrology()`
(`src/numina-metrology.js:137`); the wired paths use the module
default, `defaultMetrology` (`:313`), unless a meter is passed
explicitly. Meters do not share state. `snapshot()` (`:283`) returns
a JSON-able record (`numina.metrology-snapshot.v1`); `reset()` (`:299`)
zeroes the counts. The record functions fail closed on a programming
error (an unknown operation name, an impossible byte count) and never
on measured data.

## Where the counters are wired in

Telemetry only: counting never changes whether an operation succeeds
or fails, and no accept/reject semantic was touched.

- **Raft validation** (`src/numina-pair-binding-raft.js`): the engine
  takes an optional `meter` (`:443`). The frame check records the
  frame's canonical byte count (`:497`); `envelopeDigest` records the
  unsigned envelope's canonical byte count and one SHA-256 (`:457`);
  verification flows through the verify/ML-DSA-65 leaves below.
- **Protocol verify** (`src/numina-protocol-verify.js`): `verifySignature`
  (`:126`) records one canonicalization and one Ed25519 verify per
  attempt; `verifyMurphRecord` (`:211`) records the canonical bytes
  behind its reported hex as well.
- **Protocol sign** (`src/numina-protocol-sign.js:71`) and **PQC**
  (`src/numina-protocol-pqc.js:163`, `:190`): `signPayload` /
  `signMlDsa65` record one canonicalization and one sign per attempt
  (their re-verifications are counted by the verify leaves); the
  hybrid helpers thread the meter through.

Counts are per operation actually performed, including
re-serializations of the same payload at different layers. One
successful Raft entry (either signature form) therefore records
exactly: 6 canonicalizations, 1 SHA-256, 2 Ed25519 verifies,
2 ML-DSA-65 verifies, 0 signs. A failed entry records the verifies
attempted and no digest; a schema-invalid entry records nothing.
These exact totals are pinned by `tests/numina-metrology.test.mjs`.

## The Landauer boundary — read this first

Landauer's principle is real: erasing one bit costs **at least**
`kT ln 2` of energy dissipated as heat, under specific conditions
(an irreversible erasure at temperature `T`). It is a **theoretical
lower bound on erasure cost**. It is:

- NOT the energy of a stored bit;
- NOT a measured energy of any operation in this stack;
- NOT a mass of information.

`landauerFloorJoules({ bitsErased, temperatureKelvin })`
(`src/numina-metrology.js:95`) computes that floor for a **stated**
number of erased bits at a **stated** temperature, with
`kB = 1.380649e-23 J/K` (exact, SI). `erasureFloorForBytes`
(`:120`) is the same floor for a stated byte count (8 bits each).
Reference values, proven in the tests against hard literals:

- 1 bit at 300 K: `2.870978885078724e-21` J
- 8 bits (1 byte) at 300 K: `2.296783108062979e-20` J
- 1 bit at 273.15 K: `2.6140262748641777e-21` J
- 1 bit at 77 K: `7.368845805035391e-22` J
- 0 bits at any temperature: `0` J

Every result carries `bound: 'THEORETICAL_LOWER_BOUND'` and the
formula `E >= N * kB * T * ln(2)`. Invalid inputs (negative or
non-integer bit counts, temperature at or below zero, non-finite
values) throw instead of computing garbage.

## What is NOT measured, and why

- **Actual energy.** There is no platform energy counter available
  in this environment (no RAPL, no power meter, no BMC reading
  exposed to this runtime). `actualEnergy()`
  (`src/numina-metrology.js:246`) therefore reports
  `{ status: 'unmeasured', joules: null }` — never zero, never an
  estimate. A real counter can be registered with
  `registerEnergyCounter(readFn)` (`:233`); until one is, the
  answer stays unmeasured. A counter that fails or returns a bad
  value is reported as a failed counter, never as a number.
- **Information mass.** No such quantity is defined or measured
  here. See the next section.
- **Data-center energy, heat, or power.** This module measures
  operations in this codebase, not a facility. It has no sensor
  input from any data center.
- **Wall-clock durations as guarantees.** `timeSync` measures what
  an operation took on this machine, this run. Durations vary with
  load and hardware and are never asserted exact.

## Claims this module does NOT adopt

The January Walker reel (Instagram, Nov 12, 2026) proposes that
computers lack metrology standards for bits and bytes, traces
information physics from the Manhattan Project through Landauer's
principle, and argues data centers waste energy and produce heat
because data and energy are not standardized and measured. It
promotes a Change.org petition for legislation requiring metrology
in data centers, and links infoton.ai / infoton-p30.

What Numina takes from that proposal: the measurement standard —
this module. What it does NOT take:

- **"Information / data has mass."** Not established physics as
  stated. No mass of information is claimed, computed, or stored
  anywhere in this module, its tests, or this document.
- **The petition and the legislation.** No petition is signed,
  endorsed, or submitted by this work, and no legislation is
  proposed. The owner has separately stated that every data center
  built is Numina; this module is the measurement half of that
  standard, nothing more.
- **Any physics beyond the Landauer floor as stated above.** The
  Manhattan Project history, the data-center waste argument, and
  the infoton material are the reel's framing, not Numina claims,
  and are not repeated here as facts.

## What this is not

- Not a certification, authorization, or compliance claim of any kind.
- Not a proof of any physics proposition, including ER=EPR.
- Not a measurement of any real data center, device, or facility.
- Not a change to any accept/reject, signing, or verification rule:
  the wired paths count operations; they do not judge them.
