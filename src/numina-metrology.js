// numina-metrology.js — measurement primitives for information
// operations in the Numina stack.
//
// This is a MEASUREMENT STANDARD, not a certification and not a physics
// proof. It measures only what is actually measurable in this codebase:
// canonical byte counts (RFC 8785), operation counters (SHA-256,
// Ed25519, ML-DSA-65), and wall-clock time. Anything else is reported
// as unmeasured, never invented.
//
// THE LANDAUER BOUNDARY (read this before using the energy model).
// Landauer's principle is real: erasing one bit costs AT LEAST
// kT ln 2 of energy dissipated as heat, under specific conditions
// (an irreversible erasure at temperature T). It is a THEORETICAL
// LOWER BOUND on erasure cost. It is NOT the energy of a stored bit,
// NOT a measured energy of any operation in this stack, and NOT a
// mass of information. This module computes that floor for a STATED
// number of erased bits at a STATED temperature — the inputs are
// stated, the output is the floor. Actual energy is reported ONLY
// from a real platform counter when one is registered; in this
// environment none is, so actual energy reads as unmeasured, never
// as zero and never as an estimate.
//
// What this module does NOT adopt: the claim that "information /
// data has mass" as stated in the January Walker reel (Nov 12,
// 2026) is not established physics as stated and appears nowhere
// here as a claim — neither in code, tests, nor docs. No petition
// is signed, endorsed, or submitted by this module, and no
// legislation is proposed. The owner has separately stated that
// every data center built is Numina; this module is the measurement
// half of that standard, nothing more.
//
// Units are explicit everywhere: bytes, counts, milliseconds, joules.
// Counting is telemetry only: recording an operation never changes
// whether it succeeds or fails, and a broken meter must never break
// a cryptographic check — record calls here are total functions
// over the values the wired paths actually pass (constants and
// byte lengths), and they throw only on a programming error (an
// unknown operation name or an impossible byte count), never on
// measured data.
//
// Canonical bytes come from the SAME `canonicalize` package
// (RFC 8785) that src/numina-protocol-verify.js uses — never a
// re-derived canonicalizer. The meter's canonicalByteCount must
// agree byte-for-byte with canonicalBytes from the verify module;
// the tests prove it.
//
// Endianness: this module defines NO new byte layout. The only
// bytes it produces are canonical JSON bytes (UTF-8, no length
// prefixes) and SHA-256 hex digests. The primitives' own encodings
// are LABELED EXCEPTIONS, never re-encoded: Ed25519 little-endian
// per RFC 8032; ML-DSA byte encodings as FIPS 204 defines them.
//
// This module never signs, never generates keys, and never holds a
// private key. Counters record operations performed elsewhere; they
// do not perform them.
import canonicalize from 'canonicalize';
import { sha256 } from '@noble/hashes/sha2.js';
import { performance } from 'node:perf_hooks';

/** Schema tag for a metrology snapshot. */
export const METROLOGY_SCHEMA = 'numina.metrology-snapshot.v1';

/** Boltzmann constant, exact by SI definition (J/K). */
export const BOLTZMANN_CONSTANT_JOULES_PER_KELVIN = 1.380649e-23;

/** The Landauer floor formula, as a string, for reports. */
export const LANDAUER_FORMULA = 'E >= N * kB * T * ln(2)';

/**
 * Label carried on every Landauer result: the value is a theoretical
 * lower bound on erasure cost, not a measurement of energy spent.
 */
export const LANDAUER_BOUND_LABEL = 'THEORETICAL_LOWER_BOUND';

/** The five countable operations. */
export const METROLOGY_OPERATIONS = ['sha256', 'ed25519Sign', 'ed25519Verify', 'mlDsa65Sign', 'mlDsa65Verify'];

/** Energy report status when no platform counter is available. */
export const ENERGY_STATUS_UNMEASURED = 'unmeasured';
/** Energy report status when a registered counter supplied a value. */
export const ENERGY_STATUS_MEASURED = 'measured';

function isSafeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * The Landauer floor: the minimum energy that erasing `bitsErased`
 * bits must dissipate as heat at `temperatureKelvin`, E = N kB T ln 2.
 * Pure and deterministic. Fail-closed: bitsErased must be a safe
 * non-negative integer, temperatureKelvin a finite number > 0.
 * Returns the floor in joules plus the inputs and the bound label —
 * the result is a THEORETICAL_LOWER_BOUND, never a measured energy.
 */
export function landauerFloorJoules({ bitsErased, temperatureKelvin }) {
  if (!isSafeNonNegativeInteger(bitsErased)) {
    throw new Error('bitsErased must be a safe non-negative integer');
  }
  if (typeof temperatureKelvin !== 'number' || !Number.isFinite(temperatureKelvin) || temperatureKelvin <= 0) {
    throw new Error('temperatureKelvin must be a finite number greater than 0');
  }
  const joules = bitsErased * BOLTZMANN_CONSTANT_JOULES_PER_KELVIN * temperatureKelvin * Math.LN2;
  return {
    joules,
    unit: 'joules',
    bitsErased,
    temperatureKelvin,
    formula: LANDAUER_FORMULA,
    bound: LANDAUER_BOUND_LABEL,
    note: 'Theoretical lower bound on erasure cost at the stated temperature. Not a measurement of energy spent, not the energy of a stored bit.',
  };
}

/**
 * The Landauer floor for erasing `bytes` bytes (8 bits each) at
 * `temperatureKelvin`. Convenience wrapper over landauerFloorJoules;
 * the same fail-closed input rules apply. The result states the
 * byte count it was computed from.
 */
export function erasureFloorForBytes({ bytes, temperatureKelvin }) {
  if (!isSafeNonNegativeInteger(bytes)) {
    throw new Error('bytes must be a safe non-negative integer');
  }
  const bitsErased = bytes * 8;
  if (!Number.isSafeInteger(bitsErased)) {
    throw new Error('bytes * 8 must be a safe integer');
  }
  return { ...landauerFloorJoules({ bitsErased, temperatureKelvin }), bytes };
}

/**
 * Create an isolated metrology meter: operation counters, canonical
 * byte totals, a wall-clock timer, and the energy report. Meters do
 * not share state: create one per engine, per test, or use the
 * module default (defaultMetrology) for the wired paths.
 */
