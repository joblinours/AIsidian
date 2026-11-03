# Self-hosted LiveSync

Tous les appareils, y compris le serveur, sont des clients LiveSync de la même base CouchDB. CouchDB ne voit que des données chiffrées (E2EE) avec des chemins obfusqués.

## 1. Premier appareil (PC)

1. Crée un **vault vide**, installe le plugin *Self-hosted LiveSync*.
2. Assistant de configuration, serveur CouchDB :
   - URI : `https://couch.example.com`
   - Utilisateur / mot de passe : `COUCHDB_SYNC_USER` / `COUCHDB_SYNC_PASSWORD`
   - Base : `COUCHDB_DATABASE`
   - *Custom headers* : `CF-Access-Client-Id: …` et `CF-Access-Client-Secret: …` (une par ligne)
3. Active **End-to-End Encryption** (passphrase longue, dans Vaultwarden) et **Path Obfuscation**.
4. Lance la synchronisation (vault vide → base initialisée), puis *Copy setup URI* (protégé par une phrase de passe) pour les autres appareils.

Réglages de plugins (Customization Sync / Hidden File Sync) : seulement une fois la synchronisation des notes stable, en excluant les plugins desktop seulement sur iOS.

## 2. Client headless (serveur)

L'image officielle `ghcr.io/vrtmrz/livesync-cli` garde son état dans le volume `livesync-state` (`/data`) et synchronise le volume `vault` (`/vault`) en continu (`daemon`).

```bash
docker compose stop livesync
# 1. Réglages à partir du Setup URI (la phrase de passe du Setup URI est lue sur l'entrée standard)
docker compose run --rm livesync init-settings /data/.livesync/settings.json
printf '%s\n' "$SETUP_URI_PASSPHRASE" | docker compose run --rm -T livesync setup "$SETUP_URI"
```

Le serveur est sur le même réseau Docker que CouchDB : passe-le en accès direct, sans le tunnel ni Access :

```bash
docker compose run --rm --entrypoint node livesync -e '
const f="/data/.livesync/settings.json", fs=require("fs"), s=JSON.parse(fs.readFileSync(f));
s.couchDB_URI="http://couchdb:5984"; s.couchDB_CustomHeaders=""; fs.writeFileSync(f, JSON.stringify(s,null,2));'
```

Vérifie dans `settings.json` : `encrypt: true`, `usePathObfuscation: true`, la passphrase E2EE présente (elle est nécessaire au serveur pour écrire des fichiers en clair dans `vault/` ; risque accepté).

```bash
# 2. Récupère l'état de la base dans vault/, puis démarre le daemon
docker compose run --rm livesync --vault /vault fetch --force
scripts/install-vault-template.sh
docker compose up -d livesync
docker compose logs -f livesync
```

`.livesync/ignore` (installé par le template) exclut `.git/` de la synchronisation : l'historique git du serveur ne quitte jamais le serveur.

## 3. Autres appareils

Windows, iPhone, WSL : vault vide + plugin + *Use setup URI*. Sur iOS, vérifier que les en-têtes Access sont bien envoyés (phase 1).

## 4. Repli : Obsidian en conteneur

Si livesync-cli ne passe pas la phase 1 (E2EE, obfuscation ou écriture bidirectionnelle peu fiable) :

```bash
docker compose stop livesync
docker compose --profile fallback up -d obsidian-fallback
```

Interface web sur `http://<hôte>:3000` (LAN uniquement) : ouvre le dossier `/vault` comme vault, installe LiveSync avec le Setup URI. Décision à consigner dans [phase-1.md](phase-1.md).

## 5. Points d'attention

- Les suppressions se répliquent sur tous les appareils : git et Restic sont les filets de sécurité.
- Surveille la taille de CouchDB et du vault (pièces jointes) : voir [supervision.md](supervision.md).
- Après une restauration de CouchDB, chaque appareil doit faire *Reset synchronisation on this device* (sinon il renverrait des données plus récentes).
