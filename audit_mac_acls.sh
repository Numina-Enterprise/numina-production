#!/usr/bin/env bash
# macOS POSIX & ACL Security Audit
# Aligned with Numina Zero-Trust Governance (numina-apple-team)

set -euo pipefail

TARGET_PATHS=(
    "/Library/Logs"
    "/Library/Preferences"
    "/Library/LaunchDaemons"
    "/Library/LaunchAgents"
    "/private/var/log"
    "/private/tmp"
)

echo "=========================================================="
echo " NUMINA macOS ACL & PERMISSION AUDIT (ZERO-TRUST)"
echo " Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=========================================================="
printf "%-30s | %-10s | %-10s | %-10s | %-6s\n" "Path" "Owner" "Group" "Perms" "ACLs"
echo "--------------------------------------------------------------------------------"

for p in "${TARGET_PATHS[@]}"; do
    if [ -e "$p" ]; then
        owner=$(stat -f "%Su" "$p" 2>/dev/null || echo "Unknown")
        group=$(stat -f "%Sg" "$p" 2>/dev/null || echo "Unknown")
        perms=$(stat -f "%Sp" "$p" 2>/dev/null || echo "Unknown")
        # Check if extended ACLs are present (+ indicator in ls -ld)
        acl_present=$(ls -ld "$p" 2>/dev/null | grep -q '+' && echo "Yes" || echo "No")
        printf "%-30s | %-10s | %-10s | %-10s | %-6s\n" "$p" "$owner" "$group" "$perms" "$acl_present"
    else
        printf "%-30s | %-10s | %-10s | %-10s | %-6s\n" "$p" "NotFound" "NotFound" "N/A" "No"
    fi
done
echo "=========================================================="
