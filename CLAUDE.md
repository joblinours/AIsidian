# AIsidian — notes for Claude Code

- Develop on `dev` only; `main` is protected and receives releases through PRs.
- MCP server: `cd mcp && npm ci && npm run typecheck && npm test` before every commit touching `mcp/`.
- Shell scripts: POSIX `sh` in `backup/`, `couchdb-init/`, `scripts/` (Alpine images); `bash` in `hooks/`. Run `shellcheck`.
- `docker compose config -q` with `.env.example` copied to `.env` must pass.
- The repository is public and generic: never commit domains, IPs, user names or secrets of a real deployment; everything specific goes in environment variables.
- Vault conventions, agent prompts, skill and user-facing messages of the MCP server are in French; code, comments and commit scopes in English or French consistently with the surrounding file.
- The MCP server must never get a delete/merge tool or a command-execution tool, and must keep enforcing permissions, simulation mode and the write limit server-side.
