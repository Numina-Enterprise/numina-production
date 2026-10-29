import json, pathlib
d = pathlib.Path(r"C:\Users\sam\.gemini\antigravity\scratch\manifest-verifier\openssl_check")
d.mkdir(exist_ok=True)
m = json.load(open(r"C:\Users\sam\.gemini\antigravity\scratch\numina-doc-alignment\provenance-manifest.json", encoding="utf-8"))
for s in m["multiSignature"]["signers"]:
    (d / f"{s['keyId']}.pub.pem").write_text(s["publicKeyPem"], newline="\n")
    (d / f"{s['keyId']}.sig").write_bytes(bytes.fromhex(s["signatureHex"]))
(d / "msg.bin").write_bytes(bytes.fromhex(m["manifestSha256"]))
print("wrote", sorted(p.name for p in d.iterdir()))
