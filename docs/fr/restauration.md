# Sauvegarde et restauration

Deux couches : **git** pour annuler une erreur de Claude, **Restic** pour retrouver tout le système à l'heure près.

## Restic

Le conteneur `backup` sauvegarde toutes les heures (minute `BACKUP_MINUTE`) :

- `vault/` avec son dossier `.git` ;
- un dump CouchDB (`_all_docs?include_docs=true` de la base, `_security`, utilisateurs) ;
- `mcp-state` (comptes OAuth, tokens, journal, état de l'agent) ;
- `config/` (permissions).

Rétention : 24 horaires, 7 quotidiens, 4 hebdomadaires, 6 mensuels. `prune` et `check` une fois par jour (`PRUNE_HOUR`, 4 h par défaut). Statut dans `/status/backup.json` (lu par le MCP et exposé sur `:9101/status`).

Les variables de la stack Portainer (`.env`) ne sont pas dans le dépôt Restic : exporte-les dans Vaultwarden à chaque changement.

```bash
docker compose exec backup backup                    # sauvegarde immédiate
docker compose --profile restore run --rm restore list   # snapshots
```

## Restauration complète (objectif : moins d'1 h)

Depuis le dossier contenant `docker-compose.yml` et `.env` (pour une stack Portainer : `COMPOSE="docker compose -p aisidian -f <fichier>"`) :

```bash
scripts/restore-stack.sh latest            # ou un identifiant de snapshot
```

Étapes : arrêt de `livesync`, `mcp`, `backup` ; démarrage de CouchDB ; restauration du vault, de `mcp-state`, des configs et de la base CouchDB (révisions conservées) ; réalignement du client headless (`fetch --force`) ; redémarrage ; contrôles (git fsck, nombre de documents, statut MCP).

Ensuite, sur **chaque appareil** : *LiveSync → Reset synchronisation on this device*, sinon un appareil plus récent renverrait ses données.

Restauration partielle : `--only vault`, `--only couchdb`, `--only state`, `--only config` (combinables : `--only vault,state`).

Si CouchDB est perdu mais le vault intact : CouchDB peut être reconstruit depuis le serveur avec `docker compose run --rm livesync --vault /vault rebuild --force`, puis *Fetch* sur les appareils.

Le test T12 (restauration complète chronométrée) doit être fait **avant** la mise en service.

## Annuler une nuit de l'agent (git)

```bash
G="docker compose exec mcp git -c user.name=AIsidian -c user.email=aisidian@localhost -C /vault"
$G log --oneline --grep='\[agent\]' -n 10
# repérer AVANT = commit "[agent] avant passage" et APRES = commit "[agent] après passage" de la nuit
$G revert --no-edit AVANT..APRES
```

Les fichiers restaurés sont propagés aux appareils par LiveSync. Pour une seule note : `$G log --oneline -- "30-Connaissances/Ma note.md"` puis `$G checkout <commit> -- "30-Connaissances/Ma note.md"` et `$G commit -m "restauration"`.
