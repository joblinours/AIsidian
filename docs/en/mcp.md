# AIsidian MCP server

TypeScript MCP server (official SDK), stateless Streamable HTTP, working directly on the `vault/` files, with its own single-user OAuth 2.1 authorization server.

## Endpoints

| Path | Purpose |
| --- | --- |
| `/mcp` | Main connector: Claude.ai web and mobile, Claude Code |
| `/mcp/agent` | Nightly agent connector: agent tools, simulation mode, write limit |
| `/.well-known/oauth-protected-resource/mcp[/agent]` | Protected resource metadata |
| `/.well-known/oauth-authorization-server` | Authorization server metadata (DCR, CIMD, PKCE S256) |
| `/authorize`, `/token`, `/register`, `/revoke` | OAuth 2.1 |
| `/oauth/login` | Password + TOTP login page |
| `/setup` | First-run wizard (one-time token, then disabled) |
| `/healthz` | Health |
| `:9101/status`, `:9101/healthz` | Monitoring status, **LAN only** |

Each token is bound to the resource requested during authorization: a `/mcp` token is rejected on `/mcp/agent` and vice versa. This is how the server recognises the agent although Claude.ai and scheduled tasks use the same connector mechanism.

## Connecting clients

- **Claude.ai**: *Settings → Connectors → Add custom connector*, URL `https://notes.example.com/mcp`, then *Connect* (password + TOTP).
- **Nightly agent**: second connector "AIsidian Agent", URL `https://notes.example.com/mcp/agent` (see `agent/README.md`).
- **Claude Code**: `claude mcp add --scope user --transport http aisidian https://notes.example.com/mcp`, then `/mcp` → *Authenticate* (loopback redirect, any port).

## Tools

| Read | Write | Agent (`/mcp/agent`) |
| --- | --- | --- |
| `search`, `read_note`, `list_folder`, `list_tags`, `get_metadata`, `find_related`, `find_duplicates` | `create_note`, `append_to_note`, `update_note`, `set_frontmatter`, `add_tags`, `add_link`, `move_note` | `get_changes_since`, `write_report`, `propose_action` |

No delete or merge tool. Server-side rules:

- **Per-folder permissions** (`PERMISSIONS_FILE`; defaults: `99-Système/`, `20-Domaines/DFIR/Certif/`, `20-Domaines/Pro/` read-only), case-insensitive.
- **Paths**: normalised, no `..`, no absolute path, no hidden folder, symlinks refused.
- **Duplicates**: `create_note` refuses an existing name, an already captured `capture_id`, or a very similar title (unless `allow_similar`).
- **Concurrency**: `read_note` returns a `version`; a write with a stale `expected_version` is refused (mandatory for the agent).
- **Status**: nobody can set `validated` through MCP; the agent can only do `draft → unverified`.
- **Agent**: a run starts with `get_changes_since` and ends with `write_report`; in `AGENT_MODE=simulation` writes are validated but not applied; `AGENT_MAX_WRITES` per run; no move outside `00-Inbox/`, no archiving, no rename, no rewrite of more than 30 % of a note.
- **Traceability**: each write is a git commit in the vault and a line in `/state/journal.jsonl`. An hourly commit captures device changes.

## OAuth

DCR (public clients) and CIMD (fetched only from `CIMD_ALLOWED_HOSTS`), PKCE S256, redirect URIs limited to `ALLOWED_REDIRECT_URIS` plus loopback on any port, 1 h access tokens, 60-day rotating refresh tokens with reuse detection (the whole family is revoked), argon2id + TOTP login with replay protection, 15-minute lockout after 5 failures, per-IP rate limits, hashed token storage.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUBLIC_URL` | — | Public URL (OAuth issuer) |
| `AGENT_MODE` | `simulation` | `simulation` or `real` |
| `AGENT_MAX_WRITES` | `50` | Max writes per run |
| `AGENT_RUN_TIMEOUT_MINUTES` | `240` | An unfinished run expires |
| `PERMISSIONS_FILE` | — | Permissions YAML |
| `ALLOWED_REDIRECT_URIS` | Claude callbacks | Comma-separated |
| `CIMD_ALLOWED_HOSTS` | `claude.ai,claude.com` | Hosts allowed for CIMD |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_SECONDS` | `3600` / `5184000` | Lifetimes |
| `HOURLY_COMMIT` | `true` | Hourly commit of device changes |
| `PROPOSALS_NOTE` | `40-Journal/À valider.md` | Proposals note |
| `TRUST_PROXY` | `1` | Express `trust proxy` |

## Administration

```bash
docker compose exec mcp node dist/cli.js status
docker compose exec mcp node dist/cli.js reset-account   # then restart mcp
docker compose exec mcp tail -n 50 /state/journal.jsonl
```

## Development

```bash
cd mcp && npm ci && npm test
```
