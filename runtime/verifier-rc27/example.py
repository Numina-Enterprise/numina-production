from numina_core import *

rt = NuminaRuntime(State(rights_capacity_usd_minor=1_000_000))
intent = make_intent(rt, op="demo-buy", qty_wei=10**18, px_minor=300_000, notional_minor=300_000, nonce="demo-1")
print("decision:", rt.evaluate(intent))
rt.create_reservation(intent)
rt.begin_commit(intent.operation_id)
rt.submission_accepted(intent.operation_id)
rt.fill_confirmed(intent.operation_id, "fill-1", 10**18, 300_000)
rt.settlement_final(intent.operation_id)
print(rt.receipt(intent.operation_id))
