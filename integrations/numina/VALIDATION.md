# Package status — 2.0.0

No tests, live model-provider calls, SDK examples, MCP host installation or production endpoint checks were run for this version, following the user's instruction.

The update changes the kit/MCP version to 2.0.0 and adds a read-only application-release tool linked to `/v2/release/manifest`. Provider descriptors were regenerated from source. The archive and included file manifest have SHA-256 digests computed during packaging.

The prior `0.2.0` validation records are retained under `history/0.2.0/`. Their reported 50 passing checks apply to the earlier package, not this 2.0.0 source. The original historical distribution remains separate.

Not established: provider acceptance, universal model compatibility, account installation, registry publication, hosted remote MCP, app-store approval, new deployment, signature/artifact verification by this client, NUSD activation, minting, transfers, settlement or independent security review.

## Runtime-evidence packaging revision

This 2.0.0 archive revision adds the fifth discovery tool, numina_runtime_build, using the existing application-manifest route. The provider adapters and MCP protocol set are unchanged. Source syntax and generated JSON are inspected as packaging checks; no test suite, model-provider call, host installation or production deployment is performed here. File and archive hashes identify this revision; earlier 2.0.0 archive hashes do not identify these changed bytes.

## Root-record alignment revision

Revision `root-readiness-v2.0.0` extends the existing runtime-build result with optional root NUSD receipt and activation-readiness objects. It performs structural checks only and explicitly reports that receipt/readiness verification was not performed. Missing optional fields remain absent. The five default read-only discovery tools, version 2.0.0, provider adapters and MCP protocol set remain unchanged. Updated descriptors and file digests are generated from the edited source; this does not validate provider acceptance or publish the package anywhere.
