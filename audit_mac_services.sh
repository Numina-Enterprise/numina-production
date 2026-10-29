#!/usr/bin/env bash
# macOS Background Services & LaunchDaemons Audit
# Aligned with Numina Zero-Trust Governance (numina-apple-team)

set -euo pipefail

echo "=========================================================="
echo " NUMINA macOS SERVICE & LAUNCH DAEMON AUDIT"
echo " Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=========================================================="

if command -v launchctl >/dev/null 2>&1; then
    echo "[+] Querying launchctl system domain..."
    printf "%-10s | %-10s | %-40s\n" "PID" "Status" "Label"
    echo "------------------------------------------------------------------"
    launchctl list | head -n 25 | while read -r pid status label; do
        printf "%-10s | %-10s | %-40s\n" "$pid" "$status" "$label"
    done
else
    echo "[-] launchctl not available in current environment."
fi

echo ""
echo "[+] Checking registered LaunchDaemons in /Library/LaunchDaemons:"
if [ -d "/Library/LaunchDaemons" ]; then
    ls -la /Library/LaunchDaemons
else
    echo "[-] /Library/LaunchDaemons not found."
fi
echo "=========================================================="
