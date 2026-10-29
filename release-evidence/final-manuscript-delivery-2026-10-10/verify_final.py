"""Public, read-only verification of the exact Numina final delivery."""
import hashlib
import json
import pathlib
import subprocess
import sys
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

root = pathlib.Path(__file__).resolve().parent
pin = 'b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f'
raw = (root/'signing/operational-ed25519-public.raw32').read_bytes()
assert len(raw)==32 and hashlib.sha256(raw).hexdigest()==pin
key = Ed25519PublicKey.from_public_bytes(raw)
manifest = json.loads((root/'delivery-manifest.json').read_text())

def safe(name):
    p=pathlib.PurePosixPath(name)
    assert name and not p.is_absolute() and '..' not in p.parts
    assert p.as_posix()==name and '\\' not in name
    resolved=(root/name).resolve()
    assert resolved.is_relative_to(root)
    return resolved

records={r['path']:r for r in manifest['files']}
assert len(records)==len(manifest['files'])
for name,r in records.items():
    b=safe(name).read_bytes()
    assert len(b)==r['bytes'] and hashlib.sha256(b).hexdigest()==r['sha256'],name

checksum_names=set()
for line in (root/'SHA256SUMS').read_text().splitlines():
    digest,name=line.split('  ',1)
    assert name not in checksum_names
    checksum_names.add(name)
    assert hashlib.sha256(safe(name).read_bytes()).hexdigest()==digest,name
assert checksum_names==set(records)|{'delivery-manifest.json'}
assert set(manifest['signature_targets'])=={n for n in records if pathlib.PurePosixPath(n).suffix.lower() in manifest['direct_document_extensions']}|{'delivery-manifest.json','SHA256SUMS'}

verified=[]
for name in manifest['signature_targets']:
    b=safe(name).read_bytes()
    sig=safe('signing/signatures/'+name+'.ed25519.sig64').read_bytes()
    assert len(sig)==64
    key.verify(sig,b)
    for s,m in [(sig,bytes([b[0]^1])+b[1:]),(bytes([sig[0]^1])+sig[1:],b)]:
        try:key.verify(s,m)
        except InvalidSignature:pass
        else:raise AssertionError('Mutation accepted: '+name)
    verified.append(name)

expected=set(records)|{'delivery-manifest.json','SHA256SUMS','signing/final-document-signing-receipt.json'}|{'signing/signatures/'+n+'.ed25519.sig64' for n in verified}
actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
assert actual==expected,{'extra':sorted(actual-expected),'missing':sorted(expected-actual)}
receipt=json.loads((root/'signing/final-document-signing-receipt.json').read_text())
assert receipt['public_key_sha256']==pin and receipt['new_signature_count']==len(verified)
assert {r['path'] for r in receipt['signatures']}==set(verified)
for r in receipt['signatures']:
    b=safe(r['path']).read_bytes()
    assert r['message_sha256']==hashlib.sha256(b).hexdigest() and r['message_bytes']==len(b)
    assert r['signature_sha256']==hashlib.sha256(safe('signing/signatures/'+r['path']+'.ed25519.sig64').read_bytes()).hexdigest()

old=subprocess.run([sys.executable,str(root/'verify_recovered.py')],cwd=root,capture_output=True,text=True)
assert old.returncode==0,old.stderr
proof=json.loads((root/'verification/ncps-proof-verification-final.json').read_text())
coverage=json.loads((root/'verification/ncps-proof-assumptions-and-coverage.json').read_text())
assert proof['trust_level']==0 and all(x['exit_code']==0 for x in proof['compilation'])
assert coverage['source_theorem_count']==131 and coverage['all_named_theorems_audited']
ietf=json.loads((root/'verification/ietf-independent-stream-verification.json').read_text())
assert ietf['rfc_stream'] is None and ietf['independent_stream_acceptance']=='not_established_from_checked_evidence'
print(json.dumps({'status':'PASS','inventoried_files':len(records),'new_exact_document_signatures':len(verified),'new_tamper_rejections':2*len(verified),'historical_signatures':4,'historical_tamper_rejections':8,'public_key_sha256':pin,'pdf_directly_signed':True,'whole_protocol_verified':False,'independent_stream_acceptance_verified':False},indent=2))
