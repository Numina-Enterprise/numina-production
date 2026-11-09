#!/bin/sh
# Validate the checked-in release binding; never synthesize fallback metadata.
set -eu
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
EXPECTED_REPOSITORY=https://github.com/Numina-Enterprise/numina-production
case "$(git config --get remote.origin.url)" in
  "$EXPECTED_REPOSITORY"|"$EXPECTED_REPOSITORY.git"|git@github.com:Numina-Enterprise/numina-production.git) ;;
  *) echo "Unexpected Numina source repository" >&2; exit 1 ;;
esac
test -f mobile/ios/Configuration/NuminaRelease.xcconfig
grep -qx 'MARKETING_VERSION = 5.0.0' mobile/ios/Configuration/Numina.xcconfig
grep -qx 'NUMINA_APPLICATION_MANIFEST = /v5/release/manifest' mobile/ios/Configuration/NuminaRelease.xcconfig
echo 'Numina 5.0.0 checked-in iOS release binding validated.'
