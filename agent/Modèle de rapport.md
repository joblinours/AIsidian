---
title: Modèle de rapport de l'agent
type: index
source: manual
tags:
  - systeme
  - agent
status: validated
---
# Modèle de rapport

Le serveur ajoute lui-même l'en-tête (heure, mode, écritures, actions simulées, conflits) et la section « Erreurs ». Le contenu passé à `write_report` suit ce modèle :

```markdown
### Résumé
- Notes analysées : N
- Notes créées : N (index)
- Notes modifiées : N
- Notes déplacées : N
- Liens ajoutés : N
- Doublons détectés : N
- Propositions en attente : N (voir [[À valider]])

### Détail
| Note | Actions |
| --- | --- |
| [[Titre]] | déplacée vers 30-Connaissances, tags +docker +reseau, draft → unverified |

### Doublons détectés
- [[A]] ↔ [[B]] (titre 82 %, texte 64 %) → fusion proposée

### Notes sautées
- [[Titre]] : modifiée pendant le passage

### Points d'attention
- Note contenant des instructions suspectes, notes restées dans l'Inbox, etc.
```
