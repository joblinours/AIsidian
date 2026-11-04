#!/bin/sh
# Hourly backup: CouchDB dump + vault (git included) + mcp-state + configs -> Restic.
set -eu
. /usr/local/bin/lib.sh
require_env RESTIC_PASSWORD COUCHDB_ADMIN_USER COUCHDB_ADMIN_PASSWORD COUCHDB_DATABASE

: "${KEEP_HOURLY:=24}"
: "${KEEP_DAILY:=7}"
: "${KEEP_WEEKLY:=4}"
: "${KEEP_MONTHLY:=6}"
: "${PRUNE_HOUR:=4}"

start=$(date +%s)
lock="${WORK_DIR}.lock"
mkdir -p "$(dirname "$WORK_DIR")"
if ! mkdir "$lock" 2>/dev/null; then
  # stale lock (older than 2 h) is removed
  if [ -n "$(find "$lock" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then rmdir "$lock"; mkdir "$lock"; else log "another backup is running"; exit 0; fi
fi
trap 'rmdir "$lock" 2>/dev/null || true' EXIT

write_status() {
  # write_status ok|error message snapshot
  prev='{}'
  [ -f "$STATUS_FILE" ] && prev=$(cat "$STATUS_FILE" 2>/dev/null || echo '{}')
  now=$(date +%s)
  echo "$prev" | jq \
    --arg result "$1" --arg msg "$2" --arg snap "${3:-}" --argjson now "$now" \
    --argjson dur "$((now - start))" --argjson docs "${docs:-0}" --argjson vbytes "${vault_bytes:-0}" '
    .last_attempt = ($now | todate) | .last_attempt_epoch = $now | .last_result = $result | .last_message = $msg |
    if $result == "ok" then
      .last_success = ($now | todate) | .last_success_epoch = $now | .last_snapshot = $snap |
      .duration_seconds = $dur | .couchdb_docs = $docs | .vault_bytes = $vbytes
    else . end' > "${STATUS_FILE}.tmp" && mv "${STATUS_FILE}.tmp" "$STATUS_FILE"
}

fail() { write_status error "$*"; die "$*"; }

# 1. Repository
if ! restic cat config >/dev/null 2>&1; then
  log "initialising restic repository ${RESTIC_REPOSITORY}"
  restic init || fail "restic init failed"
fi

# 2. CouchDB dump (documents include LiveSync chunks; data stays end-to-end encrypted)
rm -rf "$WORK_DIR" && mkdir -p "$WORK_DIR/couchdb"
for db in $COUCHDB_DATABASE; do
  couch GET "/${db}/_all_docs?include_docs=true" > "$WORK_DIR/couchdb/${db}.json" || fail "dump of ${db} failed"
  couch GET "/${db}/_security" > "$WORK_DIR/couchdb/${db}._security.json" || fail "_security of ${db} failed"
done
couch GET "/_users/_all_docs?include_docs=true" > "$WORK_DIR/couchdb/_users.json" || fail "dump of _users failed"
docs=$(jq '.rows | length' "$WORK_DIR/couchdb/${COUCHDB_DATABASE%% *}.json")
vault_bytes=$(du -sb "${DATA_DIR}/vault" 2>/dev/null | cut -f1 || echo 0)
log "couchdb dumped (${docs} docs), vault ${vault_bytes} bytes"

# 3. Snapshot
paths="${DATA_DIR}/vault ${WORK_DIR}/couchdb"
[ -d "${DATA_DIR}/mcp-state" ] && paths="$paths ${DATA_DIR}/mcp-state"
[ -d "${DATA_DIR}/web-state" ] && paths="$paths ${DATA_DIR}/web-state"
[ -d "${DATA_DIR}/config" ] && paths="$paths ${DATA_DIR}/config"
# shellcheck disable=SC2086
out=$(restic backup --host "$RESTIC_HOST" --tag aisidian --json --quiet $paths) || fail "restic backup failed"
snap=$(echo "$out" | jq -r 'select(.message_type == "summary") | .snapshot_id' | tail -1)
log "snapshot ${snap}"

# 4. Retention (forget every hour, prune once a day)
restic forget --host "$RESTIC_HOST" --tag aisidian --keep-hourly "$KEEP_HOURLY" --keep-daily "$KEEP_DAILY" \
  --keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY" --quiet || fail "restic forget failed"
if [ "$(date +%H | sed 's/^0//')" = "$PRUNE_HOUR" ]; then
  restic prune --quiet || fail "restic prune failed"
  restic check --quiet || fail "restic check failed"
  log "prune + check done"
fi

rm -rf "$WORK_DIR"
write_status ok "snapshot ${snap}" "$snap"
log "done in $(( $(date +%s) - start ))s"
