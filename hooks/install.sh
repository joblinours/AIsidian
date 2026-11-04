#!/usr/bin/env bash
# Installs the AIsidian SessionEnd hook for Claude Code (Linux, WSL).
#   hooks/install.sh https://notes.example.com
set -euo pipefail
url=${1:?usage: hooks/install.sh <PUBLIC_URL>}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
dest=$HOME/.claude/aisidian
mkdir -p "$dest"
cp "$here/session-end.sh" "$here/capture-prompt.md" "$dest/"
chmod +x "$dest/session-end.sh"

if ! claude mcp get aisidian >/dev/null 2>&1; then
  claude mcp add --scope user --transport http aisidian "${url%/}/mcp"
  echo "MCP server added: run 'claude', then /mcp to authenticate (password + TOTP)."
fi

settings=$HOME/.claude/settings.json
[[ -f "$settings" ]] || echo '{}' > "$settings"
tmp=$(mktemp)
jq --arg cmd "$dest/session-end.sh" '
  .hooks.SessionEnd = ((.hooks.SessionEnd // []) | map(select((.hooks // []) | all(.command != $cmd))))
    + [{hooks: [{type: "command", command: $cmd, timeout: 30}]}]
' "$settings" > "$tmp" && mv "$tmp" "$settings"
echo "SessionEnd hook installed in $settings"
