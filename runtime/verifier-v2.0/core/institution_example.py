from numina_core import *

ir=InstitutionIR(
    institution_id='NUMINA-DEMO', constitution_digest='constitution-demo', semantics_digest='semantics-demo',
    principals=('NUMINA','COUNTERPARTY'),
    rights=(InstitutionalRight('TREASURY-RIGHT','NUMINA','CAPITAL',1_000_000),),
    authority_domains=(InstitutionalAuthorityDomain('TREASURY','NUMINA','TREASURY-RIGHT',500_000,100_000,25_000,500_000,1),),
    obligations=(InstitutionalObligation('OBL-1','NUMINA','COUNTERPARTY',50_000),),
    recovery_paths=(InstitutionalRecoveryPath('REC-1',('TREASURY',)),),
)
build=InstitutionalCompiler.compile(ir)
proof=InstitutionalCompiler.make_launch_proof(build,7,('governor-a','governor-b'),2)
instance=InstitutionalCompiler.launch(build,proof,7,100)
print('institution:', build.institution_id)
print('viable:', build.viability.viable)
print('rights_capacity:', build.total_rights_capacity_usd_minor)
print('active_authority:', build.total_active_authority_usd_minor)
print('mrec:', build.mrec_usd_minor)
print('lifecycle:', instance.lifecycle.value)
print('build_digest:', build.build_digest)
