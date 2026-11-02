from __future__ import annotations
import json
import sqlite3
from dataclasses import asdict, dataclass
from typing import Dict
from .canonical import canonical_bytes, digest
from .eac import SignedEAC, RecognitionProfile, verify as verify_eac
from .program import ProofCarryingProgram, verify_program
from .status import SignedStatusWitness, verify_witness
from .live_conformance import LiveConformanceState, verify_live_conformance
from .vm import AuthorityVM
from .control_mesh import ProofCarryingEndpointContract, EndpointDecision
from .channels import AuthorityChannelPolicy
from .mesh_health import MeshHealthState
from .route_fencing import AuthorityRouteFence

@dataclass(frozen=True)
class NetworkExecutionReceipt:
    operation_id: str
    authorization_id: str
    session_id: str
    route_id: str
    route_epoch: int
    obligation_id: str
    program_digest: str
    status_root: str
    context_digest: str
    commit_digest: str
    conformance_root: str

    @property
    def receipt_digest(self) -> str:
        return digest(self)


class ContinuousConstitutionalRuntime:
    """Single-node reference linearization point for a Numina mesh commit.

    All economically coupled mutations cross one SQLite BEGIN IMMEDIATE transaction:
    EAC nonce consumption, authority-session occupancy, operation creation, and bilateral
    obligation creation. Verification happens before the transaction; state-dependent
    uniqueness/capacity/fence checks are repeated inside it.
    """
    def __init__(self, path: str, *, vm: AuthorityVM, eac_public_keys: Dict[str, object],
                 program_public_key, witness_public_key, required_constitution_digest: str,
                 expected_compiler_digest: str | None = None):
        self.db = sqlite3.connect(path, isolation_level=None)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.vm = vm
        self.eac_public_keys = dict(eac_public_keys)
        self.program_public_key = program_public_key
        self.witness_public_key = witness_public_key
        self.required_constitution_digest = required_constitution_digest
        self.expected_compiler_digest = expected_compiler_digest
        self._schema()

    def _schema(self):
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS sessions(
          session_id TEXT PRIMARY KEY, policy_json TEXT NOT NULL, opened_sequence INTEGER NOT NULL,
          consumed INTEGER NOT NULL DEFAULT 0, velocity_consumed INTEGER NOT NULL DEFAULT 0,
          closed INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS session_nonces(session_id TEXT NOT NULL, nonce TEXT NOT NULL,
          PRIMARY KEY(session_id, nonce));
        CREATE TABLE IF NOT EXISTS eac_nonces(nonce TEXT PRIMARY KEY, authorization_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS operations(operation_id TEXT PRIMARY KEY,
          authorization_id TEXT UNIQUE NOT NULL, session_id TEXT NOT NULL, route_id TEXT NOT NULL,
          route_epoch INTEGER NOT NULL, payload BLOB NOT NULL, digest TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS obligations(obligation_id TEXT PRIMARY KEY,
          creditor_domain TEXT NOT NULL, debtor_domain TEXT NOT NULL, resource TEXT NOT NULL,
          amount_minor INTEGER NOT NULL, authorization_id TEXT NOT NULL, operation_id TEXT UNIQUE NOT NULL,
          state TEXT NOT NULL, evidence_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS route_fences(route_id TEXT PRIMARY KEY, source_domain TEXT NOT NULL,
          destination_domain TEXT NOT NULL, epoch INTEGER NOT NULL, active INTEGER NOT NULL);
        ''')

    def open_session(self, session_id: str, policy: AuthorityChannelPolicy, opened_sequence: int):
        self.db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?)',(
            session_id, json.dumps({**asdict(policy), 'authority_classes': sorted(policy.authority_classes)}, sort_keys=True),
            opened_sequence, 0, 0, 0))

    def set_route_fence(self, fence: AuthorityRouteFence):
        current = self.db.execute('SELECT epoch FROM route_fences WHERE route_id=?',(fence.route_id,)).fetchone()
        if current and fence.epoch < current[0]:
            raise ValueError('ROUTE_EPOCH_ROLLBACK')
        self.db.execute('INSERT OR REPLACE INTO route_fences VALUES(?,?,?,?,?)',(
            fence.route_id, fence.source_domain, fence.destination_domain, fence.epoch, int(fence.active)))

    def close_session(self, session_id: str):
        self.db.execute('UPDATE sessions SET closed=1 WHERE session_id=?',(session_id,))

    def session_state(self, session_id: str):
        return self.db.execute('SELECT consumed,velocity_consumed,closed FROM sessions WHERE session_id=?',(session_id,)).fetchone()

    def obligation_state(self, obligation_id: str):
        return self.db.execute('SELECT state,amount_minor,evidence_json FROM obligations WHERE obligation_id=?',(obligation_id,)).fetchone()

    def reconcile_obligation(self, obligation_id: str, *, target_state: str, evidence_ref: str) -> tuple[bool,str]:
        order = {'BILATERALLY_COMMITTED':0,'EXECUTED':1,'SETTLED':2,'FINAL':3}
        try:
            self.db.execute('BEGIN IMMEDIATE')
            row=self.db.execute('SELECT state,evidence_json FROM obligations WHERE obligation_id=?',(obligation_id,)).fetchone()
            if not row:
                self.db.execute('ROLLBACK'); return False,'OBLIGATION_NOT_FOUND'
            state,evidence_json=row
            if state=='FINAL':
                self.db.execute('ROLLBACK'); return False,'FINAL_OBLIGATION_IMMUTABLE'
            ev=set(json.loads(evidence_json)); ev.add(evidence_ref)
            if target_state=='DISPUTED':
                self.db.execute('UPDATE obligations SET state=?,evidence_json=? WHERE obligation_id=?',('DISPUTED',json.dumps(sorted(ev)),obligation_id))
                self.db.execute('COMMIT'); return True,'OK'
            if state=='DISPUTED':
                self.db.execute('ROLLBACK'); return False,'DISPUTE_REQUIRES_RECONCILIATION'
            if target_state not in order or order.get(target_state) != order.get(state,-99)+1:
                self.db.execute('ROLLBACK'); return False,'INVALID_OBLIGATION_TRANSITION'
            self.db.execute('UPDATE obligations SET state=?,evidence_json=? WHERE obligation_id=?',(target_state,json.dumps(sorted(ev)),obligation_id))
            self.db.execute('COMMIT'); return True,'OK'
        except Exception:
            try:self.db.execute('ROLLBACK')
            except Exception:pass
            raise

    def execute(self, *, signed_eac: SignedEAC, recognition_profile: RecognitionProfile,
                endpoint: ProofCarryingEndpointContract, authority_class: str, consequence_usd_minor: int,
                status_age_ms: int, proof_program: ProofCarryingProgram, witness: SignedStatusWitness,
                conformance: LiveConformanceState, current_sequence: int, highest_seen_witness: int,
                expected_prev_witness: str | None, context: dict, session_id: str, route_id: str,
                route_epoch: int, obligation_id: str, creditor_domain: str, debtor_domain: str,
                risk_adding: bool, health: MeshHealthState):
        e = signed_eac.credential
        pk = self.eac_public_keys.get(e.issuer_id)
        if pk is None: return 'UNRECOGNIZED_ISSUER_KEY', None
        consumed = {r[0] for r in self.db.execute('SELECT nonce FROM eac_nonces')}
        ok, reason = verify_eac(signed_eac, pk, recognition_profile, current_sequence, consumed)
        if not ok: return reason, None
        if e.constitution_digest != self.required_constitution_digest: return 'CONSTITUTION_MISMATCH', None
        if e.operation_id == '' or e.authorization_id == '': return 'INVALID_OPERATION_BINDING', None
        if consequence_usd_minor > e.max_notional_usd_minor: return 'EAC_CONSEQUENCE_BOUND_EXCEEDED', None
        ep_decision, ep_reason = endpoint.verify_request(
            authority_class=authority_class, consequence_usd_minor=consequence_usd_minor,
            constitution_digest=e.constitution_digest, issuer=e.issuer_id, status_age_ms=status_age_ms)
        if ep_decision != EndpointDecision.VALID_FOR_COMMIT: return ep_reason, None
        ok, reason = verify_program(proof_program, self.program_public_key, self.required_constitution_digest, self.expected_compiler_digest)
        if not ok: return reason, None
        ok, reason = verify_witness(witness, self.witness_public_key, current_sequence, highest_seen_witness, expected_prev_witness)
        if not ok: return reason, None
        if witness.witness.dependency_closure_root != e.dependency_root: return 'DEPENDENCY_ROOT_MISMATCH', None
        ok, reason = verify_live_conformance(conformance, required_constitution_digest=self.required_constitution_digest,
                                             required_program_digest=proof_program.program.program_digest())
        if not ok: return reason, None
        decision, trace = self.vm.execute(proof_program.program, context)
        if decision != 'ALLOW': return decision, None

        try:
            self.db.execute('BEGIN IMMEDIATE')
            fence = self.db.execute('SELECT source_domain,destination_domain,epoch,active FROM route_fences WHERE route_id=?',(route_id,)).fetchone()
            if not fence or not fence[3]: raise RuntimeError('ROUTE_FENCED')
            if fence[2] != route_epoch: raise RuntimeError('STALE_ROUTE_EPOCH')
            if fence[0] != debtor_domain or fence[1] != creditor_domain: raise RuntimeError('ROUTE_DOMAIN_MISMATCH')
            row = self.db.execute('SELECT policy_json,consumed,velocity_consumed,closed FROM sessions WHERE session_id=?',(session_id,)).fetchone()
            if not row: raise RuntimeError('SESSION_NOT_FOUND')
            pdata=json.loads(row[0]); consumed_amt=row[1]; velocity=row[2]; closed=bool(row[3])
            if closed: raise RuntimeError('SESSION_CLOSED')
            if current_sequence > pdata['expiry_sequence']: raise RuntimeError('SESSION_EXPIRED')
            if authority_class not in pdata['authority_classes']: raise RuntimeError('SESSION_AUTHORITY_CLASS_DENIED')
            if consequence_usd_minor < 0: raise RuntimeError('NEGATIVE_CONSEQUENCE')
            if consequence_usd_minor > pdata['per_operation_limit_usd_minor']: raise RuntimeError('SESSION_PER_OPERATION_BOUND_EXCEEDED')
            health_limit = health.effective_limit(pdata['per_operation_limit_usd_minor'], risk_adding=risk_adding)
            if consequence_usd_minor > health_limit: raise RuntimeError('HEALTH_CONTRACTION_DENY')
            if pdata['source_domain'] != debtor_domain or pdata['destination_domain'] != creditor_domain: raise RuntimeError('SESSION_DOMAIN_MISMATCH')
            if consumed_amt + consequence_usd_minor > pdata['aggregate_limit_usd_minor']: raise RuntimeError('SESSION_AGGREGATE_BOUND_EXCEEDED')
            if velocity + consequence_usd_minor > pdata['velocity_limit_usd_minor_per_window']: raise RuntimeError('SESSION_VELOCITY_BOUND_EXCEEDED')
            if self.db.execute('SELECT 1 FROM eac_nonces WHERE nonce=?',(e.nonce,)).fetchone(): raise RuntimeError('NONCE_ALREADY_CONSUMED')
            if self.db.execute('SELECT 1 FROM session_nonces WHERE session_id=? AND nonce=?',(session_id,e.nonce)).fetchone(): raise RuntimeError('SESSION_NONCE_REPLAY')
            payload={
              'operation_id':e.operation_id,'authorization_id':e.authorization_id,'session_id':session_id,
              'route_id':route_id,'route_epoch':route_epoch,'program_digest':proof_program.program.program_digest(),
              'status_root':witness.witness.status_root,'context_digest':digest(context),
              'conformance_root':conformance.conformance_root,'vm_trace_digest':digest(trace),
              'consequence_usd_minor':consequence_usd_minor,'health_state':health.state.value,
            }
            b=canonical_bytes(payload); cd=digest(payload)
            self.db.execute('INSERT INTO eac_nonces VALUES(?,?)',(e.nonce,e.authorization_id))
            self.db.execute('INSERT INTO session_nonces VALUES(?,?)',(session_id,e.nonce))
            self.db.execute('UPDATE sessions SET consumed=?,velocity_consumed=? WHERE session_id=?',(
                consumed_amt+consequence_usd_minor,velocity+consequence_usd_minor,session_id))
            self.db.execute('INSERT INTO operations VALUES(?,?,?,?,?,?,?)',(
                e.operation_id,e.authorization_id,session_id,route_id,route_epoch,b,cd))
            self.db.execute('INSERT INTO obligations VALUES(?,?,?,?,?,?,?,?,?)',(
                obligation_id,creditor_domain,debtor_domain,'USD',consequence_usd_minor,e.authorization_id,e.operation_id,
                'BILATERALLY_COMMITTED',json.dumps([])))
            self.db.execute('COMMIT')
        except RuntimeError as ex:
            self.db.execute('ROLLBACK')
            return str(ex), None
        except sqlite3.IntegrityError:
            self.db.execute('ROLLBACK')
            return 'ATOMIC_UNIQUENESS_VIOLATION', None
        except Exception:
            try:self.db.execute('ROLLBACK')
            except Exception:pass
            raise
        receipt=NetworkExecutionReceipt(e.operation_id,e.authorization_id,session_id,route_id,route_epoch,obligation_id,
            proof_program.program.program_digest(),witness.witness.status_root,digest(context),cd,conformance.conformance_root)
        return 'COMMITTED',receipt

    def close(self):
        self.db.close()
