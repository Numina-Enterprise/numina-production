#!/usr/bin/env bash
# macOS Storage & Log Directory Sizing Audit
# Aligned with Numina Zero-Trust Governance (numina-apple-team)

set -euo pipefail

TARGET_DIRS=(
    "/Library/Logs"
    "/private/var/log"
    "/private/tmp"
    "$HOME/Library/Caches"
    "$HOME/Library/Logs"
)

echo "=========================================================="
echo " NUMINA macOS STORAGE & LOG DIRECTORY SIZING AUDIT"
echo " Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=========================================================="
printf "%-35s | %-12s | %-10s\n" "Directory" "Size" "File Count"
echo "------------------------------------------------------------------"

for dir in "${TARGET_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        size=$(du -sh "$dir" 2>/dev/null | awk '{print $1}')
        count=$(find "$dir" -type f 2>/dev/null | wc -l | tr -d ' ')
        printf "%-35s | %-12s | %-10s\n" "$dir" "$size" "$count"
    else
        printf "%-35s | %-12s | %-10s\n" "$dir" "NotFound" "0"
    fi
done
echo "=========================================================="
