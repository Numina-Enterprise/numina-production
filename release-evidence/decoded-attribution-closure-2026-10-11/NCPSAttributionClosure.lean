import NCPSModelClosure
set_option autoImplicit false

/-!
A separate, bounded successor over decoded attribution fields.
The fixed literals come from the preserved manuscript section 3 and Appendix F.
This is not a raw JSON parser, a deployed companion verifier, policy adoption,
personal-attribution proof, or the unknown legacy eight-Boolean ClosureResult.
The seven inherited findings retain their abstract meaning and explicit limits.
-/

namespace NCPS.AttributionClosure

structure SourceIdentity where
  sourceId : String
  alias : String
  deriving DecidableEq, Repr

structure PersonDisplay where
  name : String
  label : String
  deriving DecidableEq, Repr

/-- Relevant decoded fields only. Raw member uniqueness, Unicode decoding,
    schema closure, artifacts, hash profiles and commitments are separate. -/
structure DecodedAttributionView where
  sources : List SourceIdentity
  people : List PersonDisplay
  personToAlias : List (String × String)
  note : String
  deriving DecidableEq, Repr

def expectedSources : List SourceIdentity :=
  [⟨"source_1", "UNIVERSAL_PAIR_1"⟩, ⟨"source_2", "UNIVERSAL_PAIR_2"⟩]

def expectedPeople : List PersonDisplay :=
  [⟨"Sam Kott", "1A"⟩, ⟨"Lauren Anderson", "1B"⟩]

def expectedMap : List (String × String) :=
  [("Sam Kott", "UNIVERSAL_PAIR_2"), ("Lauren Anderson", "UNIVERSAL_PAIR_1")]

def approvedNote : String :=
  "UNIVERSAL_PAIR_1 labels the existing final-build normalized SHA-256 commitment attributed to Lauren Anderson (1B). UNIVERSAL_PAIR_2 labels the existing final-manifest SHA-256 commitment attributed to Sam Kott (1A). Personal attribution remains 1A first with Sam Kott, then 1B with Lauren Anderson. The two references are associated with one private genesis record."

/-- Exact fixed-profile value semantics. Map member order is immaterial;
    source and personal-display array order are intentionally different. -/
def FixedAttribution (v : DecodedAttributionView) : Prop :=
  v.sources = expectedSources ∧
  v.people = expectedPeople ∧
  (v.personToAlias = expectedMap ∨ v.personToAlias = expectedMap.reverse) ∧
  v.note = approvedNote

/-- Concrete equality checks over the decoded values, not an assumed pass flag. -/
def checkDecodedAttribution (v : DecodedAttributionView) : Bool :=
  decide (v.sources = expectedSources) &&
  decide (v.people = expectedPeople) &&
  (decide (v.personToAlias = expectedMap) ||
    decide (v.personToAlias = expectedMap.reverse)) &&
  decide (v.note = approvedNote)

theorem check_true_iff_fixed (v : DecodedAttributionView) :
    checkDecodedAttribution v = true ↔ FixedAttribution v := by
  simp [checkDecodedAttribution, FixedAttribution, Bool.and_eq_true,
    Bool.or_eq_true, and_assoc]

theorem check_false_iff_not_fixed (v : DecodedAttributionView) :
    checkDecodedAttribution v = false ↔ ¬ FixedAttribution v := by
  constructor
  · intro hf ha
    have ht := (check_true_iff_fixed v).mpr ha
    simp [hf] at ht
  · intro hn
    cases hb : checkDecodedAttribution v with
    | false => rfl
    | true => exact False.elim (hn ((check_true_iff_fixed v).mp hb))

def fixedView : DecodedAttributionView :=
  ⟨expectedSources, expectedPeople, expectedMap, approvedNote⟩

theorem fixed_view_valid : FixedAttribution fixedView := by
  simp [FixedAttribution, fixedView]

theorem fixed_view_accepted : checkDecodedAttribution fixedView = true :=
  (check_true_iff_fixed fixedView).mpr fixed_view_valid

theorem map_member_order_immaterial :
    FixedAttribution { fixedView with personToAlias := expectedMap.reverse } := by
  simp [FixedAttribution, fixedView]

theorem reversed_sources_rejected (v : DecodedAttributionView)
    (h : v.sources = expectedSources.reverse) :
    checkDecodedAttribution v = false := by
  apply (check_false_iff_not_fixed v).mpr
  intro hv
  have bad : expectedSources.reverse ≠ expectedSources := by decide
  exact bad (h.symm.trans hv.1)

theorem reversed_people_rejected (v : DecodedAttributionView)
    (h : v.people = expectedPeople.reverse) :
    checkDecodedAttribution v = false := by
  apply (check_false_iff_not_fixed v).mpr
  intro hv
  have bad : expectedPeople.reverse ≠ expectedPeople := by decide
  exact bad (h.symm.trans hv.2.1)

