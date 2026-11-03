---
title: Règles de l'agent nocturne
type: index
source: manual
tags:
  - systeme
  - agent
status: validated
---
# Règles de l'agent nocturne

## Niveaux d'action

| Niveau | Actions |
| --- | --- |
| **Automatique** | Compléter et uniformiser le frontmatter ; ajouter des tags ; créer des liens `[[…]]` vers des notes existantes ; déplacer une note de `00-Inbox/` vers son dossier ; créer ou mettre à jour des notes d'index ; passer `draft` → `unverified` |
| **Proposé seulement** (`propose_action`) | Fusion de doublons ; archivage ; réécriture importante d'une note ; changement de titre |
| **Jamais** | Suppression ; écriture dans un dossier en lecture seule ; passage en `validated` ; ajout d'informations absentes des sources |

Le serveur applique déjà une partie de ces règles (refus techniques), mais tu dois les respecter de toi-même.

## Classement depuis l'Inbox

| Contenu | Destination |
| --- | --- |
| Concept, technique, savoir réutilisable | `30-Connaissances/` |
| Projet actif avec objectif et actions | `10-Projets/` |
| Sujet propre à un domaine (DFIR, Homelab, Couche 8, École, Perso) | `20-Domaines/<Domaine>/` |
| Note datée, compte rendu | `40-Journal/` |
| Doute | laisse dans `00-Inbox/` et signale-le dans le rapport |

`20-Domaines/Pro/`, `20-Domaines/DFIR/Certif/` et `99-Système/` sont en lecture seule : n'y déplace rien.

## Frontmatter

- Champs attendus : `title`, `created`, `updated`, `type`, `source`, `source_ref`, `captured`, `tags`, `status`.
- `created`, `updated`, `captured` sont gérés par le serveur : ne les touche pas.
- Si `title` manque, ajoute-le à l'identique du nom de fichier (ce n'est pas un changement de titre).
- `type` : `knowledge` par défaut pour une note concept.

## Tags

- À plat, minuscules, mots séparés par des tirets. Réutilise les tags existants (`list_tags`) plutôt que d'en créer des variantes.
- 2 à 5 tags par note.

## Liens

- Seulement vers des notes existantes, dans la section « Liens » (`add_link`), avec une courte justification.
- Pas plus de 5 liens ajoutés par note et par passage.

## Statut

- `draft` → `unverified` quand la note est rangée, a un frontmatter complet, des tags et au moins un lien pertinent ou une raison de ne pas en avoir.
- Ne touche jamais aux notes `validated` (sauf tags et liens).

## Index

- Une note d'index par domaine et pour `30-Connaissances/` peut être créée (`type: index`) dans le dossier concerné, listant les notes en `[[…]]`. Mets-la à jour avec `append_to_note`.
