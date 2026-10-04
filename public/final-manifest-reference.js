// Generated owner-evidence discovery only; private identities and values are not projected.
export const NUMINA_FINAL_MANIFEST_REFERENCE=Object.freeze({
  "applicationVersion": "4.0.0",
  "scope": "SOFTWARE_SOURCE_BINDINGS_ONLY",
  "manifest": {
    "route": "/final-manifest.json",
    "access": "authenticated_owner"
  },
  "build": {
    "route": "/final-build.json",
    "access": "authenticated_owner"
  },
  "currentTreasury": {
    "route": "/api/control/v1/treasury",
    "status": "AUTHENTICATED_CURRENT_RECORD_REQUIRED"
  }
});
