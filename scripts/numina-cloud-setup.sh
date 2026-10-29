#!/usr/bin/env bash
set -euo pipefail
NUMINA_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$NUMINA_SCRIPT_DIR/.."
NUMINA_NODE_BIN="$(python3 -B scripts/install-numina-node26.py --print-bin)"
export PATH="$NUMINA_NODE_BIN:$PATH"
test "$(node -p 'process.versions.node')" = 26.11.1
exec python3 -B scripts/build-numina-root-delivery.py --node "$NUMINA_NODE_BIN/node" --build "$@"
