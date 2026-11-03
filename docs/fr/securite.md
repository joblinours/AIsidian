# Sécurité et modèle de menace

Trois menaces prioritaires : l'accès à l'infrastructure via le MCP, un agent qui déraille, la fuite de données du vault.

| Menace | Mesures en place |
| --- | --- |
| Accès à l'infra via le MCP | Conteneur non-root, système de fichiers en lecture seule, `cap_drop: ALL`, `no-new-privileges`, aucun socket Docker, seuls `vault/` et `mcp-state/` montés ; aucun outil d'exécution de commande ; chemins normalisés (pas de `..`, pas de chemin absolu, pas de dossier caché), liens symboliques jamais suivis ; réseau Docker `mcp` séparé de CouchDB |
| Agent qui déraille, injection via une note capturée | Pas d'outil de suppression ni de fusion ; dossiers en lecture seule appliqués par le serveur ; endpoint agent distinct avec mode simulation et limite d'écritures appliqués côté serveur ; restrictions agent (pas d'archivage, pas de renommage, pas de réécriture massive, déplacement depuis l'Inbox seulement) ; git pour tout annuler ; contenu des notes balisé et rappelé comme donnée dans chaque lecture et dans les instructions du serveur |
| Fuite de données | OAuth 2.1 avec mot de passe argon2id + TOTP sur le MCP ; Access (service token) + authentification CouchDB ; E2EE et obfuscation des chemins dans CouchDB ; limites de requêtes et blocage sur la connexion ; tokens liés à une ressource, stockés hachés, refresh tokens tournants avec détection de réutilisation ; journal des accès MCP ; statut Zabbix sur un port non exposé |

## Secrets

Dans Vaultwarden ou les variables de la stack Portainer, jamais dans le dépôt (seul `.env.example`). À conserver dans Vaultwarden : mot de passe Restic, passphrase E2EE, Setup URI et sa phrase de passe, service token Access, mots de passe CouchDB, mot de passe et secret TOTP du MCP (codes de secours : réinitialiser le compte avec `reset-account`).

## Risques acceptés

- Pas de sauvegarde hors site.
- Passphrase E2EE présente sur le serveur (nécessaire au client headless).
- Production directe, sans environnement de test.
- Pas de filtrage réseau sur l'hôte Docker : à terme, n'accepter sur 8080 et 5984 que le connecteur Cloudflare, et sur 9101 que Zabbix.

## Signaler une vulnérabilité

Ouvre une *security advisory* privée sur le dépôt GitHub plutôt qu'une issue publique.
