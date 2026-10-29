from __future__ import annotations
import argparse, unittest, pathlib, sys
from numina_core import State, NuminaRuntime, make_intent

def main():
    p=argparse.ArgumentParser(prog="numina",description="Numina reference conformance CLI")
    sub=p.add_subparsers(dest="cmd",required=True)
    sub.add_parser("demo"); sub.add_parser("conformance")
    a=p.parse_args()
    if a.cmd=="demo":
        rt=NuminaRuntime(State(rights_capacity_usd_minor=2_000_000,final_eth_wei=2*10**18)); i=make_intent(rt)
        print(rt.evaluate(i)[0].value); rt.create_reservation(i); rt.begin_commit(i.operation_id); rt.submission_accepted(i.operation_id); rt.fill_confirmed(i.operation_id,"fill-1",10**18,300_000); rt.settlement_final(i.operation_id); print(rt.receipt(i.operation_id))
    else:
        suite=unittest.defaultTestLoader.discover("tests"); result=unittest.TextTestRunner(verbosity=2).run(suite); raise SystemExit(0 if result.wasSuccessful() else 1)
if __name__=="__main__": main()
