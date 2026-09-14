# Production control gateway

The active v4 deployment is assembled with scripts/package-rc26.py from the preserved rc26 verifier. The generated ASGI entrypoint adds bounded-route HTTP telemetry; the Node connection endpoint uses the same event schema. Owner operations, including Numina's classical quantum simulator, route to the canonical Sites application. Historical rc22 gateway modules remain for archive context and are not assembled into the active verifier. Deployment and hardware connection status must come from the providers, not this source note.
