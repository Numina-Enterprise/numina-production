from __future__ import annotations
import sqlite3
from .canonical import canonical_bytes,digest
from .status import SignedStatusWitness

class WitnessHistoryStore:
    def __init__(self,path:str):
        self.db=sqlite3.connect(path,isolation_level=None)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('''CREATE TABLE IF NOT EXISTS witness_history(
            authority_domain_id TEXT NOT NULL,
            witness_id TEXT NOT NULL,
            constitutional_sequence INTEGER NOT NULL,
            status_root TEXT NOT NULL,
            payload BLOB NOT NULL,
            PRIMARY KEY(authority_domain_id,witness_id,constitutional_sequence))''')
        self.db.execute('''CREATE TABLE IF NOT EXISTS highest_seen(
            authority_domain_id TEXT NOT NULL,
            witness_id TEXT NOT NULL,
            constitutional_sequence INTEGER NOT NULL,
            status_root TEXT NOT NULL,
            PRIMARY KEY(authority_domain_id,witness_id))''')
    def append(self,sw:SignedStatusWitness):
        w=sw.witness
        row=self.db.execute('SELECT constitutional_sequence,status_root FROM highest_seen WHERE authority_domain_id=? AND witness_id=?',(w.authority_domain_id,w.witness_id)).fetchone()
        if row and w.constitutional_sequence < row[0]: raise RuntimeError('WITNESS_ROLLBACK')
        if row and w.constitutional_sequence == row[0] and w.status_root != row[1]: raise RuntimeError('WITNESS_EQUIVOCATION')
        payload=canonical_bytes(sw)
        try:
            self.db.execute('BEGIN IMMEDIATE')
            self.db.execute('INSERT OR IGNORE INTO witness_history VALUES(?,?,?,?,?)',(w.authority_domain_id,w.witness_id,w.constitutional_sequence,w.status_root,payload))
            self.db.execute('''INSERT INTO highest_seen VALUES(?,?,?,?)
                ON CONFLICT(authority_domain_id,witness_id) DO UPDATE SET constitutional_sequence=excluded.constitutional_sequence,status_root=excluded.status_root''',
                (w.authority_domain_id,w.witness_id,w.constitutional_sequence,w.status_root))
            self.db.execute('COMMIT')
        except Exception:
            self.db.execute('ROLLBACK'); raise
        return digest(sw)
    def highest(self,domain_id:str,witness_id:str):
        r=self.db.execute('SELECT constitutional_sequence,status_root FROM highest_seen WHERE authority_domain_id=? AND witness_id=?',(domain_id,witness_id)).fetchone()
        return r
    def close(self): self.db.close()