export function createMetrology() {
  const counts = {
    sha256: 0,
    ed25519Sign: 0,
    ed25519Verify: 0,
    mlDsa65Sign: 0,
    mlDsa65Verify: 0,
  };
  let canonicalizations = 0;
  let canonicalBytesTotal = 0;
  let energyCounter = null;

  const meter = {
    /**
     * Record one performed operation. Fail-closed: an unknown
     * operation name throws — a miscounted operation must not
     * silently vanish from the record.
     */
    record(operation) {
      if (!METROLOGY_OPERATIONS.includes(operation)) {
        throw new Error(`unknown metrology operation: ${String(operation)}`);
      }
      counts[operation] += 1;
    },

    /**
     * Record one RFC 8785 canonicalization of `byteCount` bytes.
     * Fail-closed on an impossible count. Callers record the length
     * of canonical bytes they actually produced.
     */
    recordCanonical(byteCount) {
      if (!isSafeNonNegativeInteger(byteCount)) {
        throw new Error('canonical byte count must be a safe non-negative integer');
      }
      canonicalizations += 1;
      canonicalBytesTotal += byteCount;
    },

    /**
     * Canonical byte count of a payload, pure: the length of its
     * RFC 8785 canonical bytes (same `canonicalize` package the
     * verify module uses). Does NOT record — ad-hoc measurement
     * must not pollute the counters. Throws when the payload is
     * not JSON-canonicalizable.
     */
    canonicalByteCount(payload) {
      const text = canonicalize(payload);
      if (typeof text !== 'string') throw new Error('payload is not JSON-canonicalizable');
      return new TextEncoder().encode(text).length;
    },

    /**
     * Canonical measurement of a payload, pure: its byte count and
     * the SHA-256 hex of its canonical bytes. Does NOT record.
     * The digest is a measurement aid; the SHA-256 operations the
     * stack counts are the ones the wired paths record.
     */
    measureCanonical(payload) {
      const text = canonicalize(payload);
      if (typeof text !== 'string') throw new Error('payload is not JSON-canonicalizable');
      const bytes = new TextEncoder().encode(text);
      const digest = sha256(bytes);
      return {
        byteCount: bytes.length,
        byteCountUnit: 'bytes',
        sha256Hex: Buffer.from(digest).toString('hex'),
      };
    },

    /**
     * Time a synchronous operation: runs fn, returns its result
     * with the wall-clock duration in milliseconds. The duration
     * is an observation, never an exact value — callers must not
     * assert a specific duration. Errors from fn propagate.
     */
    timeSync(fn) {
      const startMs = performance.now();
      const result = fn();
      const durationMs = performance.now() - startMs;
      return { result, durationMs, durationUnit: 'milliseconds' };
    },

    /** The Landauer floor for a stated erasure (pure, see above). */
    landauerFloorJoules,

    /** The Landauer floor for erasing a stated byte count (pure). */
    erasureFloorForBytes,

    /**
     * Register a real platform energy counter: a function returning
     * the energy in joules (a finite non-negative number). Until
     * one is registered, actual energy is unmeasured. A counter
     * that throws or returns a bad value is reported as a failed
     * counter, never as a number. Registration persists across
     * reset() — it is a property of the environment, not the count.
     */
    registerEnergyCounter(readFn) {
      if (typeof readFn !== 'function') {
        throw new Error('energy counter must be a function returning joules');
      }
      energyCounter = readFn;
    },

    /**
     * Actual energy: measured ONLY from a registered platform
     * counter. With none registered — the state of this
     * environment — the result is unmeasured with joules null:
     * never zero, never an estimate.
     */
    actualEnergy() {
      if (energyCounter === null) {
        return {
          status: ENERGY_STATUS_UNMEASURED,
          joules: null,
          unit: 'joules',
          reason: 'no platform energy counter is registered in this environment',
        };
      }
      let joules;
      try {
        joules = energyCounter();
      } catch {
        return {
          status: ENERGY_STATUS_UNMEASURED,
          joules: null,
          unit: 'joules',
          reason: 'registered energy counter failed',
        };
      }
      if (typeof joules !== 'number' || !Number.isFinite(joules) || joules < 0) {
        return {
          status: ENERGY_STATUS_UNMEASURED,
          joules: null,
          unit: 'joules',
          reason: 'registered energy counter returned a non-finite or negative value',
        };
      }
      return {
        status: ENERGY_STATUS_MEASURED,
        joules,
        unit: 'joules',
        source: 'registered-platform-counter',
      };
    },

    /** A JSON-able snapshot of everything this meter has recorded. */
    snapshot() {
      return {
        schema: METROLOGY_SCHEMA,
        counts: { ...counts },
        countsUnit: 'count',
        canonicalizations,
        canonicalBytesTotal,
        canonicalBytesUnit: 'bytes',
        energy: meter.actualEnergy(),
      };
    },

    /**
     * Zero the counters and byte totals. The registered energy
     * counter (if any) is kept: it belongs to the environment.
     */
    reset() {
      for (const operation of METROLOGY_OPERATIONS) counts[operation] = 0;
      canonicalizations = 0;
      canonicalBytesTotal = 0;
    },
  };
  return meter;
}

/**
 * The module default meter, used by the wired paths (Raft validation,
 * protocol verify/sign, PQC) when no meter is passed explicitly.
 * Anything that does not pass a meter records here.
 */
export const defaultMetrology = createMetrology();
