# Copyright © 2026 SK Consulting LLC. Numina™. See OWNERSHIP.md.
"""ASGI deployment wrapper. Does not modify rc26 or retain request contents."""
import datetime
import json
import os
import time
import uuid

_METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}

def route_label(path):
    if path in {"/healthz", "/readyz", "/api/ops/v1/telemetry"}:
        return path
    if path.startswith("/api/ops/v1/quantum/"):
        return "/api/ops/v1/quantum/*"
    if path in {"/v2/network/status", "/api/node-connection"}:
        return "/v2/network/status"
    if path in {"/v2/release/manifest", "/v3/release/manifest", "/v4/release/manifest"}:
        return "/v4/release/manifest"
    for prefix in ("/api/control/v1/", "/api/control/v2/", "/api/app/v1/", "/api/nusd/v1/", "/v1/"):
        if path.startswith(prefix):
            return prefix + "*"
    return "/api/*" if path.startswith("/api/") else "/site/*"

class NuminaTelemetryASGI:
    def __init__(self, app, emit=None, clock=time.perf_counter):
        self.app = app
        self.emit = emit if emit is not None else lambda value: print(json.dumps(value), flush=True)
        self.clock = clock
        self.instance_id = str(uuid.uuid4())
        self.active = 0

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = self.clock()
        request_id = str(uuid.uuid4())
        status, complete, failed = 500, False, False
        self.active += 1

        async def measured_send(message):
            nonlocal status, complete
            if message["type"] == "http.response.start":
                status = message["status"]
                message = dict(message)
                message["headers"] = [(k, v) for k, v in message.get("headers", [])
                                      if k.lower() != b"x-request-id"] + [(b"x-request-id", request_id.encode())]
            await send(message)
            if message["type"] == "http.response.body" and not message.get("more_body", False):
                complete = True
        try:
            await self.app(scope, receive, measured_send)
        except BaseException:
            failed = True
            raise
        finally:
            self.active -= 1
            if os.getenv("NUMINA_TELEMETRY_LOGS") != "false":
                try:
                    self.emit({"schema": "numina.http-request.v1", "event": "http_request",
                        "service": "numina-verifier", "version": "4.0.0", "runtimeVersion": "1.9.0-rc26",
                        "instanceId": self.instance_id, "requestId": request_id,
                        "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        "route": route_label(scope.get("path", "/")),
                        "method": scope.get("method") if scope.get("method") in _METHODS else "OTHER",
                        "status": status, "durationMs": round(max(0, self.clock() - started) * 1000, 2),
                        "activeRequests": self.active, "aborted": not complete, "handlerFailed": failed,
                        "phase": "response_sent", "sampleRate": 1})
                except Exception:
                    pass  # A log sink must never change the application's response.
