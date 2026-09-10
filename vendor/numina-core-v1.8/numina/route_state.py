from __future__ import annotations
from dataclasses import dataclass
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.exceptions import InvalidSignature
from .cbor import encode
from .canonical import digest

@dataclass(frozen=True)
class RouteStateAnnouncement:
    route_id: str
    source_domain: str
    destination_domain: str
    route_epoch: int
    active: bool
    max_consequence_usd_minor: int
    sequence: int
    previous_announcement_digest: str
    announcer_id: str
    valid_until_sequence: int

    @property
    def announcement_digest(self): return digest(self)

@dataclass(frozen=True)
class SignedRouteState:
    announcement: RouteStateAnnouncement
    signature_hex: str


def sign_route_state(a: RouteStateAnnouncement, sk: Ed25519PrivateKey):
    return SignedRouteState(a,sk.sign(encode(a)).hex())


def verify_route_state(s: SignedRouteState, pk: Ed25519PublicKey, *, current_sequence: int, highest_epoch: int = -1,
                       highest_sequence: int = -1, expected_previous: str | None = None):
    try: pk.verify(bytes.fromhex(s.signature_hex),encode(s.announcement))
    except (InvalidSignature,ValueError): return False,'INVALID_ROUTE_STATE_SIGNATURE'
    a=s.announcement
    if a.route_epoch < highest_epoch or a.sequence < highest_sequence: return False,'ROUTE_STATE_ROLLBACK'
    if current_sequence > a.valid_until_sequence: return False,'STALE_ROUTE_STATE'
    if expected_previous is not None and a.previous_announcement_digest != expected_previous: return False,'ROUTE_STATE_CHAIN_BREAK'
    if a.max_consequence_usd_minor < 0: return False,'INVALID_ROUTE_BOUND'
    return True,'ROUTE_STATE_VALID'


def propagate_route_bound(parent_max: int, child_requested_max: int) -> int:
    if parent_max < 0 or child_requested_max < 0: raise ValueError('negative route bound')
    return min(parent_max,child_requested_max)
