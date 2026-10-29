# Security notes

This workspace contains policy and provisioning examples. Review them against the
actual Tailnet, host inventory, and identity provider before deployment.

## Safe defaults

- The ACL permits only Tailscale SSH on TCP/22 to tag:server.
- The server-to-server wildcard mesh rule was removed.
- UFW is activated with deny-by-default incoming policy and no TCP/22 allow
  rule, including on tailscale0.
- The Ansible community.general.ufw module is quarantined; the playbook uses
  explicit ufw commands instead.
- SSH step-up checks expire after one hour.
- Root SSH access is not granted by the policy.
- Automatic Tailscale installation requires an explicit, reviewed SHA-256.
- Route acceptance and UFW activation are explicit controls in the provisioning
  script; confirm out-of-band console access before enabling UFW on a remote host.

## Before applying the policy

1. Replace example test identities in acl_policy.hujson with real, reviewed
   identities. Do not add broad groups or wildcard destinations without a written
   need.
2. Run the Tailscale policy preview and tests in the Admin Console.
3. Confirm that every target has a break-glass console path before enabling UFW.
4. Provide TAILSCALE_AUTHKEY only through a protected secret mechanism. Never
   commit it, paste it into chat, or place it in a command recorded in shell
   history.
5. Review users in the SSH rule and keep only non-root accounts that are
   actually required.

## Workspace hygiene

.gitignore excludes common credentials, private keys, auth keys, tokens, and
Ansible artifacts. Treat this folder as sensitive until the policy and inventory
have been reviewed.
