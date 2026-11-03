#!/bin/sh
# schedule      : run backup.sh every hour at minute BACKUP_MINUTE (default 5)
# backup        : run once
# restore ...   : see restore.sh
# healthcheck   : fail if the last successful backup is older than MAX_AGE_SECONDS
set -eu
. /usr/local/bin/lib.sh

cmd=${1:-schedule}
shift || true

case "$cmd" in
  schedule)
    : "${BACKUP_MINUTE:=5}"
    log "scheduler started (every hour at :$(printf '%02d' "$BACKUP_MINUTE"))"
    [ "${BACKUP_ON_START:-true}" = "true" ] && { backup.sh || log "initial backup failed"; }
    while true; do
      now=$(date +%s)
      minute=$(date +%M | sed 's/^0//')
      second=$(date +%S | sed 's/^0//')
      wait=$(( ((BACKUP_MINUTE - ${minute:-0} + 60) % 60) * 60 - ${second:-0} ))
      [ "$wait" -le 0 ] && wait=$((wait + 3600))
      sleep "$wait"
      backup.sh || log "backup failed (see status file)"
      [ "$(date +%s)" -gt "$now" ] || sleep 1
    done
    ;;
  backup) exec backup.sh "$@" ;;
  restore) exec restore.sh "$@" ;;
  healthcheck)
    : "${MAX_AGE_SECONDS:=7200}"
    [ -f "$STATUS_FILE" ] || exit 1
    last=$(jq -r '.last_success_epoch // 0' "$STATUS_FILE")
    [ $(( $(date +%s) - last )) -lt "$MAX_AGE_SECONDS" ]
    ;;
  *) exec "$cmd" "$@" ;;
esac
