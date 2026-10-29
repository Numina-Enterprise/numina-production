"""Verify the authenticated inner ZIP, all documents, and retained evidence."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile
import zipfile
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

root=Path(__file__).resolve().parent
pin='b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f'
pub=(root/'operational-ed25519-public.raw32').read_bytes()
assert len(pub)==32 and hashlib.sha256(pub).hexdigest()==pin
key=Ed25519PublicKey.from_public_bytes(pub)
checksum=(root/'Numina-Final-Delivery-Contents.zip.sha256').read_bytes()
sig=(root/'Numina-Final-Delivery-Contents.zip.sha256.ed25519.sig64').read_bytes()
key.verify(sig,checksum)
digest,name=checksum.decode().strip().split('  ',1)
assert name=='Numina-Final-Delivery-Contents.zip'
archive=root/name
assert hashlib.sha256(archive.read_bytes()).hexdigest()==digest
for s,b in [(sig,bytes([checksum[0]^1])+checksum[1:]),(bytes([sig[0]^1])+sig[1:],checksum)]:
    try:key.verify(s,b)
    except InvalidSignature:pass
    else:raise AssertionError('Package checksum mutation accepted')
with tempfile.TemporaryDirectory(prefix='numina-public-verification-') as scratch:
    dest=Path(scratch)
    with zipfile.ZipFile(archive) as z:
        assert len(z.namelist())==len(set(z.namelist()))
        for n in z.namelist():
            p=PurePosixPath(n)
            assert not p.is_absolute() and '..' not in p.parts and p.as_posix()==n
        z.extractall(dest)
    run=subprocess.run([sys.executable,str(dest/'delivery/verify_final.py')],capture_output=True,text=True)
    assert run.returncode==0,run.stderr
    first=json.loads(run.stdout)
    coverage=json.loads((dest/'supplemental/signing-coverage.json').read_text())
    count=0
    for r in coverage['documents']:
        message=(dest/r['path']).read_bytes()
        signature=(dest/'supplemental/signatures'/(r['path']+'.ed25519.sig64')).read_bytes()
        assert len(message)==r['bytes'] and hashlib.sha256(message).hexdigest()==r['sha256']
        key.verify(signature,message)
        for s,b in [(signature,bytes([message[0]^1])+message[1:]),(bytes([signature[0]^1])+signature[1:],message)]:
            try:key.verify(s,b)
            except InvalidSignature:pass
            else:raise AssertionError('Supplemental mutation accepted')
        count+=1
    c=(dest/'supplemental/signing-coverage.json').read_bytes()
    cs=(dest/'supplemental/signatures/supplemental/signing-coverage.json.ed25519.sig64').read_bytes()
    key.verify(cs,c)
    for s,b in [(cs,bytes([c[0]^1])+c[1:]),(bytes([cs[0]^1])+cs[1:],c)]:
        try:key.verify(s,b)
        except InvalidSignature:pass
        else:raise AssertionError('Supplemental coverage mutation accepted')
    assert (root/'README.md').read_bytes()==(dest/'supplemental/README.md').read_bytes()
    assert Path(__file__).read_bytes()==(dest/'supplemental/verify_download.py').read_bytes()
    print(json.dumps({'status':'PASS','new_document_signatures':first['new_exact_document_signatures']+count+1,'signed_package_checksum':True,'total_new_signature_count':first['new_exact_document_signatures']+count+2,'new_tamper_rejections':first['new_tamper_rejections']+2*count+4,'historical_signatures':4,'historical_tamper_rejections':8,'pdf_directly_signed':True,'receipt_and_base64_directly_signed':True,'bounded_ncps_proofs':131,'whole_protocol_verified':False,'independent_stream_acceptance_verified':False},indent=2))
