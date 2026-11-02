from __future__ import annotations
from dataclasses import dataclass
from .canonical import digest

@dataclass(frozen=True)
class AuthorityChannelRecoveryProof:
    channel_id: str
    old_epoch: int
    new_epoch: int
    prior_consumed_usd_minor: int
    prior_uncertain_usd_minor: int
    reconciled_obligation_root: str
    recovery_checkpoint_digest: str
    old_channel_fenced: bool

    @property
    def proof_digest(self): return digest(self)


def validate_channel_recovery(p: AuthorityChannelRecoveryProof):
    if p.new_epoch <= p.old_epoch: return False,'RECOVERY_EPOCH_NOT_ADVANCED'
    if not p.old_channel_fenced: return False,'OLD_CHANNEL_NOT_FENCED'
    if p.prior_consumed_usd_minor < 0 or p.prior_uncertain_usd_minor < 0: return False,'INVALID_RECOVERY_OCCUPANCY'
    if not p.reconciled_obligation_root or not p.recovery_checkpoint_digest: return False,'INCOMPLETE_RECOVERY_EVIDENCE'
    return True,'CHANNEL_RECOVERY_VALID'
