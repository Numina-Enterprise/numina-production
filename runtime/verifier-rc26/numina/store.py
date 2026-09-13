from __future__ import annotations
import sqlite3, json
from pathlib import Path
from .canonical import canonical_bytes, digest

class SQLiteEventStore:
    def __init__(self, path: str):
        self.path = path
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, operation_id TEXT NOT NULL, payload TEXT NOT NULL, pre_digest TEXT NOT NULL, post_digest TEXT NOT NULL, event_digest TEXT NOT NULL UNIQUE)")
        self.db.execute("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)")
        self.db.commit()
    def append(self, seq:int, kind:str, operation_id:str, payload:dict, pre:str, post:str):
        body={"seq":seq,"kind":kind,"operation_id":operation_id,"payload":payload,"pre":pre,"post":post}; ed=digest(body)
        with self.db:
            last=self.db.execute("SELECT v FROM meta WHERE k='last_post'").fetchone()
            if last and last[0] != pre: raise RuntimeError("event-chain precondition failed")
            self.db.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?)",(seq,kind,operation_id,canonical_bytes(payload).decode(),pre,post,ed))
            self.db.execute("INSERT INTO meta(k,v) VALUES('last_post',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",(post,))
        return ed
    def close(self):
        self.db.close()
    def __enter__(self): return self
    def __exit__(self, exc_type, exc, tb): self.close()
    def rows(self):
        return self.db.execute("SELECT seq,kind,operation_id,payload,pre_digest,post_digest,event_digest FROM events ORDER BY seq").fetchall()
    def verify_chain(self, initial_digest:str) -> bool:
        prev=initial_digest
        for seq,kind,op,payload,pre,post,ed in self.rows():
            if pre != prev: return False
            body={"seq":seq,"kind":kind,"operation_id":op,"payload":json.loads(payload),"pre":pre,"post":post}
            if digest(body)!=ed: return False
            prev=post
        return True
