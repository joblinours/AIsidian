# Cloudflare

Tout le trafic externe passe par le Cloudflare Tunnel existant : aucun port ouvert, aucune IP publique. Le reverse proxy existant n'est pas utilisé.

## Routes du tunnel (dashboard)

*Zero Trust → Networks → Tunnels → (ton tunnel) → Public Hostname* :

| Hostname | Service | Remarques |
| --- | --- | --- |
| `notes.example.com` | `http://<IP de l'hôte Docker>:8080` | MCP + OAuth. **Pas** d'application Access (une page de login interactive bloquerait Claude) |
| `couch.example.com` | `http://<IP de l'hôte Docker>:5984` | CouchDB, derrière Access |

Le port `9101` (statut pour Zabbix) ne doit **jamais** être routé dans le tunnel.

## Access devant CouchDB

1. *Access → Service Auth → Service Tokens → Create* : note le `Client ID` et le `Client Secret` (Vaultwarden).
2. *Access → Applications → Add → Self-hosted* : domaine `couch.example.com`.
3. Politique : action **Service Auth**, règle *Include → Service Token →* le token créé.
4. Paramètres de l'application, *CORS* : active **Bypass options requests to origin**, pour que les requêtes préliminaires CORS (sans en-têtes) atteignent CouchDB, qui y répond (`couchdb-init` autorise les en-têtes `cf-access-client-id` / `cf-access-client-secret`).
5. Durée de session : courte, sans importance pour un service token.

LiveSync envoie les en-têtes `CF-Access-Client-Id` et `CF-Access-Client-Secret` (champ *Custom headers* des réglages de connexion). À valider en phase 1 sur desktop et iOS.

Test T14 :

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://couch.example.com/        # attendu : 403 (Access)
curl -s -o /dev/null -w '%{http_code}\n' https://couch.example.com/ \
  -H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET"     # attendu : 401 (CouchDB demande l'auth)
```

## Domaine du MCP

- Ne mets ni Access ni liste blanche d'IP : la sécurité repose sur l'OAuth du serveur (mot de passe + TOTP) et ses limites de requêtes.
- Si *Bot Fight Mode* ou des règles WAF sont actifs, ajoute une règle *Skip* pour `notes.example.com` sur les chemins `/mcp*`, `/.well-known/*`, `/register`, `/token`, `/authorize`, `/revoke`, `/oauth/*` : les appels viennent des serveurs d'Anthropic.
- Le serveur lit l'IP réelle dans `CF-Connecting-IP` pour ses limites de requêtes.
