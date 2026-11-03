#!/bin/sh
# Idempotent CouchDB initialisation for Self-hosted LiveSync.
# Creates the system databases, applies the settings LiveSync requires,
# creates the sync database and a dedicated (non-admin) user.
set -eu

: "${COUCHDB_URL:=http://couchdb:5984}"
: "${COUCHDB_ADMIN_USER:?COUCHDB_ADMIN_USER is required}"
: "${COUCHDB_ADMIN_PASSWORD:?COUCHDB_ADMIN_PASSWORD is required}"
: "${COUCHDB_DATABASE:?COUCHDB_DATABASE is required}"
: "${COUCHDB_SYNC_USER:?COUCHDB_SYNC_USER is required}"
: "${COUCHDB_SYNC_PASSWORD:?COUCHDB_SYNC_PASSWORD is required}"
: "${COUCHDB_CORS_ORIGINS:=app://obsidian.md,capacitor://localhost,http://localhost}"
: "${COUCHDB_MAX_DOCUMENT_SIZE:=50000000}"
: "${COUCHDB_MAX_REQUEST_SIZE:=4294967296}"

AUTH="${COUCHDB_ADMIN_USER}:${COUCHDB_ADMIN_PASSWORD}"

log() { printf '%s couchdb-init: %s\n' "$(date -u +%FT%TZ)" "$*"; }

# curl wrapper: prints the HTTP status, body goes to /tmp/body
req() {
  method=$1; path=$2; shift 2
  curl -sS -o /tmp/body -w '%{http_code}' -u "$AUTH" -X "$method" \
    -H 'Content-Type: application/json' "$@" "${COUCHDB_URL}${path}"
}

log "waiting for ${COUCHDB_URL}"
i=0
until curl -fsS -o /dev/null "${COUCHDB_URL}/_up" 2>/dev/null || [ "$(curl -s -o /dev/null -w '%{http_code}' "${COUCHDB_URL}/_up")" = "401" ]; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && { log "CouchDB not reachable"; exit 1; }
  sleep 2
done

# System databases (single node).
for db in _users _replicator _global_changes; do
  code=$(req PUT "/${db}")
  case "$code" in 201|202|412) ;; *) log "PUT ${db} -> ${code}: $(cat /tmp/body)"; exit 1 ;; esac
done
log "system databases ok"

set_config() {
  section=$1; key=$2; value=$3
  code=$(req PUT "/_node/_local/_config/${section}/${key}" -d "$(jq -n --arg v "$value" '$v')")
  [ "$code" = "200" ] || { log "config ${section}/${key} -> ${code}: $(cat /tmp/body)"; exit 1; }
}

# Settings required by Self-hosted LiveSync.
set_config couchdb single_node true
set_config chttpd require_valid_user true
set_config chttpd_auth require_valid_user true
set_config httpd WWW-Authenticate 'Basic realm="couchdb"'
set_config httpd enable_cors true
set_config chttpd enable_cors true
set_config chttpd max_http_request_size "$COUCHDB_MAX_REQUEST_SIZE"
set_config couchdb max_document_size "$COUCHDB_MAX_DOCUMENT_SIZE"
set_config cors credentials true
set_config cors origins "$COUCHDB_CORS_ORIGINS"
set_config cors methods "GET, PUT, POST, HEAD, DELETE"
set_config cors headers "accept, authorization, content-type, origin, referer, cf-access-client-id, cf-access-client-secret"
log "LiveSync settings applied"

# Sync database.
code=$(req PUT "/${COUCHDB_DATABASE}")
case "$code" in 201|202|412) ;; *) log "PUT db -> ${code}: $(cat /tmp/body)"; exit 1 ;; esac

# Dedicated user (create or update password).
uid="org.couchdb.user:${COUCHDB_SYNC_USER}"
rev=""
if [ "$(req GET "/_users/${uid}")" = "200" ]; then rev=$(jq -r '._rev' /tmp/body); fi
doc=$(jq -n --arg n "$COUCHDB_SYNC_USER" --arg p "$COUCHDB_SYNC_PASSWORD" --arg r "$rev" \
  '{_id: ("org.couchdb.user:" + $n), name: $n, password: $p, roles: [], type: "user"} + (if $r == "" then {} else {_rev: $r} end)')
code=$(req PUT "/_users/${uid}" -d "$doc")
case "$code" in 201|202) ;; *) log "user -> ${code}: $(cat /tmp/body)"; exit 1 ;; esac

# Only the sync user (and server admins) can access the database.
sec=$(jq -n --arg n "$COUCHDB_SYNC_USER" '{admins: {names: [$n], roles: []}, members: {names: [$n], roles: []}}')
code=$(req PUT "/${COUCHDB_DATABASE}/_security" -d "$sec")
[ "$code" = "200" ] || { log "_security -> ${code}: $(cat /tmp/body)"; exit 1; }

log "database ${COUCHDB_DATABASE} and user ${COUCHDB_SYNC_USER} ready"
