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
# mktemp creates a 0700 directory: the container user (PUID) must be able to read it.
chmod -R a+rX "$tmp"

# File by file: BusyBox `cp -Rn dir/. dest/` silently skips everything when dest exists.
# shellcheck disable=SC2016
$COMPOSE run --rm --no-deps -e UPDATE_AGENT="$update_agent" -v "$tmp:/template:ro" --entrypoint sh mcp -c '
  set -eu
  cd /template
  find . -type d | while IFS= read -r d; do mkdir -p "/vault/$d"; done
  find . -type f > /tmp/template-files
  added=0
  while IFS= read -r f; do
    case "$f" in ./99-Système/Agent/*) agent=yes ;; *) agent=no ;; esac
    if [ ! -e "/vault/$f" ] || { [ "$agent" = yes ] && [ "$UPDATE_AGENT" = yes ]; }; then
      cp "$f" "/vault/$f"
      added=$((added + 1))
    fi
  done < /tmp/template-files
  echo "vault template installed ($added files written)"
'
rm -rf "$tmp"
