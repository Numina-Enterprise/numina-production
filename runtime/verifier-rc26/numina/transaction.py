from __future__ import annotations
import sqlite3
from .canonical import canonical_bytes,digest

class AtomicCommitEngine:
    """Reference atomic nonce/operation commitment store.
    SQLite transaction is the linearization boundary for BEGIN_COMMIT.
    """
    def __init__(self,path:str):
        self.db=sqlite3.connect(path,isolation_level=None)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS nonces(nonce TEXT PRIMARY KEY, operation_id TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS operations(operation_id TEXT PRIMARY KEY, authorization_id TEXT UNIQUE NOT NULL, phase TEXT NOT NULL, payload BLOB NOT NULL, digest TEXT NOT NULL)')
    def begin_commit(self,operation_id:str,authorization_id:str,nonce:str,payload:dict):
        b=canonical_bytes(payload); d=digest(payload)
        try:
            self.db.execute('BEGIN IMMEDIATE')
            self.db.execute('INSERT INTO nonces VALUES(?,?)',(nonce,operation_id))
            self.db.execute('INSERT INTO operations VALUES(?,?,?,?,?)',(operation_id,authorization_id,'COMMITTING',b,d))
            self.db.execute('COMMIT')
        except Exception:
            self.db.execute('ROLLBACK'); raise
        return d
    def phase(self,operation_id:str):
        r=self.db.execute('SELECT phase FROM operations WHERE operation_id=?',(operation_id,)).fetchone(); return r[0] if r else None
    def close(self): self.db.close()
