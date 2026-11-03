#!/bin/sh
# Full restore on the Docker host (target: < 1 h).
#   scripts/restore-stack.sh [SNAPSHOT|latest] [--only vault,state,config,couchdb]
# Run from the directory holding docker-compose.yml and .env (or set COMPOSE="docker compose -p <stack> -f <file>").
set -eu
COMPOSE=${COMPOSE:-docker compose}
snapshot=${1:-latest}
shift || true
start=$(date +%s)
say() { printf '\n==> %s\n' "$*"; }

say "Snapshots available"
$COMPOSE --profile restore run --rm restore list | tail -n 8

printf '\nRestore snapshot "%s"? This overwrites current data. Type "yes": ' "$snapshot"
read -r answer
[ "$answer" = "yes" ] || { echo "aborted"; exit 1; }

say "Stopping writers (livesync, mcp, backup)"
$COMPOSE stop livesync mcp backup

say "Making sure CouchDB is up"
$COMPOSE up -d couchdb
$COMPOSE up couchdb-init

say "Restoring"
$COMPOSE --profile restore run --rm restore "$snapshot" "$@" --yes

case " $* " in
  *" --only "*) only=$(echo "$*" | sed -n 's/.*--only[ =]\([^ ]*\).*/\1/p') ;;
  *) only="vault,state,config,couchdb" ;;
esac
case ",$only," in
  *",couchdb,"*)
    say "Re-aligning the headless LiveSync client on the restored CouchDB (fetch)"
    # Otherwise its local database, newer than the snapshot, would push the old state back.
    $COMPOSE run --rm livesync --vault /vault fetch --force
    ;;
  *)
    say "CouchDB not restored: the restored vault must become the reference"
    echo "Run: $COMPOSE run --rm livesync --vault /vault rebuild --force"
    echo "then on every device: LiveSync > Reset synchronisation on this device (Fetch)."
    ;;
esac

say "Starting the stack"
$COMPOSE up -d

say "Integrity checks"
sleep 10
port=${MCP_STATUS_PORT:-9101}
if curl -fsS "http://127.0.0.1:${port}/status"; then echo; else echo "WARNING: MCP status not reachable"; fi
$COMPOSE ps

say "Done in $(( ($(date +%s) - start) / 60 )) min $(( ($(date +%s) - start) % 60 )) s"
echo "On every device: LiveSync > Reset synchronisation on this device, so they do not push newer data back."
echo "Check: a note opened on a device, a read through the MCP, and restic snapshots (T12)."
