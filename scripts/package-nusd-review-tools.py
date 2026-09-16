"""Package the reviewed public handoff and v3 tools; never include wallet secrets."""
import hashlib,json,pathlib,zipfile,io
root=pathlib.Path(__file__).resolve().parents[1]
base=root/'docs/Numina-500T-Deployment-Handoff.zip'
assert hashlib.sha256(base.read_bytes()).hexdigest()=='858a8efd985be4b19c9b8a4df90a6d0145b61a0c39354759d5afa83a284a2afd'
files={}
with zipfile.ZipFile(base) as archive:
    for entry in archive.infolist():
        assert entry.filename.startswith('Numina-500T-Deployment-Handoff/')
        name=entry.filename.removeprefix('Numina-500T-Deployment-Handoff/')
        assert not entry.is_dir() and not name.startswith('/') and '..' not in pathlib.PurePosixPath(name).parts
        if name in ('file-inventory.json','validation.json'):name='reference/original-handoff-'+name
        files[name]=archive.read(entry)
tool=root/'runtime/nusd/reviews/uncapped-500t/tool'
for source in sorted(tool.rglob('*')):
    if not source.is_file():continue
    relative=source.relative_to(tool)
    if 'node_modules' in relative.parts:continue
    assert not source.is_symlink() and source.suffix not in ('.key','.pem','.p12')
    destination=relative.as_posix() if relative.parts[0]=='configuration' else 'tool/'+relative.as_posix()
    files[destination]=source.read_bytes()
reviews=['independentSecurityAudit','authorizedIssuerAndJurisdictions','custodianAndReserveEvidence','redeemabilityTermsAndOperations','financialCrimeAndSanctionsControls','independentRoleKeyCustody','incidentAndPauseRecovery','applicationSettlementAndFulfillmentReview']
for review in reviews:
    files['reviews/'+review+'.json']=(json.dumps({'schema':'numina.review-evidence-intake.v1','reviewId':review,'status':'AWAITING_REVIEWER_EVIDENCE','reviewer':None,'reviewerCapacity':None,'issuedAt':None,'scope':None,'findings':[],'evidenceReferences':[],'documentSha256':None,'acceptanceDecision':None,'independentlyVerified':False,'templateIsEvidence':False},indent=2)+'\n').encode()
files['README.md']=("# NUSD 500T preparation tools\n\nThis package adds a pinned v3 constructor encoder, read-only network observer, receipt consistency checker and eight review-evidence intake records to the existing public handoff. Start with **tool/README.md**. Node 24 and the pinned ethers dependency are required.\n\nThe supplied production request has no NUSD recipient, so its review draft correctly remains blocked. The proposed network/genesis pin comes from the recorded provider observation; it does not establish independent approval or sender control. No wallet, reserve, official USDC deployment, review attestation, receipt, signature or deposit is created by these files.\n\n## Original handoff instructions\n\n"+files['README.md'].decode()).encode()
inventory={'schema':'numina.nusd.preparation-tools-inventory.v1','files':[{'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in sorted(files.items())],'scope':'Public preparation tools and unfilled evidence records; no financial execution'}
files['file-inventory.json']=(json.dumps(inventory,indent=2)+'\n').encode()
output=root/'docs/Numina-500T-Preparation-Tools.zip'
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for name,data in sorted(files.items()):
        info=zipfile.ZipInfo(name,(2026,9,16,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;archive.writestr(info,data)
record={'schema':'numina.nusd.preparation-tools-package.v1','url':'/downloads/'+output.name,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'bytes':output.stat().st_size,'files':len(files),'node':'24.x','dependency':{'ethers':'6.15.0'},'toolFunctions':['offline_constructor_encoding','read_only_network_observation','supplied_receipt_consistency_checks'],'productionReady':False,'financialExecution':False,'walletCreated':False,'reviewAttestationsCreated':False}
(root/'docs/numina-500t-preparation-tools-record.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf8',newline='\n')
with zipfile.ZipFile(output) as archive:
    assert set(archive.namelist())==set(files)
    for item in inventory['files']:assert hashlib.sha256(archive.read(item['path'])).hexdigest()==item['sha256']
print(json.dumps(record))
