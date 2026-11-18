#!/usr/bin/env bash
# Non-production real GGUF smoke on an operator-approved machine.
# Requires an already reviewed, SHA-pinned checkpoint and built llama-cli.
set -euo pipefail
: "${NUMINA_GGUF_MODEL:?absolute reviewed GGUF path required}"
: "${NUMINA_GGUF_SHA256:?published GGUF SHA-256 required}"
: "${NUMINA_LLAMA_CLI:?absolute reviewed llama-cli path required}"
: "${NUMINA_RECEIPT:?unique evidence receipt path required}"
: "${NUMINA_LICENSE_REVIEWED:?set to yes after documented license review}"
[[ "$NUMINA_LICENSE_REVIEWED" == yes ]] || { echo 'License review required' >&2; exit 1; }
[[ "$NUMINA_GGUF_SHA256" =~ ^[0-9a-f]{64}$ ]] || exit 1
[[ "$NUMINA_GGUF_MODEL" = /* && "$NUMINA_LLAMA_CLI" = /* && "$NUMINA_RECEIPT" = /* ]] || exit 1
[[ ! -e "$NUMINA_RECEIPT" ]] || { echo 'Receipt already exists' >&2; exit 1; }
python3 ml/inference/accept_real_gguf.py \
  --cli "$NUMINA_LLAMA_CLI" --model "$NUMINA_GGUF_MODEL" \
  --model-sha256 "$NUMINA_GGUF_SHA256" \
  --prompt 'Once upon a time' --max-tokens 32 --output "$NUMINA_RECEIPT"
