# Numina 5.0.0

Numina 5 is the major application release for the central numinalabs.xyz experience, shared visual system, ecosystem navigation, multi-cloud source contract and modernized build lanes.

Core **2.0.0** and runtime **2.0.0-rc27** keep their independent version identities. The build toolchain is **Node 26.13.0**. Native source targets are iOS **5.0.0 / build 7** and Android **5.0.0 / version code 5**.

## Changes

- New homepage visual identity, responsive layouts and shared styling across the public site and workspaces.
- Central ecosystem directory linking source, documentation, integrations, mobile releases and the existing private operations control room.
- Filterable topology explorer covering Cloudflare, Google Cloud, AWS, Azure, IBM Cloud, IBM Quantum and Tailscale.
- `/v5/release/manifest` and version 5 source archives; earlier manifest routes remain compatibility aliases.
- Root npm lockfile restored; maintained npm engines and isolated checksum-pinned toolchains aligned to Node 26.13.0.
- Orphaned embedded-repository gitlink removed while its exact archive and original commit reference are preserved.
- Cloudflare deployment configuration preserves existing storage bindings and separates deployment credentials from application credentials.
- Native signing workflows identify Numina-Enterprise/numina-production and compile current source before signing with existing configured identities.

## Evidence scope

Source, tests and packaging are independently checkable. A successful source build does not establish a live deployment, signed mobile artifact, store acceptance, cloud health or replication. Previous artifacts keep their exact bytes and historical evidence. Current deployment and signing outcomes must be attached to this release after their provider runs finish.
