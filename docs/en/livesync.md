# Self-hosted LiveSync

Every device, including the server, is a LiveSync client of the same CouchDB database. CouchDB only stores end-to-end encrypted data with obfuscated paths.

## 1. First device (PC)

1. Create an **empty vault** and install *Self-hosted LiveSync*.
2. CouchDB settings: URI `https://couch.example.com`, user/password `COUCHDB_SYNC_USER`/`COUCHDB_SYNC_PASSWORD`, database `COUCHDB_DATABASE`, *Custom headers* `CF-Access-Client-Id: …` and `CF-Access-Client-Secret: …` (one per line).
3. Enable **End-to-End Encryption** (long passphrase) and **Path Obfuscation**.
4. Sync, then *Copy setup URI* (protected by a passphrase) for the other devices.

Plugin/settings sync (Customization Sync / Hidden File Sync): only once note sync is stable, excluding desktop-only plugins on iOS.

## 2. Headless client (server)

The official `ghcr.io/vrtmrz/livesync-cli` image keeps its state in the `livesync-state` volume (`/data`) and keeps the `vault` volume (`/vault`) in sync (`daemon`).

```bash
docker compose stop livesync
docker compose run --rm livesync init-settings /data/.livesync/settings.json
printf '%s\n' "$SETUP_URI_PASSPHRASE" | docker compose run --rm -T livesync setup "$SETUP_URI"
# Direct access on the Docker network, without the tunnel or Access:
docker compose run --rm --entrypoint node livesync -e '
const f="/data/.livesync/settings.json", fs=require("fs"), s=JSON.parse(fs.readFileSync(f));
s.couchDB_URI="http://couchdb:5984"; s.couchDB_CustomHeaders=""; fs.writeFileSync(f, JSON.stringify(s,null,2));'
docker compose run --rm livesync --vault /vault fetch --force
scripts/install-vault-template.sh
docker compose up -d livesync
```

Check `settings.json`: `encrypt: true`, `usePathObfuscation: true`, passphrase present (required by the server to write plain files into `vault/`; accepted risk). `.livesync/ignore` excludes `.git/`.

### Variant: the server initialises the database

When the reference vault is the server's (fresh vault from `scripts/install-vault-template.sh`), the server creates the database with `rebuild`. **`rebuild` deletes and recreates the database, so it needs the CouchDB admin account** (the LiveSync user is only admin of its database). Run `couchdb-init` afterwards to give the LiveSync user its rights on the recreated database, then switch the settings back to the LiveSync user (see the French version for the exact commands). Devices then connect with the same passphrase and path obfuscation and choose to **fetch from the server**. If a `rebuild` is interrupted, the client refuses to start (`Reconstruction recovery is required`): run the same `rebuild --force` again.

## 3. Other devices

Empty vault + plugin + *Use setup URI*. On iOS, check that Access headers are sent (phase 1).

## 4. Fallback: Obsidian in a container

```bash
docker compose stop livesync
docker compose --profile fallback up -d obsidian-fallback
```

Web UI on `http://<host>:3000` (LAN only): open `/vault` as a vault and configure LiveSync with the Setup URI.

## 5. Caveats

- Deletions replicate everywhere: git and Restic are the safety nets.
- Watch CouchDB and vault sizes (attachments).
- After a CouchDB restore, every device must run *Reset synchronisation on this device*.
