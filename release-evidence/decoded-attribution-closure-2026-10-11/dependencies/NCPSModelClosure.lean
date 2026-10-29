import NCPSAll
set_option autoImplicit false

/-!
Independent bounded proof extension for the recovered Lean4.22.0 NCPS model.
These theorems connect existing executable/model definitions. They do not
establish concrete JSON/JCS, Ed25519 or operational implementation conformance.
-/

namespace NCPS.ModelClosure

theorem evaluate_eq_true_iff_accepts
    (policy : NCPS.Advanced.VerificationPolicy)
    (report : NCPS.Advanced.VerificationReport) :
    NCPS.Advanced.evaluate policy report = true ↔
      NCPS.Advanced.Accepts policy report := by
  cases policy with
  | mk current requiredPrivate =>
    cases current <;> cases requiredPrivate <;>
      simp [NCPS.Advanced.evaluate, NCPS.Advanced.Accepts, Bool.and_eq_true, and_assoc]

theorem evaluate_eq_false_iff_not_accepts
    (policy : NCPS.Advanced.VerificationPolicy)
    (report : NCPS.Advanced.VerificationReport) :
    NCPS.Advanced.evaluate policy report = false ↔
      ¬ NCPS.Advanced.Accepts policy report := by
  constructor
  · intro hf ha
    have ht := (evaluate_eq_true_iff_accepts policy report).mpr ha
    simp [hf] at ht
  · intro hn
    cases hb : NCPS.Advanced.evaluate policy report with
    | false => rfl
    | true =>
      exact False.elim (hn ((evaluate_eq_true_iff_accepts policy report).mp hb))

theorem framed_encode_injective
    {Record : Type}
    (codec : NCPS.Advanced.Codec Record)
    (roundTrip : NCPS.Advanced.RoundTrip codec)
    (fixedTag : NCPS.Bytes) :
    NCPS.Advanced.Injective
      (fun record => NCPS.Advanced.frame fixedTag (codec.encode record)) := by
  intro a b heq
  apply NCPS.Advanced.codec_injective_of_roundtrip codec roundTrip
  exact NCPS.Advanced.frame_injective fixedTag heq

/-- Converting an ordered byte pair to its extensional extraction predicate loses
    order. It therefore cannot be the sole reversible pair-binding identity. -/
theorem extensional_pair_set_not_injective :
    ¬ NCPS.Advanced.Injective
      (fun pair : NCPS.Bytes × NCPS.Bytes =>
        (NCPS.ExtractionSet.fromList [pair.1, pair.2]).contains) := by
  intro injective
  have pairsEq : (([], [NCPS.Advanced.zeroByte]) : NCPS.Bytes × NCPS.Bytes) =
      ([NCPS.Advanced.zeroByte], []) :=
    injective (NCPS.ExtractionSet.fromList_swap [] [NCPS.Advanced.zeroByte])
  have emptyEq : ([] : NCPS.Bytes) = [NCPS.Advanced.zeroByte] :=
    congrArg Prod.fst pairsEq
  cases emptyEq

end NCPS.ModelClosure

#print axioms NCPS.ModelClosure.evaluate_eq_true_iff_accepts
#print axioms NCPS.ModelClosure.evaluate_eq_false_iff_not_accepts
#print axioms NCPS.ModelClosure.framed_encode_injective

#print axioms NCPS.ModelClosure.extensional_pair_set_not_injective
