#!/bin/sh
# Xcode Cloud ci_post_clone.sh script for Numina iOS
# Enforces cluster state root and invariant alignment before compilation

set -e

echo "=== Numina Xcode Cloud Post-Clone Hook ==="
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Target: xyz.numinalabs.app (Version 4.0.0, Build 6)"
echo "Cluster State Root: 726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd"

# Ensure NuminaRelease.xcconfig exists
CONFIG_PATH="$CI_WORKSPACE/mobile/ios/Configuration/NuminaRelease.xcconfig"
if [ ! -f "$CONFIG_PATH" ]; then
    echo "Synthesizing NuminaRelease.xcconfig for CI build..."
    cat <<EOF > "$CONFIG_PATH"
NUMINA_RUNTIME_VERSION = 1.9.0-rc27
NUMINA_CORE_VERSION = 1.8.0
NUMINA_FROZEN_CORE_ROOT = 726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd
NUMINA_APPLICATION_MANIFEST = /api/v1/manifest
NUMINA_TELEMETRY_ENDPOINT = https://numinalabs.xyz/api/telemetry
EOF
fi

echo "Xcode Cloud environment calibrated."
