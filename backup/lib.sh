#!/bin/sh
# Shared helpers for backup.sh / restore.sh.

: "${COUCHDB_URL:=http://couchdb:5984}"
: "${DATA_DIR:=/data}"
: "${WORK_DIR:=/cache/work}"
: "${RESTIC_HOST:=aisidian}"

log() { printf '%s backup: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

couch() {
  # couch METHOD PATH [curl args...]
  method=$1; path=$2; shift 2
  curl -fsS -u "${COUCHDB_ADMIN_USER}:${COUCHDB_ADMIN_PASSWORD}" -X "$method" \
    -H 'Content-Type: application/json' "$@" "${COUCHDB_URL}${path}"
}

require_env() {
  for v in "$@"; do
    eval "val=\${$v:-}"
    [ -n "$val" ] || die "$v is required"
  done
}
