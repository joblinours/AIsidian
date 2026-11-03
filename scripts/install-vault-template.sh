#!/bin/sh
# Copies the vault template and the agent files into the vault volume.
# Existing files are never overwritten (cp -n), except 99-Système/Agent/ with --update-agent.
#   scripts/install-vault-template.sh [--update-agent]
set -eu
COMPOSE=${COMPOSE:-docker compose}
root=$(cd "$(dirname "$0")/.." && pwd)
update_agent=no
[ "${1:-}" = "--update-agent" ] && update_agent=yes

tmp=$(mktemp -d)
cp -R "$root/vault-template/." "$tmp/"
mkdir -p "$tmp/99-Système/Agent"
cp "$root/agent/"*.md "$tmp/99-Système/Agent/"
rm -f "$tmp/99-Système/Agent/README.md"

$COMPOSE run --rm --no-deps -v "$tmp:/template:ro" --entrypoint sh mcp -c "
  cp -Rn /template/. /vault/
  if [ '$update_agent' = yes ]; then cp -R /template/99-Système/Agent/. '/vault/99-Système/Agent/'; fi
  echo 'vault template installed'
"
rm -rf "$tmp"
