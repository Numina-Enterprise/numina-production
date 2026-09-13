from numina import *

m=ConstitutionalMarketRuntime('CLEAR')
m.add_member(ClearingMember('A',2_000_000,100_000,1_000_000))
m.add_member(ClearingMember('B',2_000_000,200_000,1_000_000))
m.add_obligation(ClearingObligation('O1','A','B','USD',1_000_000,True))
m.add_collateral_lot(CollateralLot('CA','A','USD',500_000,2000))

s=AutonomousClearingStabilityRuntime(m)
s.set_margin_profile(MarginProfile('A',8000,1000,1_000_000,5))
a=s.assess_margin('A')
c=s.issue_margin_call('CALL-1','A',10)
s.add_waterfall_layer(WaterfallLayer('DEFAULTER',100_000,1,'DEFAULTER_RESOURCES'))
s.add_waterfall_layer(WaterfallLayer('MUTUALIZED',150_000,2,'MUTUALIZED_FUND'))
w=s.allocate_waterfall(a.deficiency)
r=s.build_recovery_plan('A',(
    RecoveryStep('COLLATERALIZE',1,'COLLATERALIZATION',100_000),
    RecoveryStep('SATISFY',2,'OBLIGATION_SATISFYING',100_000),
))
p=s.prove_non_amplification(1_000_000,800_000,1_000_000,1_000_000,True,s.market.state_root())

print(f'margin_state: {a.state.value}')
print(f'deficiency: {a.deficiency}')
print(f'margin_call: {c.amount}')
print(f'waterfall_residual: {w.residual_deficiency}')
print(f'recovery_residual: {r.projected_residual_deficiency}')
print(f'non_amplification_valid: {p.valid}')
