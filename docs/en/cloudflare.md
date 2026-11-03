# Cloudflare

All external traffic goes through an existing Cloudflare Tunnel: no open port, no public IP.

## Tunnel routes (dashboard)

| Hostname | Service | Notes |
| --- | --- | --- |
| `notes.example.com` | `http://<docker host>:8080` | MCP + OAuth. **No** Access application (an interactive login page would block Claude) |
| `couch.example.com` | `http://<docker host>:5984` | CouchDB, behind Access |

Port `9101` (status for monitoring) must **never** be routed through the tunnel.

## Access in front of CouchDB

1. *Access → Service Auth → Service Tokens → Create*; keep the Client ID and Secret.
2. *Access → Applications → Add → Self-hosted*: domain `couch.example.com`.
3. Policy: action **Service Auth**, *Include → Service Token →* your token.
4. Application *CORS* settings: enable **Bypass options requests to origin** so CORS preflights (sent without headers) reach CouchDB, which answers them (`couchdb-init` allows the `cf-access-client-id` / `cf-access-client-secret` headers).

LiveSync sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` through its *Custom headers* setting (to validate in phase 1 on desktop and iOS).

T14:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://couch.example.com/        # expected: 403 (Access)
curl -s -o /dev/null -w '%{http_code}\n' https://couch.example.com/ \
  -H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET"     # expected: 401 (CouchDB auth)
```

## MCP domain

- No Access, no IP allow-list: security relies on the server's OAuth (password + TOTP) and rate limits.
- With *Bot Fight Mode* or WAF rules, add a *Skip* rule for `notes.example.com` on `/mcp*`, `/.well-known/*`, `/register`, `/token`, `/authorize`, `/revoke`, `/oauth/*`: calls come from Anthropic's servers.
- The server reads the client IP from `CF-Connecting-IP` for rate limiting.
