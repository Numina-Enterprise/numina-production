"""Durable rc26 evidence storage on the existing Numina PostgreSQL schema.

This adapter stores evidence supplied by the verifier. It neither submits a
transaction nor treats caller assertions as verified provider facts.
"""
from __future__ import annotations
import json,time
from urllib.parse import urlsplit,parse_qs
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from .evidence_network import _root


class PostgresEvidenceStore:
    backend='postgresql'
    durable=True

    def __init__(self,database_url:str):
        database_url=database_url.replace('postgresql+psycopg://','postgresql://',1)
        parsed=urlsplit(database_url)
        if parsed.scheme not in {'postgresql','postgres'}:raise ValueError('POSTGRES_URL_REQUIRED')
        if parse_qs(parsed.query).get('sslmode',[''])[0] not in {'require','verify-ca','verify-full'}:raise ValueError('POSTGRES_TLS_REQUIRED')
        self._database_url=database_url
        # Check existing schema. Never create another production evidence store.
        with self._connect() as connection:
            connection.execute('SELECT record_id,tx_hash,handoff_id,state,artifact_type,artifact_root,artifact_json,created_at,revoked,revocation_json FROM public.numina_evidence_records LIMIT 0')
            connection.execute('SELECT job_id,tx_hash,handoff_id,request_json,status,attempts,next_attempt_at,expires_at,last_error,result_record_id,created_at,updated_at FROM public.numina_verification_jobs LIMIT 0')

    def _connect(self):
        connection=psycopg.connect(self._database_url,row_factory=dict_row,connect_timeout=5)
        connection.execute("SET LOCAL statement_timeout='5000ms'")
        connection.execute("SET LOCAL lock_timeout='2000ms'")
        return connection

    @staticmethod
    def _record(row):
        if row is None:return None
        return {'record_id':row['record_id'],'tx_hash':row['tx_hash'],'handoff_id':row['handoff_id'],'state':row['state'],'artifact_type':row['artifact_type'],'artifact_root':row['artifact_root'],'artifact':row['artifact_json'],'created_at':row['created_at'],'revoked':bool(row['revoked']),'revocation':row['revocation_json']}

    @staticmethod
    def _job(row):
        if row is None:return None
        return {'job_id':row['job_id'],'tx_hash':row['tx_hash'],'handoff_id':row['handoff_id'],'request':row['request_json'],'status':row['status'],'attempts':row['attempts'],'next_attempt_at':row['next_attempt_at'],'expires_at':row['expires_at'],'last_error':row['last_error'],'result_record_id':row['result_record_id'],'created_at':row['created_at'],'updated_at':row['updated_at']}

    def put_artifact(self,*,state:str,artifact_type:str,artifact:dict,tx_hash:str|None=None,handoff_id:str|None=None)->dict:
        if state not in {'REPORTED','VERIFIED','REVOKED','PENDING','PREPARED','SUBMITTED','OBSERVED','INTELLIGENCE','BUNDLED'}:raise ValueError('INVALID_EVIDENCE_STATE')
        if not isinstance(artifact,dict) or not artifact_type:raise ValueError('EVIDENCE_ARTIFACT_REQUIRED')
        root=_root(artifact);tx=tx_hash.lower() if tx_hash else None
        rid=_root({'state':state,'artifact_type':artifact_type,'artifact_root':root,'tx_hash':tx_hash,'handoff_id':handoff_id})
        with self._connect() as c:
            # Serialize conflicting facts for the same transaction and duplicate IDs.
            c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',('numina-evidence:'+str(tx or rid),))
            row=c.execute('SELECT * FROM public.numina_evidence_records WHERE record_id=%s',(rid,)).fetchone()
            if row:return self._record(row)
            if tx and state=='VERIFIED':
                prior=c.execute("SELECT artifact_root FROM public.numina_evidence_records WHERE tx_hash=%s AND state='VERIFIED' AND revoked=false",(tx,)).fetchone()
                if prior and prior['artifact_root']!=root:raise ValueError('CONFLICTING_VERIFIED_SETTLEMENT_FACTS')
            row=c.execute('INSERT INTO public.numina_evidence_records(record_id,tx_hash,handoff_id,state,artifact_type,artifact_root,artifact_json,created_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *',(rid,tx,handoff_id,state,artifact_type,root,Jsonb(artifact),int(time.time()))).fetchone()
            return self._record(row)

    def get_record(self,record_id:str)->dict|None:
        with self._connect() as c:return self._record(c.execute('SELECT * FROM public.numina_evidence_records WHERE record_id=%s',(record_id,)).fetchone())

    def records_for_tx(self,tx_hash:str)->list[dict]:
        with self._connect() as c:return [self._record(row) for row in c.execute('SELECT * FROM public.numina_evidence_records WHERE tx_hash=%s ORDER BY created_at,record_id',(tx_hash.lower(),)).fetchall()]

    def revoke(self,*,record_id:str,revocation:dict)->dict:
        with self._connect() as c:
            prior=c.execute('SELECT * FROM public.numina_evidence_records WHERE record_id=%s FOR UPDATE',(record_id,)).fetchone()
            if prior is None:raise ValueError('EVIDENCE_RECORD_NOT_FOUND')
            if prior['revoked']:return self._record(prior)
            row=c.execute('UPDATE public.numina_evidence_records SET revoked=true,revocation_json=%s WHERE record_id=%s RETURNING *',(Jsonb(revocation),record_id)).fetchone()
            if row is None:raise ValueError('EVIDENCE_RECORD_NOT_FOUND')
            return self._record(row)

    def create_job(self,*,tx_hash:str,handoff_id:str,request_payload:dict,ttl_seconds:int=3600)->dict:
        if not 1<=ttl_seconds<=86400:raise ValueError('INVALID_JOB_TTL')
        now=int(time.time());tx=tx_hash.lower();jid=_root({'tx_hash':tx,'handoff_id':handoff_id,'request_root':_root(request_payload)})
        with self._connect() as c:
            c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',('numina-job:'+handoff_id+':'+tx,))
            prior=c.execute('SELECT * FROM public.numina_verification_jobs WHERE handoff_id=%s AND tx_hash=%s',(handoff_id,tx)).fetchone()
            if prior:
                if prior['request_json']!=request_payload:raise ValueError('VERIFICATION_JOB_CONFLICT')
                return self._job(prior)
            row=c.execute('INSERT INTO public.numina_verification_jobs(job_id,tx_hash,handoff_id,request_json,status,attempts,next_attempt_at,expires_at,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,0,%s,%s,%s,%s) RETURNING *',(jid,tx,handoff_id,Jsonb(request_payload),'PENDING',now,now+ttl_seconds,now,now)).fetchone()
            return self._job(row)

    def get_job(self,jid:str)->dict|None:
        with self._connect() as c:return self._job(c.execute('SELECT * FROM public.numina_verification_jobs WHERE job_id=%s',(jid,)).fetchone())

    def due_jobs(self,*,now:int|None=None,limit:int=25)->list[dict]:
        n=int(time.time()) if now is None else now
        if not 1<=limit<=100:raise ValueError('INVALID_JOB_LIMIT')
        with self._connect() as c:return [self._job(row) for row in c.execute("SELECT * FROM public.numina_verification_jobs WHERE status IN ('PENDING','RETRY') AND next_attempt_at<=%s AND expires_at>%s ORDER BY next_attempt_at,job_id LIMIT %s",(n,n,limit)).fetchall()]

    def mark_job_failure(self,jid:str,error:str,*,base_backoff_seconds:int=5)->dict:
        n=int(time.time())
        with self._connect() as c:
            row=c.execute('SELECT * FROM public.numina_verification_jobs WHERE job_id=%s FOR UPDATE',(jid,)).fetchone()
            if row is None:raise ValueError('VERIFICATION_JOB_NOT_FOUND')
            if row['status']=='VERIFIED':return self._job(row)
            attempts=row['attempts']+1;status='EXPIRED' if n>=row['expires_at'] else 'RETRY'
            next_at=n if status=='EXPIRED' else n+min(base_backoff_seconds*2**min(attempts-1,8),300)
            updated=c.execute('UPDATE public.numina_verification_jobs SET status=%s,attempts=%s,next_attempt_at=%s,last_error=%s,updated_at=%s WHERE job_id=%s RETURNING *',(status,attempts,next_at,str(error)[:500],n,jid)).fetchone()
            return self._job(updated)

    def mark_job_success(self,jid:str,record_id:str)->dict:
        with self._connect() as c:
            job=c.execute('SELECT * FROM public.numina_verification_jobs WHERE job_id=%s FOR UPDATE',(jid,)).fetchone()
            if job is None:raise ValueError('VERIFICATION_JOB_NOT_FOUND')
            record=c.execute('SELECT * FROM public.numina_evidence_records WHERE record_id=%s',(record_id,)).fetchone()
            if not record or record['state']!='VERIFIED' or record['revoked'] or record['tx_hash']!=job['tx_hash'] or record['handoff_id']!=job['handoff_id']:raise ValueError('VERIFIED_JOB_RESULT_REQUIRED')
            if job['status']=='VERIFIED':
                if job['result_record_id']!=record_id:raise ValueError('VERIFICATION_JOB_CONFLICT')
                result=self._job(job)
            else:
                updated=c.execute("UPDATE public.numina_verification_jobs SET status='VERIFIED',attempts=attempts+1,result_record_id=%s,last_error=NULL,updated_at=%s WHERE job_id=%s RETURNING *",(record_id,int(time.time()),jid)).fetchone()
                result=self._job(updated)
            result['record_id']=record_id
            return result
