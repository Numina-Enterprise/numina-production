from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from typing import Any
from .canonical import digest

class Op(str,Enum):
    CHECK_EQ='CHECK_EQ'
    CHECK_LE='CHECK_LE'
    CHECK_IN='CHECK_IN'
    CHECK_NONNEG='CHECK_NONNEG'
    INTERSECT_MAX='INTERSECT_MAX'
    REQUIRE_CURRENT_EPOCH='REQUIRE_CURRENT_EPOCH'
    DECIDE_ALLOW='DECIDE_ALLOW'
    DECIDE_DENY='DECIDE_DENY'
    DECIDE_ESCALATE='DECIDE_ESCALATE'

@dataclass(frozen=True)
class Instruction:
    op:Op
    field:str|None=None
    arg:Any=None

@dataclass(frozen=True)
class AuthorityProgram:
    program_id:str
    constitution_digest:str
    instructions:tuple[Instruction,...]
    def program_digest(self)->str: return digest(self)

class AuthorityVM:
    def execute(self, program:AuthorityProgram, context:dict)->tuple[str,dict]:
        env=dict(context); trace=[]
        for pc,ins in enumerate(program.instructions):
            ok=True
            if ins.op==Op.CHECK_EQ: ok=env.get(ins.field)==ins.arg
            elif ins.op==Op.CHECK_LE: ok=isinstance(env.get(ins.field),int) and env[ins.field] <= ins.arg
            elif ins.op==Op.CHECK_IN: ok=env.get(ins.field) in tuple(ins.arg)
            elif ins.op==Op.CHECK_NONNEG: ok=isinstance(env.get(ins.field),int) and env[ins.field] >= 0
            elif ins.op==Op.INTERSECT_MAX:
                cur=env.get(ins.field); env[ins.field]=min(cur,ins.arg) if isinstance(cur,int) else ins.arg
            elif ins.op==Op.REQUIRE_CURRENT_EPOCH: ok=env.get(ins.field)==ins.arg
            elif ins.op==Op.DECIDE_ALLOW: return 'ALLOW',{'trace':trace,'env':env,'program_digest':program.program_digest()}
            elif ins.op==Op.DECIDE_DENY: return 'DENY',{'trace':trace,'env':env,'program_digest':program.program_digest()}
            elif ins.op==Op.DECIDE_ESCALATE: return 'ESCALATE',{'trace':trace,'env':env,'program_digest':program.program_digest()}
            else: raise RuntimeError('unknown opcode')
            trace.append((pc,ins.op.value,ok))
            if not ok: return 'DENY',{'trace':trace,'env':env,'program_digest':program.program_digest()}
        return 'ESCALATE',{'trace':trace,'env':env,'program_digest':program.program_digest()}
