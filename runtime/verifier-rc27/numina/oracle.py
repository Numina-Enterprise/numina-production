from __future__ import annotations
# Deliberately independent: no imports from runtime implementation helpers.
def oracle_buy_decision(*, rights_capacity, reserved, committed, uncertain, qty_wei, price_minor, notional_minor, deps_current=True, valuation_fresh=True):
    if min(qty_wei,notional_minor) < 0 or price_minor <= 0: return "DENY"
    if not deps_current: return "DENY"
    if not valuation_fresh: return "ESCALATE"
    available=max(0,rights_capacity-reserved-committed-uncertain)
    if notional_minor>available: return "DENY"
    implied=(qty_wei*price_minor)//10**18
    if implied>notional_minor: return "DENY"
    return "ALLOW"
