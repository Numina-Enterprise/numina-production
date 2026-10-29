import os
import sys
import json
import asyncio
from typing import Dict, Any, List
from google import genai
from google.genai import types

INCIDENT_SYSTEM_PROMPT = """You are the Numina Incident Response Agent (NIRA) for numinalabs.xyz.
Your job is to assess operational telemetry, diagnose anomalies (DNS resolution, SSL/TLS, Cloudflare edge, Cloud Run errors, HSM signing faults), and execute or suggest exact safe remediations.

Available verification keys & states:
- Cluster State Root: 726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd
- Authority Keypin: 46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce (skott34-ed25519)
- Guardian Keypin: 465d10c9e7e1ff1ba2e740773c8de67b349ec6b8ffbb9fe2e584d902c6c19b6c (numina-guardian-ed25519)

Your protocol:
1. Triage severity (SEV-0 critical outage, SEV-1 degraded performance, SEV-2 anomaly).
2. Root cause identification.
3. Mitigation plan with exact shell / gcloud / DNS commands.
4. Verify resolution against fail-closed security invariants."""

class IncidentResponseAgent:
    def __init__(self, api_key: str = None):
        key = api_key or os.environ.get("GEMINI_API_KEY")
        if not key:
            raise ValueError("GEMINI_API_KEY must be provided.")
        self.client = genai.Client(api_key=key)

    async def analyze_incident(self, incident_payload: Dict[str, Any]) -> str:
        prompt = f"""Incoming Incident Report:
{json.dumps(incident_payload, indent=2)}

Please execute the incident response protocol."""

        response = await self.client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=INCIDENT_SYSTEM_PROMPT,
                temperature=0.2,  # Low temperature for precise triage
            )
        )
        return response.text or ""

async def test_sample_incident():
    agent = IncidentResponseAgent()
    sample = {
        "incident_id": "INC-20261028-01",
        "service": "cloud-run",
        "error_message": "run.googleapis.com API is disabled in project project-0317d6c9-e943-409e-83f",
        "impact": "Cloud Run container deployment blocked during build",
        "detected_at": "2026-10-28T22:30:00Z"
    }
    print("[NIRA] Running triage on sample incident...")
    analysis = await agent.analyze_incident(sample)
    print("\n--- Incident Response Plan ---")
    print(analysis)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        asyncio.run(test_sample_incident())
    else:
        print("Usage: python incident_response_agent.py --test")
