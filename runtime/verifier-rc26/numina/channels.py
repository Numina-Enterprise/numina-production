from __future__ import annotations
from dataclasses import dataclass, replace
from typing import FrozenSet, Tuple


@dataclass(frozen=True)
class AuthorityChannelPolicy:
    channel_id: str
    source_domain: str
    destination_domain: str
    authority_classes: FrozenSet[str]
    aggregate_limit_usd_minor: int
    per_operation_limit_usd_minor: int
    velocity_limit_usd_minor_per_window: int
    expiry_sequence: int


@dataclass(frozen=True)
class AuthoritySession:
    session_id: str
    policy: AuthorityChannelPolicy
    opened_sequence: int
    consumed_usd_minor: int = 0
    velocity_consumed_usd_minor: int = 0
    operation_nonces: FrozenSet[str] = frozenset()
    closed: bool = False

    @property
    def remaining_usd_minor(self) -> int:
        return max(0, self.policy.aggregate_limit_usd_minor - self.consumed_usd_minor)


def consume_session(session: AuthoritySession, *, authority_class: str, consequence_usd_minor: int,
                    operation_nonce: str, current_sequence: int) -> Tuple[AuthoritySession, str]:
    if session.closed:
        return session, 'SESSION_CLOSED'
    if current_sequence > session.policy.expiry_sequence:
        return session, 'SESSION_EXPIRED'
    if authority_class not in session.policy.authority_classes:
        return session, 'SESSION_AUTHORITY_CLASS_DENIED'
    if consequence_usd_minor < 0:
        return session, 'NEGATIVE_CONSEQUENCE'
    if consequence_usd_minor > session.policy.per_operation_limit_usd_minor:
        return session, 'SESSION_PER_OPERATION_BOUND_EXCEEDED'
    if consequence_usd_minor > session.remaining_usd_minor:
        return session, 'SESSION_AGGREGATE_BOUND_EXCEEDED'
    if session.velocity_consumed_usd_minor + consequence_usd_minor > session.policy.velocity_limit_usd_minor_per_window:
        return session, 'SESSION_VELOCITY_BOUND_EXCEEDED'
    if operation_nonce in session.operation_nonces:
        return session, 'SESSION_NONCE_REPLAY'
    return replace(
        session,
        consumed_usd_minor=session.consumed_usd_minor + consequence_usd_minor,
        velocity_consumed_usd_minor=session.velocity_consumed_usd_minor + consequence_usd_minor,
        operation_nonces=session.operation_nonces | frozenset({operation_nonce}),
    ), 'OK'


def reset_velocity_window(session: AuthoritySession) -> AuthoritySession:
    return replace(session, velocity_consumed_usd_minor=0)


def close_session(session: AuthoritySession) -> AuthoritySession:
    return replace(session, closed=True)
