#!/usr/bin/env bash
set -euo pipefail
NUMINA_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$NUMINA_SCRIPT_DIR/.."
NUMINA_NODE_BIN="$(python3 -B scripts/install-numina-node26.py --prefix "${NUMINA_NODE_PREFIX:-$(dirname -- "$PWD")/.numina-tools}" --print-bin)"
exec "$NUMINA_NODE_BIN/node" scripts/serve-numina-cloud.mjs "$@"
