import os,tempfile
import pytest
from dataclasses import replace
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from numina.status import StatusWitness,sign_witness
from numina.proof_plane import WitnessQuorumPolicy,verify_witness_quorum,detect_equivocation
from numina.witness_store import WitnessHistoryStore
from numina.store import SQLiteEventStore
from numina.recovery import build_replay_recovery_proof,verify_replay_recovery_proof
from numina.shards import ShardAllocator
from numina.migration import migrate_clear_shard
from numina.conformance_bundle import ConformanceBundle,sign_conformance_bundle,verify_conformance_bundle
from numina.canonical import digest


def mk_witness(wid,sk,root='dep',seq=10,status='CURRENT',prev='p'):
    return sign_witness(StatusWitness('D',seq,root,status,prev,seq+100,wid),sk)

def test_quorum_accepts_common_root():
    keys={x:Ed25519PrivateKey.generate() for x in ('w1','w2','w3')}
    ss=[mk_witness(w,keys[w]) for w in keys]
    ok,reason,p=verify_witness_quorum(signed_witnesses=ss,public_keys={w:k.public_key() for w,k in keys.items()},policy=WitnessQuorumPolicy(2,tuple(keys)),current_sequence=11)
    assert ok and reason=='QUORUM_CURRENT' and len(p.witness_ids)==2

def test_quorum_rejects_insufficient_signers():
    sk=Ed25519PrivateKey.generate(); sw=mk_witness('w1',sk)
    ok,reason,_=verify_witness_quorum(signed_witnesses=[sw],public_keys={'w1':sk.public_key()},policy=WitnessQuorumPolicy(2,('w1','w2')),current_sequence=11)
    assert not ok and reason=='INSUFFICIENT_WITNESS_QUORUM'

def test_equivocation_detected_same_domain_sequence_different_root():
    a,b=Ed25519PrivateKey.generate(),Ed25519PrivateKey.generate()
    x=mk_witness('w1',a,root='A'); y=mk_witness('w2',b,root='B')
    eq=detect_equivocation([x,y]); assert eq is not None and eq.left_status_root != eq.right_status_root

def test_witness_store_blocks_rollback():
    p=tempfile.mktemp(); sk=Ed25519PrivateKey.generate(); st=WitnessHistoryStore(p)
    try:
        st.append(mk_witness('w',sk,seq=10));
        with pytest.raises(RuntimeError,match='WITNESS_ROLLBACK'): st.append(mk_witness('w',sk,seq=9))
    finally: st.close(); os.remove(p)

def test_witness_store_blocks_same_sequence_equivocation():
    p=tempfile.mktemp(); sk=Ed25519PrivateKey.generate(); st=WitnessHistoryStore(p)
    try:
        st.append(mk_witness('w',sk,root='A',seq=10))
        with pytest.raises(RuntimeError,match='WITNESS_EQUIVOCATION'): st.append(mk_witness('w',sk,root='B',seq=10))
    finally: st.close(); os.remove(p)

def test_recovery_proof_verifies_chain():
    p=tempfile.mktemp(); s=SQLiteEventStore(p); init='0'*64; post='1'*64
    try:
        s.append(1,'X','op',{'x':1},init,post)
        proof=build_replay_recovery_proof(event_store=s,initial_state_digest=init,terminal_state_digest=post,constitution_digest='c',build_digest='b')
        ok,reason=verify_replay_recovery_proof(proof,expected_constitution_digest='c',expected_build_digest='b')
        assert ok and reason=='RECOVERY_PROOF_VALID' and proof.event_count==1
    finally: s.close(); os.remove(p)

def test_recovery_proof_rejects_wrong_terminal():
    p=tempfile.mktemp(); s=SQLiteEventStore(p); init='0'*64
    try:
        s.append(1,'X','op',{'x':1},init,'1'*64)
        with pytest.raises(RuntimeError,match='TERMINAL_STATE_MISMATCH'):
            build_replay_recovery_proof(event_store=s,initial_state_digest=init,terminal_state_digest='2'*64,constitution_digest='c',build_digest='b')
    finally: s.close(); os.remove(p)

def test_proof_carrying_shard_migration_has_zero_overlap():
    a=ShardAllocator(1000); s=a.allocate('A',700)
    dest,proof=migrate_clear_shard(allocator=a,source_id='A',destination_id='B')
    assert not s.live and dest.live and dest.capacity_usd_minor==700
    assert sum(x.capacity_usd_minor for x in a.shards.values() if x.live)==700
    assert proof.capacity_usd_minor==700

def test_occupied_shard_cannot_migrate():
    a=ShardAllocator(1000); s=a.allocate('A',700); s.reserve(100,s.fencing_epoch)
    with pytest.raises(RuntimeError,match='SHARD_NOT_CLEAR'): migrate_clear_shard(allocator=a,source_id='A',destination_id='B')

def test_signed_conformance_bundle_validates():
    sk=Ed25519PrivateKey.generate(); b=ConformanceBundle('impl','build','constitution','sem','tv',54,0,'vm',100)
    sb=sign_conformance_bundle(b,'signer',sk)
    ok,reason=verify_conformance_bundle(sb,sk.public_key(),required_constitution_digest='constitution',min_passing_tests=50)
    assert ok and reason=='CONFORMANCE_BUNDLE_VALID'

def test_conformance_bundle_signature_tamper_rejected():
    sk=Ed25519PrivateKey.generate(); b=ConformanceBundle('impl','build','constitution','sem','tv',54,0,'vm',100)
    sb=sign_conformance_bundle(b,'signer',sk)
    bad=replace(sb,signature_hex='00'*64)
    ok,reason=verify_conformance_bundle(bad,sk.public_key(),required_constitution_digest='constitution')
    assert not ok and reason=='INVALID_CONFORMANCE_SIGNATURE'

def test_conformance_bundle_failing_tests_rejected():
    sk=Ed25519PrivateKey.generate(); b=ConformanceBundle('impl','build','constitution','sem','tv',54,1,'vm',100)
    sb=sign_conformance_bundle(b,'signer',sk)
    ok,reason=verify_conformance_bundle(sb,sk.public_key(),required_constitution_digest='constitution')
    assert not ok and reason=='CONFORMANCE_UNHEALTHY'
