# Numina Node 26 cloud toolchain

The current Numina build and local cloud preview select **Node 26.11.1**. The isolated Linux installation includes **npm 11.20.0**. The official archive's SHA-256 matches both the pinned configuration and its entry in Node's `SHASUMS256.txt`.

The canonical source is `/workspace/numina-production`. Install or locate the toolchain, then select it for the current shell:

```sh
cd /workspace/numina-production
NUMINA_NODE_BIN="$(python3 scripts/install-numina-node26.py --print-bin)"
export PATH="$NUMINA_NODE_BIN:$PATH"
node --version
```

The installer keeps existing system Node installations intact. On macOS, supply a separate absolute directory with `--prefix`. The package contains pinned official Linux and macOS archives for x64 and arm64. A matching existing installation is reused after its retained record and executable version are checked; reuse does not claim a new archive download.

After the canonical distribution exists, start its local preview:

```sh
npm start
```

The preview binds `127.0.0.1:8788` and imports `dist/server/index.js` as a Web API Worker adapter. `/__numina/cloud-runtime` reports the actual Node version and adapter scope. Public assets and public MCP discovery are available; private D1/R2 services, signing and financial execution are unavailable. The adapter does not generate a key or create a replacement journal. A local preview does not activate the production Worker or establish an N50 deployment.

Node 26 was already selected by the hosted CI start workflow added on October 2, 2026, at source commit `8a8daccf521421aac4dba70dd9a853a5b184014f`. The current exact pin identifies a separate, newly observed installation.

The managed execution host still supplies Node 24.19.0 on its original path. Select the isolated Node 26 binary explicitly when running Numina. The live cloud setup script does this and prepares the canonical tree directly. Its archived signed predecessor remains unchanged.

The historical trusted Site builder remains pinned to Node 24.21.0. NUSD package and container toolchains retain their separate Node 24 pins. The production Worker executes its Web API bundle; changing the build toolchain does not establish that the hosted Worker runs Node 26. This setup records installation and executable identity, without claiming application compatibility, deployment or proof acceptance.
