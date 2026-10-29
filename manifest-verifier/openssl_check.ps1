$ErrorActionPreference = 'Continue'
$ossl = 'C:\Program Files\Git\mingw64\bin\openssl.exe'
$d = 'C:\Users\sam\.gemini\antigravity\scratch\manifest-verifier\openssl_check'
$transcript = 'C:\Users\sam\.gemini\antigravity\scratch\manifest-verifier\signing-transcript.bin'
Set-Location $d
& $ossl version
"signing transcript length: $((Get-Item $transcript).Length)"

foreach ($k in 'skott34-ed25519', 'numina-guardian-ed25519') {
    "`n== $k (manifest signature, deterministic transcript) =="
    & $ossl pkeyutl -verify -rawin -pubin -inkey "$k.pub.pem" -in $transcript -sigfile "$k.sig" 2>&1
    "exit code: $LASTEXITCODE"
}

"`n== control: guardian signature verifies only with guardian key =="
& $ossl pkeyutl -verify -rawin -pubin -inkey 'numina-guardian-ed25519.pub.pem' -in $transcript -sigfile 'numina-guardian-ed25519.sig' 2>&1
"exit code: $LASTEXITCODE"

"`n== negative control: guardian signature against skott34 key =="
& $ossl pkeyutl -verify -rawin -pubin -inkey 'skott34-ed25519.pub.pem' -in $transcript -sigfile 'numina-guardian-ed25519.sig' 2>&1
"exit code: $LASTEXITCODE"
