# Security and threat model

| Threat | Mitigations |
| --- | --- |
| Reaching the infrastructure through MCP | Non-root container, read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, no Docker socket, only `vault/` and `mcp-state/` mounted; no command execution tool; normalised paths, symlinks never followed; dedicated Docker network, separate from CouchDB |
| Runaway agent, prompt injection through a captured note | No delete or merge tool; read-only folders enforced by the server; dedicated agent endpoint with server-side simulation mode and write limit; agent restrictions (no archive, rename or large rewrite, moves from the Inbox only); git to undo everything; note content tagged and recalled as data on every read and in the server instructions |
| Vault access through the web UI | Same account (argon2id + TOTP, replay protection, lockout, per-IP limits); `HttpOnly` `SameSite=Strict` time-limited session; CSRF protection; strict CSP, no third-party resource; Markdown rendered without `innerHTML`; no delete; hardened container on a dedicated network; git commit and journal on every write ([web.md](web.md)) |
| Data leak | OAuth 2.1 with argon2id password + TOTP; Access service token + CouchDB auth; E2EE and path obfuscation in CouchDB; login rate limits and lockout; resource-bound, hashed, rotating tokens with reuse detection; MCP access journal; monitoring status on a non-exposed port |

Secrets live in a password manager or in the Portainer stack variables, never in the repository (only `.env.example`).

Accepted risks: no off-site backup, E2EE passphrase stored on the server, production only, no host firewall yet (future: only accept the tunnel connector on 8080/5984 and the monitoring server on 9101).

Report vulnerabilities through a private GitHub security advisory.
