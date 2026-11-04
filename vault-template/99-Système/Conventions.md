---
title: Conventions du vault
type: index
source: manual
tags:
  - systeme
status: validated
---
# Conventions du vault

## Organisation (esprit PARA)

| Dossier | Contenu |
| --- | --- |
| `00-Inbox/` | Captures pas encore triées |
| `10-Projets/` | Projets actifs |
| `20-Domaines/` | DFIR (dont `Certif/`), Homelab, Couche 8, École, Pro, Perso |
| `30-Connaissances/` | Notes concept |
| `40-Journal/` | Rapports de l'agent, notes datées |
| `90-Archives/` | Notes archivées |
| `99-Système/` | Templates, index, règles et prompt de l'agent (lecture seule pour Claude) |

## Règles

- Chaque dossier contient une note d'index (`Index Inbox`, `Index Homelab`…) : elle garde l'arborescence visible sur tous les appareils (LiveSync ne synchronise pas les dossiers vides) et liste les notes du dossier.

- Toutes les notes sont en français ; **une note par concept**.
- Noms de fichiers : titre lisible, sans date (`Docker Compose - réseaux.md`). Dates `AAAA-MM-JJ` en préfixe uniquement dans `40-Journal/`.
- Tags : à plat, minuscules, mots séparés par des tirets (`reverse-proxy`).
- Liens internes au format `[[Titre]]`.

## Frontmatter

```yaml
---
title: "Fonctionnement de Docker Compose"
created: 2026-11-03
updated: 2026-11-03
type: knowledge        # knowledge | project | journal | index | report
source: claude-ai      # claude-ai | claude-code | agent | manual
source_ref: ""         # lien ou identifiant de conversation si disponible
captured: 2026-11-03
tags:
  - docker
status: draft
---
```

## Statuts

`draft` (capture brute) → `unverified` (structurée, faits non vérifiés) → `validated` (confirmée par le propriétaire ou par une source) → `archived`.
Seul le propriétaire du vault passe une note en `validated`.
