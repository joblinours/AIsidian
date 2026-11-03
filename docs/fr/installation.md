# Installation

Ordre conseillé : la [phase 1](phase-1.md) d'abord (preuves de concept), puis cette procédure. Les sauvegardes doivent tourner **avant** d'activer toute écriture automatique.

## Prérequis

- Un hôte Docker (LXC ou VM) avec Docker Compose v2, et Portainer si tu déploies par l'interface.
- Un point de montage pour le dépôt Restic (ex. NFS ou bind du DAS) : `RESTIC_REPOSITORY_PATH`.
- Un Cloudflare Tunnel déjà en place et Cloudflare Zero Trust (Access).
- Deux sous-domaines : un pour le MCP (ex. `notes.example.com`), un pour CouchDB (ex. `couch.example.com`).
- Une application TOTP (Aegis, 2FAS, Bitwarden…).

## 1. Variables de la stack

Copie `.env.example` (ou colle-le dans les variables de la stack Portainer) et renseigne au minimum :

| Variable | Rôle |
| --- | --- |
| `PUBLIC_URL` | URL publique du MCP, ex. `https://notes.example.com` |
| `COUCHDB_ADMIN_USER` / `COUCHDB_ADMIN_PASSWORD` | Administrateur CouchDB (jamais utilisé par les appareils) |
| `COUCHDB_SYNC_USER` / `COUCHDB_SYNC_PASSWORD` | Utilisateur dédié à LiveSync |
| `RESTIC_REPOSITORY_PATH` / `RESTIC_PASSWORD` | Dépôt Restic sur le DAS et son mot de passe (à garder dans Vaultwarden) |
| `AGENT_MODE` | `simulation` au départ |
| `AISIDIAN_TAG` | `latest` (ou `vX.Y.Z`) ; jamais `dev` en production |

Les secrets restent dans Portainer ou Vaultwarden ; le dépôt ne contient que `.env.example`.

## 2. Déploiement

Portainer : *Stacks → Add stack → Repository* (branche `main`, fichier `docker-compose.yml`) ou *Web editor* avec le contenu du fichier, puis les variables. En ligne de commande :

```bash
docker compose up -d
```

Au premier démarrage : `volumes-init` attribue les volumes à `PUID:PGID`, `couchdb-init` configure CouchDB pour LiveSync, `backup` initialise le dépôt Restic et fait un premier snapshot.

## 3. Cloudflare

Voir [cloudflare.md](cloudflare.md) : deux routes dans le tunnel, une application Access avec service token devant CouchDB uniquement.

## 4. Compte du serveur MCP

Les logs du conteneur `mcp` affichent un lien à usage unique :

```bash
docker compose logs mcp | grep -A1 "Ouvre ce lien"
```

Ouvre-le, scanne le QR code TOTP, choisis un mot de passe (12 caractères minimum) et confirme avec un code. La page `/setup` disparaît ensuite. Pour recommencer : `docker compose exec mcp node dist/cli.js reset-account` puis redémarrer `mcp`.

## 5. LiveSync

Voir [livesync.md](livesync.md) : configuration du premier appareil (E2EE, obfuscation des chemins, en-têtes Access), amorçage du client headless avec un Setup URI, puis des autres appareils.

## 6. Arborescence du vault

```bash
scripts/install-vault-template.sh
```

Copie `vault-template/` et les fichiers de `agent/` (dans `99-Système/Agent/`) sans écraser l'existant. Redémarre ensuite `livesync` pour qu'il prenne en compte `.livesync/ignore` (exclusion de `.git`).

## 7. Connecteurs Claude

Voir [mcp.md](mcp.md) : connecteur « AIsidian » (`/mcp`) pour Claude.ai et Claude Code, connecteur « AIsidian Agent » (`/mcp/agent`) pour la tâche planifiée.

## 8. Capture

- Claude.ai : importer le skill `skills/aisidian-capture/` (zip du dossier) dans *Paramètres → Capacités → Skills*.
- Claude Code (Kali, WSL) : `hooks/install.sh https://notes.example.com`.
- Claude Code cloud : ajouter `hooks/claude-md-snippet.md` au `CLAUDE.md` des projets et le connecteur MCP à l'environnement.

## 9. Agent nocturne

Voir [`agent/README.md`](../../agent/README.md). Trois nuits en simulation, puis `AGENT_MODE=real`.

## 10. Supervision

Voir [supervision.md](supervision.md).

## Mises à jour

Les images stables sont publiées sur GHCR à chaque tag `vX.Y.Z` sur `main`. Mise à jour = *Pull and redeploy* de la stack dans Portainer (ou `docker compose pull && docker compose up -d`).

## Protection de `main` (GitHub)

À configurer une fois dans *Settings → Branches* : règle sur `main`, pull request obligatoire, statut CI requis (jobs `MCP server`, `Shell scripts + compose`, `Image …`), pas de push direct.
