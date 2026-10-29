"""Exact-authorized final delivery adapter for the retained custody workflow.

This uses the unchanged local custody primitive. No key is generated,
serialized, exported, printed, synchronized, or written to an output file.
"""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import sys
import tarfile
from datetime import datetime, timezone

sys.dont_write_bytecode = True
os.umask(0o077)
stage=Path(sys.argv[1])
req=json.loads((stage/'signing-request.json').read_text())
pin='b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f'
workflow=Path('/Users/samuelkott/Library/Application Support/PairWireSigning/operational_ed25519.py')
reference=workflow.parent/'operational-ed25519-custody.json'

def digest(data):return hashlib.sha256(data).hexdigest()

def main():
    assert req['public_key_sha256']==pin
    assert digest(workflow.read_bytes())=='25648a798550743fe2788532e56f4823e4d7b5c90d7f50cc3023528c12175709'
    archive=stage/'public-signing-inputs.tar.gz'
    assert archive.stat().st_size==req['input_archive_bytes']
    assert digest(archive.read_bytes())==req['input_archive_sha256']
    source=stage/'exact-inputs'
    source.mkdir(exist_ok=False)
    with tarfile.open(archive) as t:
        members=t.getmembers()
        assert {m.name for m in members}==set(req['signature_targets'])
        assert len(members)==len(req['signature_targets'])
        for m in members:
            p=PurePosixPath(m.name)
            assert m.isfile() and not p.is_absolute() and '..' not in p.parts
            dest=source/m.name
            dest.parent.mkdir(parents=True,exist_ok=True)
            dest.write_bytes(t.extractfile(m).read())
    manifest_bytes=(source/'delivery-manifest.json').read_bytes()
    assert digest(manifest_bytes)==req['manifest_sha256']
    manifest=json.loads(manifest_bytes)
    assert manifest['signature_targets']==req['signature_targets']
    assert manifest['signature_intent']['public_key_sha256']==pin
    assert manifest['signature_intent']['message_format']=='exact file bytes; no canonicalization, prehash or SSHSIG'
    records={r['path']:r for r in manifest['files']}
    checksum_entries={n:h for h,n in (line.split('  ',1) for line in (source/'SHA256SUMS').read_text().splitlines())}
    assert set(checksum_entries)==set(records)|{'delivery-manifest.json'}
    assert checksum_entries['delivery-manifest.json']==digest(manifest_bytes)
    for name in req['signature_targets']:
        b=(source/name).read_bytes()
        assert b
        if name in records:
            assert len(b)==records[name]['bytes'] and digest(b)==records[name]['sha256']
            assert digest(b)==checksum_entries[name]

    # Public identity and exact input checks are complete before custody access.
    info=json.loads(reference.read_text())
    assert info['service']=='org.pairwire.operational.ed25519'
    assert info['account']=='sam-operational-07da8c7f-d325-46d7-a734-1cc20ab6325b'
    assert info['public_key']['fingerprint_hex']==pin
    assert info['public_key']['hex']=='f29ec679836c6889ef87d41b842bfd2236004c1a6d84d4bac0814cae45a90c28'
    spec=importlib.util.spec_from_file_location('retained_numina_custody',workflow)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    store=module.LocalKeychain()
    assert str(store.path)==info['keychain_path']
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization
    from cryptography.exceptions import InvalidSignature
    import cryptography
    seed=store.read(info['service'],info['account'])
    assert len(seed)==32
    key=Ed25519PrivateKey.from_private_bytes(seed)
    del seed
    pub=key.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw)
    assert digest(pub)==pin and pub.hex()==info['public_key']['hex']
    signatures=[]
    for name in req['signature_targets']:
        b=(source/name).read_bytes()
        sig=key.sign(b)
        key.public_key().verify(sig,b)
        for s,m in [(sig,bytes([b[0]^1])+b[1:]),(bytes([sig[0]^1])+sig[1:],b)]:
            try:key.public_key().verify(s,m)
            except InvalidSignature:pass
            else:raise RuntimeError('Tamper control failed')
        signatures.append({'path':name,'message_bytes':len(b),'message_sha256':digest(b),'signature_base64':base64.b64encode(sig).decode(),'signature_sha256':digest(sig),'verified':True,'payload_mutation_rejected':True,'signature_mutation_rejected':True})
    del key
    receipt={'schema':'numina.final-document-signing-receipt.v1','signed_at_utc':datetime.now(timezone.utc).isoformat(),'algorithm':'pure Ed25519','message_framing':'exact file bytes; no canonicalization, prehash or SSHSIG','public_key_base64':base64.b64encode(pub).decode(),'public_key_sha256':pin,'new_signature_count':len(signatures),'new_tamper_rejections':2*len(signatures),'source_manifest_sha256':digest(manifest_bytes),'workflow_sha256':digest(workflow.read_bytes()),'existing_workflow_unchanged':True,'custody':'Existing retained local login Keychain item; reused in place','key_generated_or_rotated':False,'private_key_exported':False,'keychain_mutated':False,'python_version':sys.version,'cryptography_version':cryptography.__version__,'purpose':req['purpose'],'signature_coverage':'Every listed exact document plus final manifest and checksum inventory; binary artifacts bound by inventoried SHA-256','limitations':['Operational integrity and key correspondence only; not IETF or ISE approval','No private companion-wire record or whole-protocol acceptance issued','Historical originals remain unchanged; this is a new signing event','Provider archive bytes and requested earlier final-deployment-receipt remain unobserved'],'signatures':signatures}
    output=stage/'final-document-signing-receipt.json'
    with output.open('x') as f:json.dump(receipt,f,indent=2);f.write('\n')
    print(json.dumps({'status':'PASS','new_signature_count':len(signatures),'tamper_rejections':2*len(signatures),'private_key_exported':False,'existing_key_reused':True,'receipt_path':str(output)}))

try:main()
except Exception as e:
    print(json.dumps({'status':'BLOCKED','exception_type':type(e).__name__,'reason':'Exact input, established custody or signing verification failed; no replacement or custody change attempted'}))
    sys.exit(1)
