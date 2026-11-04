# AIsidian

*[English version](README.md)*

Un second cerveau Obsidian auto-hébergé, alimenté par Claude. Claude (Claude.ai web/mobile, tâches planifiées, Claude Code) ajoute des notes via un serveur MCP, un agent planifié les range chaque nuit, et le vault est synchronisé sur tous les appareils avec [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync).

```
 Claude.ai / Claude Code ──HTTPS──┐                     ┌── PC, téléphone… (Obsidian + LiveSync)
 Tâche planifiée (agent) ──HTTPS─┐│                     │
                                 ▼▼                     ▼
                      Cloudflare Tunnel ─────── Cloudflare Access (service token)
                         │                                 │
             notes.<domaine> → mcp :8080        couch.<domaine> → couchdb :5984
                         │                                 │  (E2EE, chemins obfusqués)
                         ▼                                 ▼
                    vault/ (fichiers en clair) ◄── livesync-cli (client headless)
                    + historique git local
                         │
                     backup (Restic, horaire) → DAS
```

## Composants

| Dossier | Contenu |
| --- | --- |
| [`mcp/`](mcp) | Serveur MCP (TypeScript, SDK officiel) avec OAuth 2.1 mono-utilisateur intégré (mot de passe + TOTP), permissions par dossier, commit git par écriture, aucun outil de suppression |
| [`web/`](web) | Interface web (éditeur en tuiles, graphe, explorateur), même compte que le MCP, sans suppression |
| [`couchdb-init/`](couchdb-init) | Initialisation de CouchDB pour LiveSync |
| [`backup/`](backup) | Image Restic : sauvegarde horaire, rétention, restauration |
| [`agent/`](agent) | Prompt, règles et modèle de rapport de l'agent nocturne |
| [`skills/`](skills) | Skill Claude.ai « sauvegarde ça dans le vault » |
| [`hooks/`](hooks) | Hook `SessionEnd` de Claude Code pour la capture automatique |
| [`vault-template/`](vault-template) | Arborescence de départ (esprit PARA) et templates |
| [`docs/`](docs/fr) | Installation, Cloudflare, LiveSync, MCP, sécurité, restauration, supervision, tests |

## Démarrage

1. Réaliser les [preuves de concept de la phase 1](docs/fr/phase-1.md).
2. Copier `.env.example`, le remplir, déployer `docker-compose.yml` (Portainer ou `docker compose up -d`).
3. Suivre [docs/fr/installation.md](docs/fr/installation.md).

## Sécurité

Aucun port public (Cloudflare Tunnel), CouchDB derrière Cloudflare Access + son authentification + chiffrement de bout en bout, MCP derrière OAuth avec TOTP, conteneur durci en lecture seule, endpoint agent séparé avec mode simulation et limite d'écritures appliqués côté serveur, historique git local pour tout annuler, sauvegardes Restic horaires. Voir [docs/fr/securite.md](docs/fr/securite.md).

## Développement

- Tout le développement se fait sur `dev` ; `main` ne reçoit que des versions stables par pull request, CI verte obligatoire.
- La CI lance les tests, shellcheck, la validation du compose et un scan Trivy à chaque push et pull request ; un push sur `dev` publie les images `:dev`, un tag `vX.Y.Z` publie `:latest` et `:vX.Y.Z` sur GHCR.

## Licence

[MIT](LICENSE)
