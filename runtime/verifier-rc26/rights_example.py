from numina import *
from numina_core import InstitutionIR, InstitutionalAuthorityDomain, InstitutionalRecoveryPath, InstitutionalCompiler

r=RightsRuntime()
r.add_creation_authority(RightCreationAuthority('FOUND','P','NUMINA',('ROOT','CHILD','CLAIM'),1_000_000,2_000_000,True))
r.create_right('FOUND',RightGenesisRequest('CAP','P','ROOT',RightKind.CONTROL,BackingKind.PROTOCOL_NATIVE,1_000_000))
r.create_right('FOUND',RightGenesisRequest('PROC','P','CHILD',RightKind.USE,BackingKind.RESOURCE_BACKED,300_000,('CAP',)))
r.add_recognition_budget(RecognitionBudget('BANK-R','BANK','NUMINA','CHILD',300_000))
r.recognize_right('PROC','BANK-R',300_000)
r.create_reciprocal_claim('FOUND','PAIR-1','PAYMENT-CLAIM','PAYMENT-OBL','P','CUSTOMER',100_000)
rights, obligations=r.to_institutional_components()
ir=InstitutionIR('NUMINA-RIGHTS-DEMO','constitution-v1','semantics-v1',('P','CUSTOMER'),rights,
    (InstitutionalAuthorityDomain('PROC-D','P','PROC',200_000),), obligations,(),(InstitutionalRecoveryPath('REC',('PROC-D',)),),())
b=InstitutionalCompiler.compile(ir)
print('rights_root:', r.state_root)
print('parent_available:', r.rights['CAP'].available)
print('recognized_procurement:', r.recognitions[('PROC','BANK')].recognized_capacity)
print('obligations:', len(r.obligations))
print('institution_viable:', b.viability.viable)
print('institution_mrec:', b.mrec_usd_minor)
