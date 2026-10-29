import hashlib, json

s = '''{"authorityLead":"Samuel J. Kott","canonicalOrigin":"https://www.numinalabs.xyz","createdAtMs":1792800000000,"documents":[{"byteLength":7421,"path":"docs/Numina-Evidence-Integration-Gates-2026-10-11.md","sha256":"2fa0d8271f14327a9754adddf76bdcfd91a7d6de5b1addcbdb52675b32c5cc89","utf8Clean":true},{"byteLength":10407,"path":"docs/Numina-Security.md","sha256":"6af93453d6373e0a165180a0a9af6962d3075d6d34b5b5d6eee1e14b4431b018","utf8Clean":true},{"byteLength":7694,"path":"docs/NUSD-Conversion-Contracts.md","sha256":"9cc698d11fe9c7e49a39596f0c4123a4c72691926bea55837a718230627b9150","utf8Clean":true}],"nusdOperationalState":"UNPAUSED_AND_ACTIVE","operator":"SK Consulting LLC","productionAcceptanceGates":[{"id":"GATE_1","name":"RC27 Release Verification Report","status":"VERIFIED"},{"id":"GATE_2","name":"Runtime Signer Verification Report","status":"VERIFIED"},{"id":"GATE_3","name":"Build 6 Verification Report","status":"VERIFIED"},{"id":"GATE_4","name":"Backup & Restore Validation Report","status":"VERIFIED"},{"id":"GATE_5","name":"S0 Governance Approval Package","status":"VERIFIED"}],"schemaVersion":"numina-provenance-manifest-v1","singularityIdentity":{"foundation":"Ed25519","governance":"Zero Trust + Multi-Signature Authorization","identity":"NUMINA","model":"Skott34-Ed25519, Universal Companion Model","motto":"Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed. NUMINA aligned."},"verifiedAsanaSprintGid":"1219183110870936"}'''

data = s.encode('utf-8')
h = hashlib.sha256(data).hexdigest()
print("Computed SHA-256:", h)
print("Expected Root:   ", "726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd")
print("Matches:         ", h == "726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd")
print("Byte length:     ", len(data))
