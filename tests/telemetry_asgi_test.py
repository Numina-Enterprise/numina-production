import asyncio
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("telemetry", Path(__file__).resolve().parents[1]/"runtime/vercel-production/numina_telemetry.py")
telemetry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(telemetry)

class TelemetryASGI(unittest.IsolatedAsyncioTestCase):
    async def test_preserves_body_status_and_redacts_path(self):
        sent, logs = [], []
        async def app(scope, receive, send):
            await send({"type":"http.response.start","status":202,"headers":[(b"x-request-id",b"untrusted")]})
            await send({"type":"http.response.body","body":b"exact bytes"})
        async def send(message): sent.append(message)
        wrapper=telemetry.NuminaTelemetryASGI(app,emit=logs.append)
        await wrapper({"type":"http","path":"/v1/private/customer","method":"GET","query_string":b"secret"},None,send)
        self.assertEqual(sent[-1]["body"],b"exact bytes")
        self.assertEqual(logs[0]["status"],202)
        self.assertEqual(logs[0]["route"],"/v1/*")
        self.assertFalse(logs[0]["aborted"])
        self.assertEqual(wrapper.active,0)
        self.assertNotIn("customer",str(logs))
        self.assertEqual(len(sent[0]["headers"]),1)

    async def test_failure_is_observed_without_swallowing_it(self):
        logs=[]
        async def app(*args): raise RuntimeError("private details")
        wrapper=telemetry.NuminaTelemetryASGI(app,emit=logs.append)
        with self.assertRaisesRegex(RuntimeError,"private details"):
            await wrapper({"type":"http","path":"/v1/status","method":"GET"},None,None)
        self.assertEqual(logs[0]["status"],500)
        self.assertTrue(logs[0]["handlerFailed"])
        self.assertTrue(logs[0]["aborted"])
        self.assertNotIn("private details",str(logs))

    async def test_logging_failure_does_not_replace_result(self):
        async def app(*args): return "unchanged"
        def emit(value): raise RuntimeError("log sink unavailable")
        wrapper=telemetry.NuminaTelemetryASGI(app,emit=emit)
        await wrapper({"type":"http","path":"/","method":"GET"},None,None)
        self.assertEqual(wrapper.active,0)

    async def test_lifespan_passes_through(self):
        async def app(*args): return 42
        self.assertEqual(await telemetry.NuminaTelemetryASGI(app)({"type":"lifespan"},None,None),42)

if __name__ == "__main__": unittest.main()
