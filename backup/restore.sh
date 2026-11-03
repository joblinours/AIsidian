#!/bin/sh
# Restores a Restic snapshot into the volumes mounted read-write by the
# `restore` compose service. Stop mcp and livesync before running it
# (scripts/restore-stack.sh does the whole sequence).
#
#   restore.sh list
#   restore.sh [SNAPSHOT|latest] [--only vault,state,config,couchdb] --yes
set -eu
. /usr/local/bin/lib.sh
require_env RESTIC_PASSWORD

# The repository is mounted read-only for restores: never take a lock
# (writers are stopped during a restore, see scripts/restore-stack.sh).
if [ "${1:-}" = "list" ]; then exec restic --no-lock snapshots --host "$RESTIC_HOST" --tag aisidian; fi

snapshot=${1:-latest}
shift || true
only="vault,state,config,couchdb"
yes=no
while [ $# -gt 0 ]; do
  case "$1" in
    --only) only=$2; shift 2 ;;
    --yes) yes=yes; shift ;;
    *) die "unknown argument $1" ;;
  esac
done
[ "$yes" = yes ] || die "this overwrites the current data: add --yes to confirm"
has() { case ",$only," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

target="${WORK_DIR}-restore"
rm -rf "$target" && mkdir -p "$target"
log "restoring snapshot ${snapshot} to staging area"
restic --no-lock restore "$snapshot" --host "$RESTIC_HOST" --tag aisidian --target "$target"
src="${target}${DATA_DIR}"

if has vault; then
  [ -d "${src}/vault" ] || die "snapshot has no vault"
  rsync -a --delete "${src}/vault/" "${DATA_DIR}/vault/"
  log "vault restored ($(find "${DATA_DIR}/vault" -name '*.md' -not -path '*/.git/*' | wc -l) notes)"
  if git -c safe.directory='*' -C "${DATA_DIR}/vault" fsck --no-progress >/dev/null 2>&1; then
    log "git fsck ok"
  else
    log "WARNING: git fsck reported problems"
  fi
fi
if has state && [ -d "${src}/mcp-state" ]; then
  rsync -a --delete "${src}/mcp-state/" "${DATA_DIR}/mcp-state/"
  log "mcp-state restored"
fi
if has config && [ -d "${src}/config" ] && [ -w "${DATA_DIR}/config" ]; then
  rsync -a "${src}/config/" "${DATA_DIR}/config/"
  log "config restored"
fi

if has couchdb; then
  require_env COUCHDB_ADMIN_USER COUCHDB_ADMIN_PASSWORD COUCHDB_DATABASE
  dump="${target}${WORK_DIR}/couchdb"
  for db in $COUCHDB_DATABASE; do
    [ -f "${dump}/${db}.json" ] || die "no dump for ${db}"
    log "recreating database ${db}"
    couch DELETE "/${db}" >/dev/null 2>&1 || true
    couch PUT "/${db}" >/dev/null
    total=$(jq '.rows | length' "${dump}/${db}.json")
    # Upload in batches, keeping revisions (new_edits=false).
    i=0
    while [ "$i" -lt "$total" ]; do
      jq -c --argjson s "$i" '{new_edits: false, docs: [.rows[$s:$s+500][] | .doc | select(. != null)]}' "${dump}/${db}.json" \
        | couch POST "/${db}/_bulk_docs" --data-binary @- >/dev/null
      i=$((i + 500))
    done
    couch PUT "/${db}/_security" --data-binary @"${dump}/${db}._security.json" >/dev/null
    count=$(couch GET "/${db}" | jq '.doc_count')
    expected=$(jq '[.rows[] | select(.doc != null and (.id | startswith("_design/") | not))] | length' "${dump}/${db}.json")
    log "database ${db}: ${count} docs (dump: ${expected} non-design docs)"
  done
  if [ -f "${dump}/_users.json" ]; then
    jq -c '{new_edits: false, docs: [.rows[] | .doc | select(. != null and (._id | startswith("org.couchdb.user:")))]}' "${dump}/_users.json" \
      | couch POST "/_users/_bulk_docs" --data-binary @- >/dev/null
    log "users restored"
  fi
fi

rm -rf "$target"
log "restore of ${snapshot} complete (${only})"
