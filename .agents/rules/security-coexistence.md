---
description: Antivirus engine registration and coexistence diagnostics on Windows
---

# Antivirus Engine Diagnostics & Coexistence

When diagnosing Windows Defender alert states:

1. Always query `root/SecurityCenter2` via:
   `Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct`
   before assuming system compromise.
2. If third-party antivirus (e.g. McAfee) is registered and active (`productState: 266240`), Windows Defender automatically sets `RealTimeProtectionEnabled: False` by Windows design to prevent kernel deadlock.
3. Do not treat `RealTimeProtectionEnabled: False` in Defender as an infection when third-party real-time protection is verified active and green.
4. Distinguish web-based scam notification pop-ups (e.g. simulated Trojan banners) from real antivirus quarantine detections by checking the active AV console.
