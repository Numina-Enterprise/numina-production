"""Authorize durable evidence operations through Numina's existing owner identity."""
from __future__ import annotations
import asyncio,json,time
from urllib.request import Request as URLRequest,build_opener,HTTPRedirectHandler
from urllib.error import HTTPError
from fastapi import HTTPException,Request
from starlette.concurrency import run_in_threadpool


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        return None


def _owner_probe(settings,bearer:str)->None:
    request=URLRequest(settings.owner_access_url,headers={"Authorization":bearer,"Accept":"application/json"},method="GET")
    try:
        with build_opener(NoRedirect()).open(request,timeout=5) as response:
            raw=response.read(4097)
            if response.status!=200 or len(raw)>4096:
                raise ValueError("invalid authority response")
            proof=json.loads(raw)
        if proof.get("schema")!="numina.runtime-access.v1" or proof.get("owner") is not True or proof.get("scope")!="runtime:evidence" or proof.get("rootHash")!=settings.owner_root_hash:
            raise ValueError("owner identity mismatch")
        observed=proof.get("observedAt")
        if type(observed) is not int or abs(time.time()-observed)>30:
            raise ValueError("stale authority response")
    except HTTPError as exc:
        if exc.code in (401,403):
            raise HTTPException(403,"OWNER_REQUIRED") from None
        raise HTTPException(503,"OWNER_AUTHORITY_UNAVAILABLE") from None
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503,"OWNER_AUTHORITY_UNAVAILABLE") from None


async def require_owner_access(request:Request,settings)->None:
    path=request.url.path
    protected=(path in {"/v1/intelligence/evidence","/v1/evidence/bundles","/v1/evidence/jobs","/v1/evidence/revoke"}
        or path.startswith(("/v1/evidence/jobs/","/v1/evidence/transactions/","/v1/execution/submit/","/v1/execution/reconcile/","/v1/execution/verify/")))
    if not protected:
        return
    bearer=request.headers.get("authorization","")
    if not bearer.startswith("Bearer ") or not 1<=len(bearer[7:])<=4096 or any(c.isspace() for c in bearer[7:]):
        raise HTTPException(401,"OWNER_BEARER_REQUIRED")
    if request.headers.get("origin") not in (None,settings.public_url,"https://numinalabs.xyz"):
        raise HTTPException(403,"ORIGIN_DENIED")
    if not settings.owner_access_url or not settings.owner_root_hash:
        raise HTTPException(503,"OWNER_AUTHORITY_NOT_CONFIGURED")
    await run_in_threadpool(_owner_probe,settings,bearer)
    if path=="/v1/evidence/revoke":
        if request.headers.get("content-type","").split(";",1)[0].strip().lower()!="application/json":
            raise HTTPException(415,"JSON_REQUIRED")
        if request.headers.get("content-encoding"):
            raise HTTPException(415,"CONTENT_ENCODING_NOT_SUPPORTED")
        size=0;chunks=[]
        try:
            async with asyncio.timeout(5):
                async for chunk in request.stream():
                    size+=len(chunk)
                    if size>16384:
                        raise HTTPException(413,"REVOCATION_REQUEST_TOO_LARGE")
                    chunks.append(chunk)
        except TimeoutError:
            raise HTTPException(408,"REVOCATION_REQUEST_TIMEOUT") from None
        request._body=b"".join(chunks)
