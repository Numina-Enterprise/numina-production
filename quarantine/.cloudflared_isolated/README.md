# Quarantined tunnel credential cleanup

This cleanup removes two Cloudflare Tunnel credential JSON files containing nonempty `TunnelSecret` fields and one `ARGO TUNNEL TOKEN` certificate from the current source tree. Secret values are intentionally omitted.

These files are credential material; this finding does not establish malware, a Trojan, government monitoring, or an active compromise. Credential validity and live tunnel use have not been tested.

The adjacent PowerShell scripts are retained. No tunnel has been stopped, no credential has been revoked, and no production configuration has been changed by this cleanup. Ignore rules now cover the credential files in `.cloudflared` and `.cloudflared_isolated` directories.

## Remaining credential response

- Treat any still-valid credentials from these files as exposed to repository readers.
- The Cloudflare account owner must assess and rotate or revoke affected tunnel and account credentials through an authenticated account session. Avoid interrupting a required live tunnel without a replacement.
- Previous Git commits and any earlier copies may still contain the removed material. This cleanup does not rewrite history or invalidate those copies.
- Merge of this cleanup and credential rotation must be verified separately; this document is not proof of revocation or device remediation.
