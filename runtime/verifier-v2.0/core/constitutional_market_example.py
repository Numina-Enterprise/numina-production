from numina import *

m=ConstitutionalMarketRuntime('NUMINA-CLEAR')
for d in ('BANK-A','BANK-B','BANK-C'):
    m.add_member(ClearingMember(d,5_000_000,1_000_000,2_000_000))
m.add_obligation(ClearingObligation('O1','BANK-A','BANK-B','USD_MINOR',900_000,True))
m.add_obligation(ClearingObligation('O2','BANK-B','BANK-A','USD_MINOR',250_000,True))
m.add_netting_right(NettingRight('NET-1','NUMINA-CLEAR','USD_MINOR',('BANK-A','BANK-B'),2_000_000))
m.add_collateral_lot(CollateralLot('COL-A','BANK-A','USD_MINOR',1_000_000,2000))
r=m.compute_netting('NET-1')
c=m.reserve_collateral('CR-1','BANK-A',400_000,'SETTLEMENT')
print('gross_open:', r.gross_open)
print('bilateral_net:', r.bilateral_net)
print('net_abs_exposure:', r.net_abs_exposure)
print('collateral_reserved:', c.eligible_amount)
print('state_root:', m.state_root())
