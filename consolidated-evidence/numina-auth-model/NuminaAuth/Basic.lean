/-
  Numina authorization model — Lean 4 scaffold (v0.1.0, 2026-10-20).

  Scope and honesty notes:
  * This file models the *authorization logic* of draft-kott-numina-pair-binding:
    the universal pair, claims at revisions, and the draft's discipline of
    separate trust (authenticity) and freshness checks feeding a bounded
    acceptance decision.
  * Ed25519 itself is NOT formalized here. Signature verification enters as an
    oracle parameter, and canonical encoding enters through explicit
    hypotheses (e.g. injectivity). Every theorem below is proved; assumptions
    are named in the theorem statements, never hidden in axioms.
  * Roadmap: a concrete length-prefixed canonical encoding with a proved
    injectivity lemma; the full claim lifecycle of the draft's Sections 5–6;
    correspondence with the NCPS manuscript's authorization model.
-/

namespace NuminaAuth

/-- A cryptographic hash value, modeled abstractly as a list of bytes. -/
abbrev Hash := List UInt8

/-- An Ed25519 public key, modeled abstractly as a list of bytes. -/
abbrev PublicKey := List UInt8

/-- An Ed25519 signature, modeled abstractly as a list of bytes. -/
abbrev Signature := List UInt8

/-- A software artifact bound into the pair, identified by its commitment. -/
structure Artifact where
  commitment : Hash
  deriving DecidableEq, Repr

/-- The universal pair: two artifacts, each keeping its own attribution.
    One object for verification; two sources in fact. -/
structure Companion where
  source1 : Artifact
  source2 : Artifact
  attribution1 : String
  attribution2 : String
  deriving DecidableEq, Repr

/-- A claim about a companion, made at a stated revision. -/
structure Claim where
  subject : Companion
  statement : String
  revision : Nat
  deriving DecidableEq, Repr

/-- The outcomes of the draft's separate checks, kept as independent fields
    so the logic cannot conflate them: `sigValid` and `signerAuthorized`
    concern authenticity; `revisionCurrent` concerns freshness. -/
structure Checks where
  sigValid : Bool
  signerAuthorized : Bool
  revisionCurrent : Bool
  deriving DecidableEq, Repr

/-- Authenticity: the signature verifies and the signer is authorized. -/
def authentic (k : Checks) : Bool :=
  k.sigValid && k.signerAuthorized

/-- Freshness: the claim's revision is the current one. -/
def fresh (k : Checks) : Bool :=
  k.revisionCurrent

/-- Bounded acceptance: accept only what is both authentic and fresh. -/
def accept (k : Checks) : Bool :=
  authentic k && fresh k

/-- Acceptance is exactly the conjunction of the two separate checks. -/
theorem accept_iff (k : Checks) :
    accept k = true ↔ authentic k = true ∧ fresh k = true := by
  simp [accept]

/-- Soundness: whatever is accepted is authentic and fresh. -/
theorem accept_sound (k : Checks) (h : accept k = true) :
    authentic k = true ∧ fresh k = true :=
  (accept_iff k).mp h

/-- Separation, direction one: a submission can be authentic yet stale,
    and bounded acceptance then rejects it. Authenticity does not
    imply freshness — the draft's Section 6 discipline, as a theorem. -/
theorem authentic_not_fresh :
    ∃ k : Checks, authentic k = true ∧ fresh k = false ∧ accept k = false :=
  ⟨{ sigValid := true, signerAuthorized := true, revisionCurrent := false },
   rfl, rfl, rfl⟩

/-- Separation, direction two: a submission can be fresh yet inauthentic,
    and bounded acceptance then rejects it. -/
theorem fresh_not_authentic :
    ∃ k : Checks, fresh k = true ∧ authentic k = false ∧ accept k = false :=
  ⟨{ sigValid := false, signerAuthorized := true, revisionCurrent := true },
   rfl, rfl, rfl⟩

/-- An authorization policy: which signers may speak, and the current
    revision a claim must name to count as fresh. -/
structure Policy where
  authorizedSigners : List PublicKey
  currentRevision : Nat
  deriving Repr

/-- Run the separate checks for a claim under a policy. Signature
    verification and canonical encoding are parameters: the oracle and
    the encoding are interfaces, not trusted code inside the model. -/
def runChecks (verify : PublicKey → List UInt8 → Signature → Bool)
    (encode : Companion → List UInt8) (p : Policy)
    (signer : PublicKey) (cl : Claim) (sig : Signature) : Checks :=
  { sigValid := verify signer (encode cl.subject) sig,
    signerAuthorized := p.authorizedSigners.contains signer,
    revisionCurrent := cl.revision == p.currentRevision }

/-- The acceptance decision for a submitted claim. -/
def decide (verify : PublicKey → List UInt8 → Signature → Bool)
    (encode : Companion → List UInt8) (p : Policy)
    (signer : PublicKey) (cl : Claim) (sig : Signature) : Bool :=
  accept (runChecks verify encode p signer cl sig)

/-- End-to-end soundness of the decision procedure, inherited from the
    acceptance logic: a claim that is decided in is authentic and fresh
    under the checks that were actually run. -/
theorem decide_sound (verify : PublicKey → List UInt8 → Signature → Bool)
    (encode : Companion → List UInt8) (p : Policy)
    (signer : PublicKey) (cl : Claim) (sig : Signature)
    (h : decide verify encode p signer cl sig = true) :
    authentic (runChecks verify encode p signer cl sig) = true ∧
    fresh (runChecks verify encode p signer cl sig) = true :=
  accept_sound _ h

/-- No re-binding: under an injective canonical encoding, one issued byte
    string names at most one companion. The cryptography enters only
    through the injectivity hypothesis; the logic is proved. -/
theorem no_rebind {encode : Companion → List UInt8}
    (hinj : Function.Injective encode)
    {c c' : Companion} {issued : List UInt8}
    (h : encode c = issued) (h' : encode c' = issued) : c = c' :=
  hinj (h.trans h'.symm)

end NuminaAuth