theorem unapproved_note_rejected (v : DecodedAttributionView)
    (h : v.note ≠ approvedNote) :
    checkDecodedAttribution v = false := by
  apply (check_false_iff_not_fixed v).mpr
  intro hv
  exact h hv.2.2.2

/-- Eight semantic finding slots, distinct from the legacy Boolean schema.
    This bounded model omits each check's provenance/lifecycle metadata. -/
structure EightFindingReport where
  schema : NCPS.Advanced.Finding
  attributionMap : NCPS.Advanced.Finding
  signature : NCPS.Advanced.Finding
  authority : NCPS.Advanced.Finding
  sourceCommitments : NCPS.Advanced.Finding
  currentSource : NCPS.Advanced.Finding
  freshness : NCPS.Advanced.Finding
  privateResolution : NCPS.Advanced.Finding
  deriving DecidableEq, Repr

def toSeven (r : EightFindingReport) : NCPS.Advanced.VerificationReport :=
  ⟨r.schema, r.signature, r.authority, r.sourceCommitments,
    r.currentSource, r.freshness, r.privateResolution⟩

def attributionFinding (v : DecodedAttributionView) : NCPS.Advanced.Finding :=
  if checkDecodedAttribution v then .pass else .mismatch

/-- The attribution result is computed from actual decoded field values.
    Each other finding is copied without alteration, not independently proved. -/
def collectReport (base : NCPS.Advanced.VerificationReport)
    (v : DecodedAttributionView) : EightFindingReport :=
  ⟨base.schema, attributionFinding v, base.signature, base.authority,
    base.sourceCommitments, base.currentSource, base.freshness,
    base.privateResolution⟩

theorem all_seven_findings_preserved (base : NCPS.Advanced.VerificationReport)
    (v : DecodedAttributionView) :
    toSeven (collectReport base v) = base := rfl

theorem attribution_pass_iff_fixed (v : DecodedAttributionView) :
    attributionFinding v = .pass ↔ FixedAttribution v := by
  rw [← check_true_iff_fixed v]
  cases hb : checkDecodedAttribution v <;> simp [attributionFinding, hb]

def evaluateEight (policy : NCPS.Advanced.VerificationPolicy)
    (r : EightFindingReport) : Bool :=
  NCPS.Advanced.evaluate policy (toSeven r) &&
    decide (r.attributionMap = .pass)

/-- End-to-end correspondence for this bounded decoded-value checker and the
    existing modeled gate. The base findings remain unestablished external facts. -/
theorem evaluated_collection_iff (policy : NCPS.Advanced.VerificationPolicy)
    (base : NCPS.Advanced.VerificationReport) (v : DecodedAttributionView) :
    evaluateEight policy (collectReport base v) = true ↔
      NCPS.Advanced.Accepts policy base ∧ FixedAttribution v := by
  simp only [evaluateEight, Bool.and_eq_true, decide_eq_true_eq]
  rw [all_seven_findings_preserved,
    NCPS.ModelClosure.evaluate_eq_true_iff_accepts]
  change NCPS.Advanced.Accepts policy base ∧ attributionFinding v = .pass ↔ _
  rw [attribution_pass_iff_fixed]

theorem invalid_attribution_never_accepted
    (policy : NCPS.Advanced.VerificationPolicy)
    (base : NCPS.Advanced.VerificationReport) (v : DecodedAttributionView)
    (h : ¬ FixedAttribution v) :
    evaluateEight policy (collectReport base v) = false := by
  cases hb : evaluateEight policy (collectReport base v) with
  | false => rfl
  | true => exact False.elim (h ((evaluated_collection_iff policy base v).mp hb).2)

end NCPS.AttributionClosure

#print axioms NCPS.AttributionClosure.check_true_iff_fixed
#print axioms NCPS.AttributionClosure.check_false_iff_not_fixed
#print axioms NCPS.AttributionClosure.fixed_view_valid
#print axioms NCPS.AttributionClosure.fixed_view_accepted
#print axioms NCPS.AttributionClosure.map_member_order_immaterial
#print axioms NCPS.AttributionClosure.reversed_sources_rejected
#print axioms NCPS.AttributionClosure.reversed_people_rejected
#print axioms NCPS.AttributionClosure.unapproved_note_rejected
#print axioms NCPS.AttributionClosure.all_seven_findings_preserved
#print axioms NCPS.AttributionClosure.attribution_pass_iff_fixed
#print axioms NCPS.AttributionClosure.evaluated_collection_iff
#print axioms NCPS.AttributionClosure.invalid_attribution_never_accepted
