"""Production entrypoint: existing identity, durable evidence, canonical authority."""
import os,sys
import certifi
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"verifier"))

os.environ.update({
    "NUMINA_ENV":"production",
    "NUMINA_ROLE":"public-verifier",
    "NUMINA_RELEASE":"core-v1.8+prod-v1.9.0-rc26",
    "NUMINA_ALLOW_EPHEMERAL_KEY":"false",
    "NUMINA_REQUIRE_FROZEN_CORE":"true",
    "NUMINA_SIGNING_KEY_DER_ENV":"NUMINA_RUNTIME_SIGNING_KEY_DER_B64",
    "NUMINA_SIGNING_PUBLIC_KEY_B64":"UvvCGLBZUbCPJaDHqq0Ef0mkhMeA4CoPPe2GoWgkTr8=",
    "NUMINA_PUBLIC_URL":"https://numina-production.vercel.app",
    "NUMINA_OWNER_ACCESS_URL":"https://numinalabs.xyz/api/control/v2/runtime-access",
    "NUMINA_OWNER_ROOT_HASH":"51116c98ae1c5a9f58a59ff5c801a6b99413a3ef773a01091042866d4ee55db2",
    "NUMINA_REAL_FUNDS_ENABLED":"false",
    "NUMINA_EMPLOYER_IP_ENABLED":"false",
    "NUMINA_PUBLIC_EXECUTION_API_ENABLED":"false",
    "NUMINA_TESTNET_EXECUTION_ENABLED":"false",
    "NUMINA_CIRCLE_TESTNET_SUBMIT_ENABLED":"false",
    "NUMINA_ARC_VERIFICATION_ENABLED":"false",
    "NUMINA_EVIDENCE_NETWORK_ENABLED":"true",
    "NUMINA_EVIDENCE_REQUIRE_DURABLE":"true",
    "NUMINA_DATA_DIR":"/tmp/numina",
    "NUMINA_TRUSTED_HOSTS":",".join(filter(None,["numina-production.vercel.app",os.getenv("VERCEL_URL")])),
})
# Verify the database server certificate without writing or exporting credentials.
database_url=os.getenv("NUMINA_EVIDENCE_DATABASE_URL") or os.getenv("DATABASE_URL")
if database_url:
    parts=urlsplit(database_url)
    query=dict(parse_qsl(parts.query));query.update(sslmode="verify-full",sslrootcert=certifi.where())
    os.environ["NUMINA_EVIDENCE_DATABASE_URL"]=urlunsplit(parts._replace(query=urlencode(query)))

from numina_prod.service import app
