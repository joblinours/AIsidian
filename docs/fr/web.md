# Interface web

Interface web du vault, en tuiles façon Hyprland (palette Catppuccin Mocha) : éditeur à onglets (lecture et édition Markdown), graphe des liens (global ou local) et explorateur (arborescence, recherche, import, export). Conteneur `web`, exposé par le tunnel sur son propre sous-domaine.

## Accès et droits

- **Compte** : le même que le serveur MCP (mot de passe + TOTP), créé par l'assistant `/setup` du MCP. Le conteneur web lit `account.json` du volume `mcp-state` en lecture seule.
- **Droits** : comme Obsidian. Écriture dans tous les dossiers, y compris ceux en lecture seule pour Claude, et passage en `validated` possible. **Aucune suppression** : il n'existe ni route ni bouton pour ça.
- **Traçabilité** : chaque enregistrement, création ou import produit un commit git (`[web] save · …`) et une ligne dans `/state/journal.jsonl` du volume `web-state`.

## Fonctions

| Zone | Fonctions |
| --- | --- |
| Barre du haut | Espaces : 1 = tuiles, 2 = éditeur seul, 3 = graphe + explorateur ; nombre de notes ; déconnexion |
| Éditeur | Onglets ; modes Lecture (rendu Markdown, wikilinks cliquables, liens morts pointillés, rétroliens) et Édition (texte brut, frontmatter compris) ; enregistrement automatique après 1,2 s de pause ou Ctrl+S |
| Graphe | Global ou local (note courante et voisines), filtre, clic pour ouvrir ; notes isolées en anneau autour des notes liées |
| Explorateur | Arborescence complète, recherche plein texte (insensible aux accents), import `.md` (bouton ou glisser-déposer) vers `00-Inbox` sans jamais écraser, export `.md` des notes cochées |

## Raccourcis clavier

Inspirés d'Obsidian. `Ctrl+P` affiche la palette avec toutes les commandes et leurs raccourcis (`⌘` au lieu de `Ctrl` sur Mac). Les navigateurs réservent `Ctrl+N`, `Ctrl+W`, `Ctrl+T`, `Ctrl+Tab` et `Ctrl+1…9` à leurs propres onglets : leurs équivalents passent par `Alt`.

| Raccourci | Action |
| --- | --- |
| `Ctrl+P` | Palette de commandes |
| `Ctrl+O` | Sélecteur rapide : trouver une note (recherche floue) ou la créer dans `00-Inbox` |
| `Ctrl+E` | Basculer lecture / édition |
| `Ctrl+S` | Enregistrer (l'enregistrement est aussi automatique) |
| `Alt+N` | Nouvelle note |
| `Alt+W` | Fermer l'onglet |
| `Alt+1…8`, `Alt+9` | Aller à l'onglet N, au dernier |
| `Alt+PgDn` / `Alt+PgUp` | Onglet suivant / précédent |
| `Ctrl+Alt+←` / `Ctrl+Alt+→` | Naviguer en arrière / en avant |
| `Ctrl+Shift+F` | Rechercher dans le vault |
| `Ctrl+G` | Graphe (bascule l'espace 3) |
| `Ctrl+Alt+1…3` | Espaces 1 à 3 |

Dans l'éditeur :

| Raccourci | Action |
| --- | --- |
| `Ctrl+B` / `Ctrl+I` | Gras / italique |
| `Ctrl+K` | Lien Markdown |
| `Ctrl+L` | Case à cocher : ajouter, cocher, décocher |
| `Ctrl+/` | Commentaire `%% %%` |
| `Tab` / `Shift+Tab`, `Ctrl+]` / `Ctrl+[` | Indenter / désindenter |
| `Ctrl+D` | Supprimer la ligne (du texte, jamais une note) |
| `Entrée` dans une liste | Continue la liste (puces, numéros, cases) ; sur un élément vide, la termine |
| `[[` | Ferme les crochets et propose les notes (↑/↓, `Entrée` ou `Tab`, `Échap`) |
| `Alt+Entrée` | Suivre le lien sous le curseur |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Annuler / rétablir (historique natif conservé pour toutes les commandes) |

## Rendu Markdown

Titres, listes imbriquées et numérotées, cases à cocher, citations, callouts Obsidian (`> [!note]`, `[!tip]`, `[!warning]`…), blocs de code (aussi indentés dans une liste, avec ```` ``` ```` ou `~~~`), tableaux avec alignement des colonnes, code inline, gras, liens `[[…]]` (cliquables, pointillés si la note n'existe pas), liens web et tags.

**Conflits** : si une note a changé ailleurs (appareil LiveSync, Claude, agent) depuis son ouverture, l'enregistrement est refusé et un bandeau propose *Recharger la version du vault* ou *Écraser avec ma version*. Hors édition, la note ouverte et l'arborescence se rafraîchissent toutes les 20 s.

## Sécurité

| Mesure | Détail |
| --- | --- |
| Authentification | Mot de passe argon2id + TOTP du compte unique, code non rejouable, blocage 15 min après 5 échecs, 20 tentatives / 15 min par IP (`CF-Connecting-IP`) |
| Session | Cookie aléatoire (stocké haché côté serveur), `HttpOnly`, `SameSite=Strict`, `Secure` et préfixe `__Host-` en HTTPS ; expiration après 12 h d'inactivité (`SESSION_IDLE_HOURS`) et 7 jours au plus (`SESSION_MAX_DAYS`) |
| CSRF | Cookie `SameSite=Strict` + en-tête `X-Aisidian` obligatoire + vérification de l'`Origin` + JSON uniquement sur toute écriture |
| Navigateur | CSP stricte (scripts, polices et requêtes du même domaine uniquement, aucun script inline, aucun iframe), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` ; polices embarquées, aucune ressource tierce |
| Contenu des notes | Rendu Markdown construit élément par élément (jamais `innerHTML`) : une note ne peut pas injecter de script |
| Chemins | Mêmes règles que le MCP : pas de `..`, pas de chemin absolu, pas de dossier caché (`.git`…), liens symboliques refusés |
| Conteneur | Non-root, système de fichiers en lecture seule, aucune capability, `no-new-privileges`, réseau Docker dédié (ni CouchDB ni MCP joignables), `mcp-state` monté en lecture seule |

Le conteneur web écrit dans le même dépôt git que le MCP : quand l'un tient le verrou git, l'autre réessaie pendant quelques secondes.

## Déploiement

Variables : `WEB_PUBLIC_URL` (URL publique, ou `http://localhost:8090` en test local) et `WEB_PORT` (8090). Route du tunnel : voir [cloudflare.md](cloudflare.md).

En test local : ouvre `http://localhost:8090` après avoir créé le compte via `/setup` du MCP.

## Développement

```bash
cd mcp && npm ci && cd ../web && npm ci
npm test
npm run build
WEB_PUBLIC_URL=http://localhost:8090 VAULT_DIR=/tmp/vault STATE_DIR=/tmp/web-state ACCOUNT_FILE=/tmp/mcp-state/account.json node dist/server/web/server/main.js
```

`npm run dev` lance Vite avec un proxy `/api` vers le port 8090.
