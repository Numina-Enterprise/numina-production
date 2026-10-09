from __future__ import annotations
from dataclasses import dataclass
from hashlib import sha256
import json, sqlite3, time
from pathlib import Path
from typing import Iterable
from .execution_adapters import digest, EXECUTION_HANDOFF_TYPE
from .circle_agent_adapter import PROVIDER_SUBMISSION_TYPE
from .arc_verification import EXECUTION_VERIFIED_TYPE
from .signing import verify_envelope

EVIDENCE_BUNDLE_TYPE='NUMINA_EVIDENCE_BUNDLE'
INTELLIGENCE_EVIDENCE_TYPE='NUMINA_INTELLIGENCE_EVIDENCE'
REVOCATION_TYPE='NUMINA_EVIDENCE_REVOCATION'
SUPPORTED_INTELLIGENCE_PROVIDERS=frozenset({'trm','elliptic','chainalysis'})

def _canon(v:dict)->bytes:return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def _root(v:dict)->str:return sha256(_canon(v)).hexdigest()

def normalize_intelligence_evidence(*,provider:str,subject:dict,evidence:dict,observed_at:int|None=None)->dict:
    p=(provider or '').strip().lower()
    if p not in SUPPORTED_INTELLIGENCE_PROVIDERS: raise ValueError('UNSUPPORTED_INTELLIGENCE_PROVIDER')
    if not isinstance(subject,dict) or not subject: raise ValueError('INTELLIGENCE_SUBJECT_REQUIRED')
    if not isinstance(evidence,dict) or not evidence: raise ValueError('INTELLIGENCE_EVIDENCE_REQUIRED')
    out={'schema':'numina.intelligence-evidence.v1','provider':p,'subject':subject,'subject_root':_root(subject),'evidence':evidence,'evidence_root':_root(evidence),'observed_at':int(observed_at or time.time()),'source_assertion':'PROVIDER_OR_CALLER_ASSERTED','numina_interpretation':'EVIDENCE_INPUT_ONLY','execution_authority_granted':False}
    out['intelligence_evidence_root']=_root(out);return out

@dataclass(frozen=True)
class EvidenceStoreConfig: path:Path

