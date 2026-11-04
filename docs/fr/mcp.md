# Serveur MCP AIsidian

Serveur MCP en TypeScript (SDK officiel), transport Streamable HTTP sans état, qui travaille directement sur les fichiers du volume `vault/` et embarque son propre serveur OAuth 2.1 mono-utilisateur.

## Endpoints

| Chemin | Rôle |
| --- | --- |
| `/mcp` | Connecteur principal : Claude.ai web et mobile, Claude Code |
| `/mcp/agent` | Connecteur de l'agent nocturne : outils agent, mode simulation, limite d'écritures |
| `/.well-known/oauth-protected-resource/mcp[/agent]` | Métadonnées de ressource protégée |
| `/.well-known/oauth-authorization-server` | Métadonnées du serveur d'autorisation (DCR, CIMD, PKCE S256) |
| `/authorize`, `/token`, `/register`, `/revoke` | OAuth 2.1 |
| `/oauth/login` | Page de connexion mot de passe + TOTP |
| `/setup` | Assistant de premier lancement (jeton à usage unique, disparaît ensuite) |
| `/healthz` | Santé |
| `:9101/status`, `:9101/healthz` | Statut pour Zabbix, **LAN uniquement** |

Un token est lié à la ressource demandée lors de l'autorisation : un token `/mcp` est refusé sur `/mcp/agent` et inversement. C'est ce qui permet au serveur de reconnaître l'agent alors que Claude.ai et la tâche planifiée utilisent le même mécanisme de connecteur.

## Connecter les clients

**Claude.ai (web et mobile)** : *Paramètres → Connecteurs → Ajouter un connecteur personnalisé*, URL `https://notes.example.com/mcp`, puis *Connecter* : la page de login s'ouvre (mot de passe + TOTP).

**Agent nocturne** : second connecteur « AIsidian Agent », URL `https://notes.example.com/mcp/agent` (voir `agent/README.md`).

**Claude Code** (Kali, WSL) :

```bash
claude mcp add --scope user --transport http aisidian https://notes.example.com/mcp
```

puis, dans Claude Code, `/mcp` → *aisidian* → *Authenticate*. La redirection se fait vers `http://localhost:<port>/callback`, acceptée sur n'importe quel port.

**Claude Code dans le cloud** : ajouter le même serveur MCP à l'environnement, et l'instruction `hooks/claude-md-snippet.md` au `CLAUDE.md` du projet.

## Outils

| Lecture | Écriture | Agent (`/mcp/agent`) |
| --- | --- | --- |
| `search`, `read_note`, `list_folder`, `list_tags`, `get_metadata`, `find_related`, `find_duplicates` | `create_note`, `append_to_note`, `update_note`, `set_frontmatter`, `add_tags`, `add_link`, `move_note` | `get_changes_since`, `write_report`, `propose_action` |

Aucun outil de suppression ni de fusion.

Règles appliquées par le serveur :

- **Permissions par dossier** (`PERMISSIONS_FILE`, défaut : `99-Système/`, `20-Domaines/DFIR/Certif/`, `20-Domaines/Pro/` en lecture seule), comparaison insensible à la casse.
- **Chemins** : normalisés, pas de `..`, pas de chemin absolu, pas de dossier caché (`.git`, `.obsidian`…), liens symboliques refusés.
- **Doublons** : `create_note` refuse un nom existant, un `capture_id` déjà capturé ou un titre très proche (sauf `allow_similar`).
- **Concurrence** : `read_note` renvoie une `version` ; une écriture avec `expected_version` périmée est refusée (obligatoire pour l'agent).
- **Statut** : personne ne peut passer une note en `validated` via le MCP ; l'agent ne fait que `draft → unverified`.
- **Agent** : passage ouvert par `get_changes_since` et clos par `write_report` ; en `AGENT_MODE=simulation`, les écritures sont validées mais non appliquées ; limite `AGENT_MAX_WRITES` par passage ; pas de déplacement hors de `00-Inbox/`, pas d'archivage, pas de changement de titre, pas de réécriture de plus de 30 % d'une note.
- **Traçabilité** : chaque écriture produit un commit git dans le vault (`[mcp] client · outil · note`) et une ligne dans `/state/journal.jsonl` (horodatage, client, endpoint, outil, note, résultat). Un commit horaire capture les modifications venues des appareils.

## OAuth

- Enregistrement des clients par **DCR** (`/register`, clients publics) et **CIMD** (`client_id` = URL HTTPS, récupérée seulement sur les hôtes de `CIMD_ALLOWED_HOSTS`).
- **PKCE S256** obligatoire. Redirections acceptées : `ALLOWED_REDIRECT_URIS` (défaut : callbacks claude.ai et claude.com) et loopback `http://localhost` / `127.0.0.1` sur tout port.
- Access token 1 h, refresh token 60 jours, **rotation** à chaque usage ; la réutilisation d'un refresh token déjà utilisé révoque toute la famille.
- Login : argon2id + TOTP (fenêtre ±30 s, code non rejouable), blocage 15 min après 5 échecs, limites de requêtes par IP (`CF-Connecting-IP`).
- Tokens stockés hachés (SHA-256) dans le volume `mcp-state`.

## Variables d'environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PUBLIC_URL` | — | URL publique (émetteur OAuth) |
| `AGENT_MODE` | `simulation` | `simulation` ou `real` |
| `AGENT_MAX_WRITES` | `50` | Écritures maximum par passage |
| `AGENT_RUN_TIMEOUT_MINUTES` | `240` | Un passage non clos expire |
| `PERMISSIONS_FILE` | — | YAML des permissions (voir `config/permissions.example.yaml`) |
| `ALLOWED_REDIRECT_URIS` | callbacks Claude | Liste séparée par des virgules |
| `CIMD_ALLOWED_HOSTS` | `claude.ai,claude.com` | Hôtes autorisés pour CIMD |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_SECONDS` | `3600` / `5184000` | Durées de vie |
| `HOURLY_COMMIT` | `true` | Commit horaire des modifications des appareils |
| `PROPOSALS_NOTE` | `40-Journal/À valider.md` | Note des propositions |
| `TRUST_PROXY` | `1` | Réglage Express `trust proxy` |

## Administration

```bash
docker compose exec mcp node dist/cli.js status          # compte configuré ?
docker compose exec mcp node dist/cli.js reset-account   # puis redémarrer mcp
docker compose exec mcp tail -n 50 /state/journal.jsonl  # journal des accès
```

## Développement

```bash
cd mcp
npm ci
npm test
PUBLIC_URL=http://localhost:8080 VAULT_DIR=/tmp/vault STATE_DIR=/tmp/state npm run build && npm start
```
