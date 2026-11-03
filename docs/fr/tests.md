# Tests de validation v1

La v1 est livrée quand les 17 tests sont passés et leurs résultats consignés ici. Les tests marqués « auto » ont aussi une couverture automatisée dans `mcp/test/` (exécutée par la CI) ; le test manuel reste à faire sur l'infra réelle.

| ID | Test | Procédure | Résultat attendu | Auto | Date | Résultat |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | Note créée sur PC | Créer `00-Inbox/T01.md` dans Obsidian | Visible sur l'iPhone et dans `vault/` sur le serveur | | | |
| T02 | Note modifiée sur iPhone hors du domicile | En 4G, modifier T01 | Modification synchronisée partout | | | |
| T03 | Note créée par Claude.ai via MCP | « Crée une note de test T03 » | Visible dans Obsidian sur tous les appareils | | | |
| T04 | Lecture via MCP | « Lis la note T01 » | Contenu correct | | | |
| T05 | Recherche via MCP | « Cherche … dans le vault » | Résultats pertinents | ✓ | | |
| T06 | Fin de session Claude Code (Kali) | Session utile puis `/exit` ; session futile puis `/exit` | Note concept dans `00-Inbox/` ; aucune note pour la session futile | | | |
| T07 | « Sauvegarde ça dans le vault » sur Claude.ai | Avec le skill | Note(s) concept en français dans `00-Inbox/` | | | |
| T08 | Passage de l'agent | Tâche planifiée | Notes classées, rapport dans `40-Journal/`, notification push | ✓ | | |
| T09 | Doublon présent | Deux notes quasi identiques avant la nuit | Proposé dans « À valider », rien supprimé | ✓ | | |
| T10 | Création de liens | Après un passage | Liens `[[…]]` valides (cliquables dans Obsidian) | ✓ | | |
| T11 | Sauvegarde Restic | `restore list` | Snapshot horaire créé | | | |
| T12 | Restauration complète | `scripts/restore-stack.sh` chronométré | Services relancés, données vérifiées en moins d'1 h | | | |
| T13 | Accès MCP sans token | `curl -i -X POST https://notes.example.com/mcp` | `401` + `WWW-Authenticate` ; avec OAuth + TOTP : accès | ✓ | | |
| T14 | CouchDB sans service token | `curl -i https://couch.example.com/` | Refusé par Cloudflare (403) | | | |
| T15 | Redémarrage du LXC | `reboot` | Services et données intacts | | | |
| T16 | Erreur pendant le passage | Ex. couper `mcp` pendant la tâche, ou note en conflit | Erreur dans le rapport et dans la notification | | | |
| T17 | Écriture MCP dans `20-Domaines/Pro/` | « Crée une note dans 20-Domaines/Pro » | Refusée (lecture seule) | ✓ | | |