class EvidenceStore:
    backend='sqlite'
    durable=False
    def __init__(self,config:EvidenceStoreConfig):
        self.path=config.path;self.path.parent.mkdir(parents=True,exist_ok=True);self._init()
    def _connect(self):
        c=sqlite3.connect(self.path,timeout=5);c.row_factory=sqlite3.Row;return c
    def _init(self):
        with self._connect() as c:
            c.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS evidence_records(record_id TEXT PRIMARY KEY,tx_hash TEXT,handoff_id TEXT,state TEXT NOT NULL,artifact_type TEXT NOT NULL,artifact_root TEXT NOT NULL,artifact_json TEXT NOT NULL,created_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,revocation_json TEXT);
            CREATE UNIQUE INDEX IF NOT EXISTS ux_verified_tx ON evidence_records(tx_hash,state) WHERE tx_hash IS NOT NULL AND state='VERIFIED' AND revoked=0;
            CREATE TABLE IF NOT EXISTS verification_jobs(job_id TEXT PRIMARY KEY,tx_hash TEXT NOT NULL,handoff_id TEXT NOT NULL,request_json TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,last_error TEXT,result_record_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS ux_job_handoff_tx ON verification_jobs(handoff_id,tx_hash);
            ''')
    def _record(self,row):
        return {'record_id':row['record_id'],'tx_hash':row['tx_hash'],'handoff_id':row['handoff_id'],'state':row['state'],'artifact_type':row['artifact_type'],'artifact_root':row['artifact_root'],'artifact':json.loads(row['artifact_json']),'created_at':row['created_at'],'revoked':bool(row['revoked']),'revocation':json.loads(row['revocation_json']) if row['revocation_json'] else None}
    def put_artifact(self,*,state:str,artifact_type:str,artifact:dict,tx_hash:str|None=None,handoff_id:str|None=None)->dict:
        now=int(time.time());root=_root(artifact);rid=_root({'state':state,'artifact_type':artifact_type,'artifact_root':root,'tx_hash':tx_hash,'handoff_id':handoff_id});tx=tx_hash.lower() if tx_hash else None
        with self._connect() as c:
            row=c.execute('SELECT * FROM evidence_records WHERE record_id=?',(rid,)).fetchone()
            if row:return self._record(row)
            if tx and state=='VERIFIED':
                prior=c.execute("SELECT artifact_root FROM evidence_records WHERE tx_hash=? AND state='VERIFIED' AND revoked=0",(tx,)).fetchone()
                if prior and prior['artifact_root']!=root:raise ValueError('CONFLICTING_VERIFIED_SETTLEMENT_FACTS')
            c.execute('INSERT INTO evidence_records(record_id,tx_hash,handoff_id,state,artifact_type,artifact_root,artifact_json,created_at) VALUES(?,?,?,?,?,?,?,?)',(rid,tx,handoff_id,state,artifact_type,root,json.dumps(artifact,sort_keys=True),now))
            return self._record(c.execute('SELECT * FROM evidence_records WHERE record_id=?',(rid,)).fetchone())
    def get_record(self,record_id:str)->dict|None:
        with self._connect() as c:
            r=c.execute('SELECT * FROM evidence_records WHERE record_id=?',(record_id,)).fetchone();return self._record(r) if r else None
    def records_for_tx(self,tx_hash:str)->list[dict]:
        with self._connect() as c:return [self._record(r) for r in c.execute('SELECT * FROM evidence_records WHERE tx_hash=? ORDER BY created_at,record_id',(tx_hash.lower(),)).fetchall()]
    def revoke(self,*,record_id:str,revocation:dict)->dict:
        with self._connect() as c:
            c.execute('BEGIN IMMEDIATE')
            prior=c.execute('SELECT * FROM evidence_records WHERE record_id=?',(record_id,)).fetchone()
            if not prior:raise ValueError('EVIDENCE_RECORD_NOT_FOUND')
            if prior['revoked']:return self._record(prior)
            c.execute('UPDATE evidence_records SET revoked=1,revocation_json=? WHERE record_id=?',(json.dumps(revocation,sort_keys=True),record_id))
            return self._record(c.execute('SELECT * FROM evidence_records WHERE record_id=?',(record_id,)).fetchone())
    def create_job(self,*,tx_hash:str,handoff_id:str,request_payload:dict,ttl_seconds:int=3600)->dict:
        now=int(time.time());tx=tx_hash.lower();jid=_root({'tx_hash':tx,'handoff_id':handoff_id,'request_root':_root(request_payload)})
        with self._connect() as c:
            r=c.execute('SELECT * FROM verification_jobs WHERE handoff_id=? AND tx_hash=?',(handoff_id,tx)).fetchone()
            if r:return self._job(r)
            c.execute('INSERT INTO verification_jobs(job_id,tx_hash,handoff_id,request_json,status,attempts,next_attempt_at,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(jid,tx,handoff_id,json.dumps(request_payload,sort_keys=True),'PENDING',0,now,now+ttl_seconds,now,now))
        return self.get_job(jid)
    def _job(self,r):return {'job_id':r['job_id'],'tx_hash':r['tx_hash'],'handoff_id':r['handoff_id'],'request':json.loads(r['request_json']),'status':r['status'],'attempts':r['attempts'],'next_attempt_at':r['next_attempt_at'],'expires_at':r['expires_at'],'last_error':r['last_error'],'result_record_id':r['result_record_id'],'created_at':r['created_at'],'updated_at':r['updated_at']}
    def get_job(self,jid:str)->dict|None:
        with self._connect() as c:
            r=c.execute('SELECT * FROM verification_jobs WHERE job_id=?',(jid,)).fetchone();return self._job(r) if r else None
    def due_jobs(self,*,now:int|None=None,limit:int=25)->list[dict]:
        n=int(now or time.time())
        with self._connect() as c:return [self._job(r) for r in c.execute("SELECT * FROM verification_jobs WHERE status IN ('PENDING','RETRY') AND next_attempt_at<=? AND expires_at>? ORDER BY next_attempt_at LIMIT ?",(n,n,limit)).fetchall()]
    def mark_job_failure(self,jid:str,error:str,*,base_backoff_seconds:int=5)->dict:
        n=int(time.time())
        with self._connect() as c:
            r=c.execute('SELECT * FROM verification_jobs WHERE job_id=?',(jid,)).fetchone()
            if not r:raise ValueError('VERIFICATION_JOB_NOT_FOUND')
            attempts=int(r['attempts'])+1;status='EXPIRED' if n>=int(r['expires_at']) else 'RETRY';next_at=n if status=='EXPIRED' else n+min(base_backoff_seconds*(2**min(attempts-1,8)),300)
            c.execute('UPDATE verification_jobs SET status=?,attempts=?,next_attempt_at=?,last_error=?,updated_at=? WHERE job_id=?',(status,attempts,next_at,error[:500],n,jid))
        return self.get_job(jid)
    def mark_job_success(self,jid:str,record_id:str)->dict:
        n=int(time.time())
        with self._connect() as c:
            if not c.execute('SELECT 1 FROM verification_jobs WHERE job_id=?',(jid,)).fetchone():raise ValueError('VERIFICATION_JOB_NOT_FOUND')
            c.execute("UPDATE verification_jobs SET status='VERIFIED',attempts=attempts+1,result_record_id=?,last_error=NULL,updated_at=? WHERE job_id=?",(record_id,n,jid))
        job=self.get_job(jid)
        if job is not None: job['record_id']=record_id
        return job

def build_evidence_bundle(*,control_receipt:dict,handoff_receipt:dict,submission_receipt:dict,verification_receipt:dict,intelligence_receipts:Iterable[dict],trusted_numina_public_key_b64:str)->dict:
    for env,typ in [(control_receipt,'NUMINA_CONTROL_DECISION'),(handoff_receipt,EXECUTION_HANDOFF_TYPE),(submission_receipt,PROVIDER_SUBMISSION_TYPE),(verification_receipt,EXECUTION_VERIFIED_TYPE)]:
        if not verify_envelope(env,expected_public_key_b64=trusted_numina_public_key_b64,expected_type=typ):raise ValueError(f'{typ}_INVALID')
    handoff=handoff_receipt['payload'];sub=submission_receipt['payload'];ver=verification_receipt['payload']
    if sub.get('handoff_id')!=handoff.get('handoff_id') or ver.get('handoff_id')!=handoff.get('handoff_id'):raise ValueError('EVIDENCE_BUNDLE_HANDOFF_MISMATCH')
    if ver.get('tx_hash')!=str(sub.get('tx_hash') or '').lower():raise ValueError('EVIDENCE_BUNDLE_TX_MISMATCH')
    intel=list(intelligence_receipts or [])
    for env in intel:
        if not verify_envelope(env,expected_public_key_b64=trusted_numina_public_key_b64,expected_type=INTELLIGENCE_EVIDENCE_TYPE):raise ValueError('INTELLIGENCE_EVIDENCE_RECEIPT_INVALID')
    b={'schema':'numina.evidence-bundle.v1','status':'VERIFIED_EVIDENCE_BUNDLE','handoff_id':handoff.get('handoff_id'),'tx_hash':ver.get('tx_hash'),'network':ver.get('network'),'roots':{'control_receipt':digest(control_receipt),'handoff_receipt':digest(handoff_receipt),'provider_submission_receipt':digest(submission_receipt),'execution_verification_receipt':digest(verification_receipt),'intelligence_receipts':[digest(x) for x in intel]},'independent_network_fact_root':ver.get('independent_network_fact_root'),'provider_claim_used_as_settlement_truth':False,'portable':True}
    b['bundle_root']=_root(b);return b


def create_evidence_store(*,path:Path,database_url:str|None=None):
    if database_url:
        from .evidence_store_postgres import PostgresEvidenceStore
        return PostgresEvidenceStore(database_url)
    return EvidenceStore(EvidenceStoreConfig(path))
