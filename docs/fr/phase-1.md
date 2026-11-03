# Phase 1 — preuves de concept

Trois preuves à réussir avant la phase 2. Chacune se termine par un résultat consigné ci-dessous ; un échec impose une décision documentée.

## P1. livesync-cli : E2EE, obfuscation des chemins, écriture bidirectionnelle

Environnement : CouchDB + `couchdb-init` + `livesync` de la stack, un PC avec Obsidian.

1. Configurer le PC (E2EE + Path Obfuscation) et amorcer le serveur avec le Setup URI ([livesync.md](livesync.md)).
2. Vérifier dans CouchDB (Fauxton ou `curl …/_all_docs?limit=5&include_docs=true`) que les identifiants et contenus sont illisibles.
3. Créer une note sur le PC → elle apparaît dans le volume `vault/` en clair, avec le bon chemin (accents inclus : `20-Domaines/École/Été.md`).
4. Écrire un fichier dans `vault/` sur le serveur (`docker compose exec mcp sh -c 'echo test > "/vault/00-Inbox/Depuis le serveur.md"'`) → il apparaît sur le PC.
5. Modifier la même note simultanément sur les deux côtés → un conflit est signalé, aucune donnée perdue.
6. Supprimer une note sur le PC → supprimée côté serveur (et visible dans le commit horaire git).
7. Redémarrer le conteneur `livesync` → reprise sans resynchronisation complète.
8. Vérifier que `.git/` n'apparaît pas sur le PC (`.livesync/ignore`).

Passage : 3 à 8 OK. Sinon : repli Obsidian en conteneur (profil `fallback`).

## P2. En-têtes Cloudflare Access sur desktop et iOS

1. Application Access + service token ([cloudflare.md](cloudflare.md)), *Bypass options requests to origin* activé.
2. Sans en-têtes : `curl https://couch.example.com/` → 403.
3. PC : LiveSync avec *Custom headers* `CF-Access-Client-Id` / `CF-Access-Client-Secret` → *Test connection* et synchronisation OK.
4. iPhone **hors du domicile** (4G) : même configuration via Setup URI → synchronisation OK, édition renvoyée vers le PC.
5. Si l'iPhone échoue à cause du CORS : essayer l'option LiveSync d'utilisation de l'API de requête d'Obsidian (contourne le CORS) et noter le réglage retenu.

Passage : 2 à 4 OK. Sinon : autre mécanisme d'accès (ex. règle Access par mTLS ou authentification CouchDB seule derrière le tunnel), à décider.

## P3. Tâche planifiée cloud + MCP OAuth + rafraîchissement du token

1. Déployer `mcp` seul (avec `ACCESS_TOKEN_TTL_SECONDS=300` pour forcer le rafraîchissement), compte créé via `/setup`.
2. Ajouter le connecteur `https://notes.example.com/mcp/agent` dans Claude.ai et le connecter.
3. Créer une tâche planifiée toutes les heures avec ce prompt : « Avec le connecteur AIsidian Agent, appelle get_changes_since puis write_report avec le contenu "test P3", et réponds OK ».
4. Laisser tourner au moins 3 exécutions espacées de plus de 5 minutes, sans intervention.
5. Vérifier : rapports dans `40-Journal/`, journal `/state/journal.jsonl` (client, endpoint `agent`), aucun nouveau login demandé, logs `mcp` sans `refresh token reuse detected`.
6. Remettre `ACCESS_TOKEN_TTL_SECONDS` par défaut.

Passage : 3 exécutions consécutives sans intervention. Sinon : la décision « agent cloud uniquement » est à rouvrir (section 15 du cahier des charges).

## Résultats

| Preuve | Date | Résultat | Remarques / décision |
| --- | --- | --- | --- |
| P1 livesync-cli | | | |
| P2 En-têtes Access (desktop) | | | |
| P2 En-têtes Access (iOS hors domicile) | | | |
| P3 Tâche planifiée + refresh | | | |
