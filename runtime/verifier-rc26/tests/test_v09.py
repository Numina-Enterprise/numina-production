from dataclasses import replace
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from numina.checkpoints import *
from numina.peer_reconciliation import *
from numina.route_state import *
from numina.network_contraction import *
from numina.channel_recovery import *
from numina.network_attestation import *
from numina.mesh_health import MeshHealth, MeshHealthState


def test_replicated_checkpoint_quorum_agrees_on_one_constitutional_state():
    keys={x:Ed25519PrivateKey.generate() for x in ('a','b','c')}
    signed=[]
    for sid in keys:
        cp=ConstitutionalCheckpoint('D',20,'s'*64,'e'*64,'c'*64,'0'*64,sid)
        signed.append(sign_checkpoint(cp,keys[sid]))
    ok,reason,p=verify_checkpoint_quorum(signed,{k:v.public_key() for k,v in keys.items()},required=2,allowed_signers=set(keys),required_constitution='c'*64)
    assert ok and reason=='CHECKPOINT_QUORUM_VALID' and len(p.signer_ids)==2


def test_checkpoint_quorum_refuses_divergent_state():
    keys={x:Ed25519PrivateKey.generate() for x in ('a','b')}
    xs=[sign_checkpoint(ConstitutionalCheckpoint('D',20,ch*64,'e'*64,'c'*64,'0'*64,sid),keys[sid]) for sid,ch in [('a','1'),('b','2')]]
    assert verify_checkpoint_quorum(xs,{k:v.public_key() for k,v in keys.items()},required=2,allowed_signers=set(keys))[1]=='NO_COMMON_CHECKPOINT_ROOT'


def test_checkpoint_rollback_rejected():
    sk=Ed25519PrivateKey.generate(); s=sign_checkpoint(ConstitutionalCheckpoint('D',9,'s','e','c','0','a'),sk)
    assert verify_checkpoint(s,sk.public_key(),highest_sequence=10)[1]=='CHECKPOINT_ROLLBACK'


def test_peer_reconciliation_uses_least_confirmed_state():
    a=PeerObligationView('A','o','op',100,'USD','SETTLED','a',5)
    b=PeerObligationView('B','o','op',100,'USD','EXECUTED','b',6)
    ok,_,p=reconcile_peer_views(a,b)
    assert ok and p.agreed_state=='EXECUTED'


def test_peer_reconciliation_refuses_economic_mismatch():
    a=PeerObligationView('A','o','op',100,'USD','SETTLED','a',5)
    b=PeerObligationView('B','o','op',101,'USD','SETTLED','b',5)
    assert reconcile_peer_views(a,b)[1]=='OBLIGATION_ECONOMIC_MISMATCH'


def test_route_state_is_signed_monotonic_and_fresh():
    sk=Ed25519PrivateKey.generate(); a=RouteStateAnnouncement('r','A','B',4,True,1000,10,'0','A',20)
    s=sign_route_state(a,sk)
    assert verify_route_state(s,sk.public_key(),current_sequence=11,highest_epoch=4)[0]
    assert verify_route_state(s,sk.public_key(),current_sequence=21)[1]=='STALE_ROUTE_STATE'


def test_route_bound_propagation_can_only_contract():
    assert propagate_route_bound(1000,5000)==1000
    assert propagate_route_bound(1000,400)==400


def test_network_contraction_propagates_without_expansion():
    states=[MeshHealthState('A',MeshHealth.DEGRADED,5000),MeshHealthState('B',MeshHealth.NORMAL,10000),MeshHealthState('C',MeshHealth.NORMAL,10000)]
    out=propagate_contraction(states,[ContractionEdge('A','B',10000),ContractionEdge('B','C',5000)])
    assert out['B'].contraction_bps==5000
    assert out['C'].contraction_bps==7500


def test_network_contraction_never_improves_stricter_local_state():
    states=[MeshHealthState('A',MeshHealth.DEGRADED,8000),MeshHealthState('B',MeshHealth.DEGRADED,3000)]
    out=propagate_contraction(states,[ContractionEdge('A','B',10000)])
    assert out['B'].contraction_bps==3000


def test_channel_recovery_requires_new_epoch_and_old_fence():
    p=AuthorityChannelRecoveryProof('ch',3,4,100,20,'o'*64,'c'*64,True)
    assert validate_channel_recovery(p)==(True,'CHANNEL_RECOVERY_VALID')
    assert validate_channel_recovery(replace(p,new_epoch=3))[1]=='RECOVERY_EPOCH_NOT_ADVANCED'
    assert validate_channel_recovery(replace(p,old_channel_fenced=False))[1]=='OLD_CHANNEL_NOT_FENCED'


def test_live_network_attestation_verifies_chain_and_constitution():
    sk=Ed25519PrivateKey.generate(); x=LiveNetworkState('N',50,'c'*64,'q1','q2','r','o','cf',9000,500,60,'0','att')
    s=sign_network_attestation(x,sk)
    assert verify_network_attestation(s,sk.public_key(),current_sequence=55,required_constitution='c'*64)[0]
    assert verify_network_attestation(s,sk.public_key(),current_sequence=61)[1]=='STALE_NETWORK_ATTESTATION'


def test_network_attestation_tamper_fails_signature():
    sk=Ed25519PrivateKey.generate(); x=LiveNetworkState('N',50,'c','q1','q2','r','o','cf',9000,500,60,'0','att')
    s=sign_network_attestation(x,sk)
    bad=SignedNetworkAttestation(replace(x,aggregate_mrec_usd_minor=999999),s.signature_hex)
    assert verify_network_attestation(bad,sk.public_key(),current_sequence=55)[1]=='INVALID_NETWORK_ATTESTATION_SIGNATURE'
