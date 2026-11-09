# GRC workspaces (local-only, CONFIG ONLY)

Two optional self-hosted GRC tools to track the risks, controls and evidence in
[`control-mapping.json`](control-mapping.json). Neither has been started on the build box, which
has no Docker. These files are configs only: they are untested and have not been run.

| Tool | License | Config | URL once running |
|---|---|---|---|
| Probo | MIT | `probo/compose.yaml`, `probo/.env.example` | http://127.0.0.1:8080 |
| Comp AI Community Edition | **AGPL-3.0** | `comp-ai/docker-compose.yml`, `comp-ai/.env.example` | http://127.0.0.1:3000 (portal 3002) |

Every published port is bound to `127.0.0.1`. Databases, object storage and headless Chrome are not
published at all. `tests/compliance/checklist-configs.test.mjs` and the gate self-check enforce this.

## Rules
- Fill `.env` from `.env.example` with locally generated secrets. `.env` is gitignored.
- No sign-ups. Leave every third-party key empty: Resend, OpenAI/Anthropic/Groq, Upstash, Trigger.dev,
  PostHog, Vercel, AWS, Stripe and OAuth. **Never put a Stripe key in Comp AI.**
- Without an email provider, Comp AI's emailed sign-in links will not arrive. That limits local use until
  Sam chooses to configure one. Probo's invitations also need SMTP, which is set to an unreachable address
  on purpose.
- Do not upload identity documents or case packets to either tool. Evidence entries point to commands
  and files that stay in `local/compliance/data/`.

## AGPL flag (Comp AI CE)
Comp AI CE is AGPLv3. Using it privately inside Numina Labs creates no obligation to publish anything.
If a **modified** Comp AI is ever offered to other people over a network (for example, clients log in to
it), AGPL section 13 requires offering those users the complete corresponding source of the modified
version. Keep it local and unmodified, or get counsel's sign-off first.

## Mapping
`control-mapping.json` has 6 risks and 16 controls. Each control lists the checklist items it satisfies
(see `../CHECKLIST.md`) and its evidence (`cmd:`, `file:` or `url:`). Two controls are open gaps:
`CTL-IDV` (no licensed IDV provider yet) and `CTL-ATTORNEY` (attorney review pending, follow-up due
2026-12-09).
