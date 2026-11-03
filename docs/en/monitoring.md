# Monitoring (Zabbix)

The MCP server exposes a JSON status on port `9101`, **LAN only** (`/status`, `/healthz`).

| Item | Type | Source | Trigger |
| --- | --- | --- | --- |
| MCP up | HTTP agent | `http://<host>:9101/healthz` | non-200 for 5 min |
| MCP public | Web scenario | `https://notes.example.com/healthz` | 3 failures |
| CouchDB up | HTTP agent | `http://<host>:5984/_up` (admin auth) | non-200 |
| Containers | Zabbix agent 2 Docker plugin | `couchdb`, `livesync`, `mcp`, `backup` running (+ Docker healthchecks) | not running |
| AIsidian status | HTTP agent (master item) | `http://<host>:9101/status` | — |
| Last snapshot age | Dependent, `$.backup.last_success_epoch`, JS `return Math.floor(Date.now()/1000) - value;` | — | > 7200 s |
| Last agent report | Dependent, `$.agent.last_report_age_s` | — | > 21600 s and `time()>=080000` |
| Device activity | Dependent, `$.vault.last_commit_age_s` | — | info |
| Vault size | Dependent, `$.vault.bytes` | — | trend |
| CouchDB size | HTTP agent `http://<host>:5984/<db>`, `$.sizes.file` | — | trend / threshold |

Known limit: livesync-cli exposes no sync status yet. Freshness of the headless client is approximated by the container state, restart count and the age of the last hourly commit.
