from numina import *

r = RightsRuntime()
r.add_creation_authority(RightCreationAuthority('A','P','NUMINA',('ROOT',),1_000_000,5_000_000,True))
r.create_right('A', RightGenesisRequest('R','P','ROOT',RightKind.CONTROL,BackingKind.PROTOCOL_NATIVE,1_000_000))
r.add_recognition_budget(RecognitionBudget('BANK','BANK-A','NUMINA','ROOT',600_000))
r.recognize_right('R','BANK',600_000)

net = InstitutionalRightsNetwork(r)
print('recognized_surface=', net.recognition_surface('R'))
print('authority_synthesis=', net.synthesize_authority('R','BANK-A',800_000))
claims=(PriorityClaim('SENIOR','SENIOR-CREDITOR',700_000,1), PriorityClaim('JUNIOR','JUNIOR-CREDITOR',500_000,2))
print('insolvency=', net.assess_insolvency(900_000, claims))
