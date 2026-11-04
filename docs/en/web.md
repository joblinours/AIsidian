# Web UI

Tiling, Hyprland-style web UI for the vault (Catppuccin Mocha): tabbed editor (Markdown read and edit), link graph (global or local) and explorer (tree, search, import, export). Container `web`, exposed through the tunnel on its own sub-domain.

- **Account**: the same as the MCP server (password + TOTP, created by the MCP `/setup` wizard); `account.json` is mounted read-only from `mcp-state`.
- **Rights**: like Obsidian (every folder writable, `validated` allowed), **no delete** at all.
- **Traceability**: every save, creation or import is a git commit (`[web] …`) and a journal line in `web-state`.
- **Conflicts**: a save is refused when the note changed elsewhere since it was opened; the UI offers to reload or overwrite.
- **Security**: argon2id + TOTP login with replay protection, lockout and per-IP rate limit; random hashed session cookie (`HttpOnly`, `SameSite=Strict`, `__Host-`/`Secure` on HTTPS, 12 h idle / 7 days max); CSRF header + Origin check + JSON only; strict CSP (same-origin only, no inline script), bundled fonts, no third-party resource; Markdown rendered element by element (never `innerHTML`); same path rules as the MCP server; non-root read-only container, no capabilities, dedicated Docker network.

- **Shortcuts**: Obsidian-like (`Ctrl+P` palette, `Ctrl+O` quick switcher, `Ctrl+E` read/edit, `Ctrl+B/I/K/L`, `[[` autocompletion, list continuation, `Alt+Enter` follow link, `Ctrl+Alt+←/→` history); browser-reserved ones (`Ctrl+N/W/T/Tab/1-9`) use `Alt` instead. Full list in the French version.

Variables: `WEB_PUBLIC_URL`, `WEB_PORT` (8090). Details in the French version ([../fr/web.md](../fr/web.md)).
