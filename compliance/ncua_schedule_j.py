"""Fail-closed NCUA Schedule J evidence gate. No regulatory account codes are assumed."""
from dataclasses import dataclass
from typing import Optional

CATEGORIES = {
    "reserve_custody": 8,
    "cryptographic_key_custody_control": 9,
    "issuer_exposure": 5,
    "balance_sheet_stablecoins": 4,
}
STATES = {"UNKNOWN", "DESIGNED", "IMPLEMENTED_UNVERIFIED", "INDEPENDENTLY_VERIFIED", "NOT_APPLICABLE"}

@dataclass(frozen=True)
class EvidenceSlot:
    category: str
    ordinal: int
    official_code: Optional[str] = None
    official_definition: Optional[str] = None
    official_source: Optional[str] = None
    design_ref: Optional[str] = None
    implementation_ref: Optional[str] = None
    independent_verification_ref: Optional[str] = None
    legal_applicability_ref: Optional[str] = None
    state: str = "UNKNOWN"

def empty_registry():
    return tuple(EvidenceSlot(category, i) for category, count in CATEGORIES.items()
                 for i in range(1, count + 1))

def validate_registry(slots):
    slots = tuple(slots)
    expected = {(category, i) for category, count in CATEGORIES.items()
                for i in range(1, count + 1)}
    if len(slots) != 26 or {(s.category, s.ordinal) for s in slots} != expected:
        raise ValueError("Schedule J registry must contain exactly 26 unique categorized slots")
    codes = [s.official_code for s in slots if s.official_code]
    if len(codes) != len(set(codes)):
        raise ValueError("Duplicate official account code")
    for s in slots:
        if s.state not in STATES:
            raise ValueError("Invalid evidence state")
        if any((s.official_code, s.official_definition, s.official_source)) and not all(
            (s.official_code, s.official_definition, s.official_source)
        ):
            raise ValueError("Official account fields require code, definition and source together")
        if s.state == "IMPLEMENTED_UNVERIFIED" and not (s.design_ref and s.implementation_ref):
            raise ValueError("Implementation evidence is missing")
        if s.state == "INDEPENDENTLY_VERIFIED" and not (
            s.design_ref and s.implementation_ref and s.independent_verification_ref
        ):
            raise ValueError("Independent verification evidence is missing")
    return True

def reporting_ready(slots, final_instructions_source=None, legal_approval_ref=None):
    validate_registry(slots)
    return bool(final_instructions_source and legal_approval_ref and all(
        s.official_code and s.official_definition and s.official_source
        and s.legal_applicability_ref and s.state == "INDEPENDENTLY_VERIFIED"
        for s in slots
    ))
