# Phase 1 — proofs of concept

Three proofs must pass before phase 2; each failure requires a documented decision. Detailed steps are in the French version ([../fr/phase-1.md](../fr/phase-1.md)); summary:

| Proof | Pass criteria | If it fails |
| --- | --- | --- |
| **P1** livesync-cli: E2EE, path obfuscation, two-way writes | Unreadable data in CouchDB; PC → `vault/` and `vault/` → PC (accented paths); conflict reported without loss; deletions propagate; restart resumes; `.git/` never synced | Fallback: Obsidian in a container (`fallback` profile) |
| **P2** Cloudflare Access headers on desktop and iOS | 403 without headers; desktop and iPhone on cellular sync with `CF-Access-Client-Id/Secret` custom headers | Another access mechanism (to decide) |
| **P3** Cloud scheduled task + OAuth MCP + token refresh | With `ACCESS_TOKEN_TTL_SECONDS=300`, 3 consecutive hourly runs calling `get_changes_since` and `write_report` without any manual login | Reopen the "cloud-only agent" decision |

| Proof | Date | Result | Notes / decision |
| --- | --- | --- | --- |
| P1 | | | |
| P2 desktop | | | |
| P2 iOS | | | |
| P3 | | | |
