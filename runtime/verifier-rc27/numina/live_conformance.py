from __future__ import annotations
from dataclasses import dataclass
from .canonical import digest

@dataclass(frozen=True)
class LiveConformanceState:
    build_digest:str
    constitution_digest:str
    semantic_registry_digest:str
    program_digest:str
    status_root:str
    test_vector_digest:str
    passing_tests:int
    failing_tests:int

    @property
    def conformance_root(self)->str:
        return digest(self)

    @property
    def healthy(self)->bool:
        return self.failing_tests==0 and self.passing_tests>0


def verify_live_conformance(state:LiveConformanceState, *, required_constitution_digest:str,
                            required_program_digest:str|None=None):
    if state.constitution_digest != required_constitution_digest:
        return False,'CONSTITUTION_MISMATCH'
    if required_program_digest is not None and state.program_digest != required_program_digest:
        return False,'PROGRAM_MISMATCH'
    if not state.healthy:
        return False,'CONFORMANCE_UNHEALTHY'
    return True,'CONFORMANT'
