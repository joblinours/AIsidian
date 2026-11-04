# Installation

Recommended order: [phase 1](phase-1.md) proofs of concept first, then this procedure. Backups must be running **before** any automatic write is enabled.

## Prerequisites

- A Docker host (LXC or VM) with Docker Compose v2, and Portainer if you deploy from its UI.
- A mount point for the Restic repository (e.g. NFS or bind mount of a NAS): `RESTIC_REPOSITORY_PATH`.
- An existing Cloudflare Tunnel and Cloudflare Zero Trust (Access).
- Two sub-domains: one for the MCP server (e.g. `notes.example.com`), one for CouchDB (e.g. `couch.example.com`).
- A TOTP app (Aegis, 2FAS, Bitwarden…).

## 1. Stack variables

Copy `.env.example` (or paste it into the Portainer stack variables) and set at least:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_URL` | Public URL of the MCP server, e.g. `https://notes.example.com` |
| `COUCHDB_ADMIN_USER` / `COUCHDB_ADMIN_PASSWORD` | CouchDB administrator (never used by devices) |
| `COUCHDB_SYNC_USER` / `COUCHDB_SYNC_PASSWORD` | Dedicated LiveSync user |
| `RESTIC_REPOSITORY_PATH` / `RESTIC_PASSWORD` | Restic repository and its password (keep it in your password manager) |
| `AGENT_MODE` | `simulation` at first |
| `AISIDIAN_TAG` | `latest` (or `vX.Y.Z`); never `dev` in production |

## 2. Deploy

Portainer: *Stacks → Add stack → Repository* (branch `main`, file `docker-compose.yml`), then the variables. Or:

```bash
docker compose up -d
```

On first start, `volumes-init` gives the volumes to `PUID:PGID`, `couchdb-init` configures CouchDB for LiveSync and `backup` initialises the Restic repository and takes a first snapshot.

## 3. Cloudflare

See [cloudflare.md](cloudflare.md): two tunnel routes, one Access application with a service token in front of CouchDB only.

## 4. MCP account

The `mcp` container logs print a one-time link:

```bash
docker compose logs mcp | grep -A1 "Ouvre ce lien"
```

Open it, scan the TOTP QR code, choose a password (12 characters minimum) and confirm with a code. `/setup` is then disabled. To start over: `docker compose exec mcp node dist/cli.js reset-account` and restart `mcp`.

## 5. LiveSync

See [livesync.md](livesync.md).

## 6. Vault layout

```bash
scripts/install-vault-template.sh
```

Copies `vault-template/` and the `agent/` files (into `99-Système/Agent/`) without overwriting anything. Restart `livesync` afterwards so it loads `.livesync/ignore` (excludes `.git`).

## 7. Claude connectors

See [mcp.md](mcp.md).

## 8. Capture

- Claude.ai: upload the `skills/aisidian-capture/` folder (zipped) under *Settings → Capabilities → Skills*.
- Claude Code (Linux, WSL): `hooks/install.sh https://notes.example.com`.
- Claude Code on the web: add `hooks/claude-md-snippet.md` to the projects' `CLAUDE.md` and the MCP server to the environment.

## 9. Nightly agent

See [`agent/README.md`](../../agent/README.md): three nights in simulation, then `AGENT_MODE=real`.

## 10. Web UI

Set `WEB_PUBLIC_URL`, add the tunnel route ([cloudflare.md](cloudflare.md)) and open the URL: same password and TOTP as the connector. See [web.md](web.md).

## 11. Monitoring

See [monitoring.md](monitoring.md).

## Updates

Stable images are published to GHCR on every `vX.Y.Z` tag on `main`. Update = *Pull and redeploy* in Portainer (or `docker compose pull && docker compose up -d`).

## Protecting `main` (GitHub)

Once, in *Settings → Branches*: rule on `main`, pull request required, CI checks required, no direct push.
