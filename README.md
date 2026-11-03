# AIsidian

*[Version française](README.fr.md)*

A self-hosted Obsidian second brain that Claude writes to. Claude (Claude.ai web/mobile, scheduled tasks, Claude Code) adds notes through an MCP server, a nightly agent files them, and the vault is synchronised on every device with [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync).

```
 Claude.ai / Claude Code ──HTTPS──┐                     ┌── PC, phone… (Obsidian + LiveSync)
 Scheduled task (agent) ──HTTPS──┐│                     │
                                 ▼▼                     ▼
                      Cloudflare Tunnel ─────── Cloudflare Access (service token)
                         │                                 │
             notes.<domain> → mcp :8080          couch.<domain> → couchdb :5984
                         │                                 │  (E2EE, obfuscated paths)
                         ▼                                 ▼
                    vault/ (plain files) ◄──── livesync-cli (headless client)
                    + local git history
                         │
                     backup (Restic, hourly) → NAS
```

## Components

| Directory | Content |
| --- | --- |
| [`mcp/`](mcp) | MCP server (TypeScript, official SDK) with built-in single-user OAuth 2.1 (password + TOTP), per-folder permissions, git commit per write, no delete tool |
| [`couchdb-init/`](couchdb-init) | One-shot CouchDB setup for LiveSync |
| [`backup/`](backup) | Restic image: hourly backups, retention, restore |
| [`agent/`](agent) | Nightly agent prompt, rules and report template |
| [`skills/`](skills) | Claude.ai skill: "save this to the vault" |
| [`hooks/`](hooks) | Claude Code `SessionEnd` hook for automatic capture |
| [`vault-template/`](vault-template) | Starting vault layout (PARA-style) and templates |
| [`docs/`](docs/en) | Installation, Cloudflare, LiveSync, MCP, security, restore, monitoring, tests |

Notes, prompts and vault conventions are written in French; the code and this README are in English.

## Quick start

1. Run the [phase 1 proofs of concept](docs/en/phase-1.md).
2. Copy `.env.example`, fill it, deploy `docker-compose.yml` (Portainer or `docker compose up -d`).
3. Follow [docs/en/installation.md](docs/en/installation.md).

## Security model

No public port (Cloudflare Tunnel), CouchDB behind Cloudflare Access + its own auth + end-to-end encryption, MCP behind OAuth with TOTP, a hardened read-only container, a separate agent endpoint with server-enforced simulation mode and write limits, local git history to undo any change, hourly Restic backups. See [docs/en/security.md](docs/en/security.md).

## Development

- All work happens on `dev`; `main` only receives stable releases through pull requests with green CI.
- CI runs tests, shellcheck, compose validation and a Trivy scan on every push and pull request; a push to `dev` publishes `:dev` images, a `vX.Y.Z` tag publishes `:latest` and `:vX.Y.Z` to GHCR.

```bash
cd mcp && npm ci && npm test
```

## License

[MIT](LICENSE)
