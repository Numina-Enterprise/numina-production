# Numina Agent Training Lab — Guild Onboarding MVP

> **Private-development design; not a live WoW/Discord integration.**
> The source repository is public. Never commit Discord invite tokens, Battle.net credentials, payment credentials, session cookies, or private voice recordings.

## Human-led guild onboarding (pinned instructions)

- **Guild scenario:** MyCentralGuild (user-supplied name; spelling and in-game realm must be confirmed by the human leader).
- **Guild leader:** the human owner retains all administrative and in-game authority.
- **In-game invite contact:** BurberrySlipper (user-supplied display name; human operator may whisper this character for a manual guild invitation).
- **Account starting point:** a human-operated World of Warcraft trial account, subject to current Blizzard eligibility and account limits. Trial accounts may be restricted from joining guilds; confirm eligibility in the client before requesting any invite.
- **Discord:** the owner supplied an invitation outside the repository. Its token is intentionally **not** recorded here; distribute it only through a trusted private channel.
- **No assistant or Numina agent sign-in has occurred.** No Discord message, guild request, character action, or account creation was performed by the software committed here.

## MVP runbook

1. The human owner manually configures the trial account and Discord membership, reviews Blizzard/Discord rules, and keeps credentials private.
2. The owner or designated human participant enters the game, selects a paladin tank if desired, and handles guild invitation and gameplay directly.
3. During the dungeon, training observers may record **consented, non-sensitive** events (orders given, response timing, resource decisions, recoveries). They must not scrape private conversations or act in the game.
4. Each simulated exercise generates an audit record: participant/division, scenario, authorizer, before balance, simulated debit/credit, after balance, reconciliation result, evidence reference, and Gamma evaluation score.
5. Publish only verified, redacted, read-only exercise summaries in the future command center after server access and channel permissions are independently checked.

## Guild rank plan

Human Guild Leader > proposal-only co-GM coordinator > owner-approved Officers > Veterans > Members > Initiates. No automatic role elevation. Gold coordinates release readiness; Blue reviews safety; White diagnoses; Green checks operations; Red independently reviews; Gamma implements/tests and scores offline exercises.

## Practice economy and acceptance

The **practice guild bank** consists of synthetic balances, not actual in-game gold, NUSD, USD, or bank funds. Initial pilot: **5,000 simulated gold across five color-team divisions**, 1,000 gold each. Fifteen training rooms can run their own exercises without creating additional real treasuries. Proposed Gamma scoring: authorization 25, transaction accuracy 25, efficiency 15, teamwork 20, recovery 15; pass >=90/100; automatic fail on unauthorized transactions or unexplained balances.

Never report unverified real holdings as available. The treasury summary is read-only and contains no spending, signing, production, or wallet-control buttons.

## Implementation evidence

- Private lab and treasury config: `config/numina-agent-training-lab.v1.json`, `config/numina-agent-capital.v1.json`
- Discord room proposal: `config/numina-discord-command-center.v1.json`
- Guild bank evaluation: `config/numina-guild-bank-evaluation.v1.json`
- Offline exercise runner: `src/training-lab/run-training-cycle.mjs`
- CI: `.github/workflows/private-agent-lab.yml`
- Review: https://github.com/Numina-Enterprise/numina-production/pull/203

**Live-game status:** NOT CONNECTED. **Discord status:** NOT CONNECTED. **Production/treasury authority:** NONE.
