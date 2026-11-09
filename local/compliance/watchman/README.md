# Moov Watchman — local sanctions gate

[Moov Watchman](https://github.com/moov-io/watchman) (Apache-2.0) indexes the official OFAC SDN and
non-SDN lists plus other free government lists (US CSL, FinCEN 311, UK, EU, UN) and scores names 0–1.
The Numina client (`lib/watchman.mjs`) calls it on `127.0.0.1:8084` and falls back to the built-in
matcher when it is not running. `npm run compliance:gate` and every screen record which engine ran.

OpenSanctions/Senzing lists and yente are intentionally **not** configured (business use needs a paid licence).

## Option A — Docker (binds 127.0.0.1 only)

```
docker compose -f local/compliance/watchman/docker-compose.yml up -d
```

Compose mounts `watchman.docker.yml` (same lists; listens on the container interface so the
`127.0.0.1:8084` host mapping works). The admin port is not published. Host exposure is loopback-only.

## Option B — release binary or source build (no Docker)

Release v1.2.2 binaries: https://github.com/moov-io/watchman/releases/tag/v1.2.2
(`watchman-linux-amd64` needs `libpostal.so.1`; `watchman.exe` on Windows uses usaddress and needs nothing extra).

```
# Windows (PowerShell)
$env:APP_CONFIG="local\compliance\watchman\watchman.yml"; .\watchman.exe
# Linux/macOS without libpostal: build from source (Go 1.25+)
git clone --depth 1 --branch v1.2.2 https://github.com/moov-io/watchman && cd watchman
CGO_ENABLED=0 go build -o watchman ./cmd/server
APP_CONFIG=/path/to/local/compliance/watchman/watchman.yml ./watchman
```

`watchman.yml` binds the API to `127.0.0.1:8084` and the admin port to `127.0.0.1:9094`, with pprof disabled.

## Checks

```
curl -s http://127.0.0.1:8084/v2/listinfo        # list counts + hashes
npm run compliance -- engines                     # what the Numina client will use
```

Watchman does not persist queries; the Numina case store records every screen (engine, list hashes,
scores) in the encrypted, gitignored data dir.
