# Backup and restore

Two layers: **git** to undo a mistake by Claude, **Restic** to recover the whole system to the hour.

## Restic

The `backup` container runs hourly (minute `BACKUP_MINUTE`): `vault/` including `.git`, a CouchDB dump (`_all_docs?include_docs=true`, `_security`, users), `mcp-state`, `config/`. Retention: 24 hourly, 7 daily, 4 weekly, 6 monthly; `prune` + `check` once a day. Status in `/status/backup.json`, exposed on `:9101/status`. Stack variables are not in Restic: keep them in your password manager.

```bash
docker compose exec backup backup
docker compose --profile restore run --rm restore list
```

## Full restore (target: under 1 h)

```bash
scripts/restore-stack.sh latest     # or a snapshot ID; COMPOSE="docker compose -p <stack> -f <file>" for Portainer stacks
```

Stops `livesync`, `mcp`, `backup`; starts CouchDB; restores vault, `mcp-state`, config and CouchDB (revisions kept); realigns the headless client (`fetch --force`); restarts; checks (git fsck, document count, MCP status). Then on **every device**: *LiveSync → Reset synchronisation on this device*.

Partial restore: `--only vault`, `--only couchdb`, `--only state`, `--only config` (comma-separated). If CouchDB is lost but the vault is intact: `docker compose run --rm livesync --vault /vault rebuild --force`, then *Fetch* on devices.

## Undo one agent night (git)

```bash
G="docker compose exec mcp git -c user.name=AIsidian -c user.email=aisidian@localhost -C /vault"
$G log --oneline --grep='\[agent\]' -n 10
$G revert --no-commit BEFORE..AFTER
$G commit -m "Undo agent run (BEFORE..AFTER)"
```

`--no-commit` groups the undo into one commit (and avoids `git revert` stopping on the empty marker commits). Device commits made during the run are undone too: check with `$G show --stat HEAD`.

LiveSync propagates the restored files to the devices.
