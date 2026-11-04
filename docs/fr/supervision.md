# Supervision (Zabbix)

Consultée dans l'interface Zabbix, sans notification externe. Le serveur MCP expose un statut JSON sur le port `9101`, **uniquement sur le LAN** :

```json
{
  "vault": { "notes": 412, "bytes": 3145728, "last_commit": {...}, "last_commit_age_s": 1800 },
  "agent": { "mode": "simulation", "last_report_at": "…", "last_report_age_s": 18000, "run_in_progress": false },
  "backup": { "last_success_epoch": 1793724530, "last_result": "ok", "couchdb_docs": 5120, "vault_bytes": 3200000 }
}
```

## Éléments

| Élément | Type | Source | Déclencheur |
| --- | --- | --- | --- |
| MCP disponible | HTTP agent | `http://<hôte>:9101/healthz` | code ≠ 200 pendant 5 min |
| MCP public | Web scenario | `https://notes.example.com/healthz` | échec 3 fois |
| Interface web | Web scenario | `https://vault.example.com/healthz` | échec 3 fois |
| CouchDB disponible | HTTP agent | `http://<hôte>:5984/_up` (auth admin) | code ≠ 200 |
| Conteneurs | Zabbix agent 2, plugin Docker | `docker.container_info.state.running` pour `couchdb`, `livesync`, `mcp`, `backup` (+ healthchecks Docker) | non `running` |
| Statut AIsidian | HTTP agent (élément maître) | `http://<hôte>:9101/status` | — |
| Âge du dernier snapshot | Dépendant, JSONPath `$.backup.last_success_epoch` | prétraitement JavaScript `return Math.floor(Date.now()/1000) - value;` | > 7200 s |
| Dernier rapport de l'agent | Dépendant, `$.agent.last_report_age_s` | — | > 21600 s **et** heure ≥ 08:00 (`time()>=080000`) |
| Activité des appareils | Dépendant, `$.vault.last_commit_age_s` | commit horaire | information |
| Taille du vault | Dépendant, `$.vault.bytes` | — | tendance |
| Taille de CouchDB | HTTP agent | `http://<hôte>:5984/<base>` JSONPath `$.sizes.file` | tendance / seuil |
| Nombre de documents CouchDB | Dépendant, `$.backup.couchdb_docs` | — | tendance |

## Limite connue

livesync-cli n'expose pas encore de statut de synchronisation. La fraîcheur du client headless est approchée par l'état du conteneur, son nombre de redémarrages et l'âge du dernier commit horaire (qui n'avance que si des fichiers changent). Contrôle manuel ponctuel : créer une note sur un appareil et vérifier qu'elle apparaît dans `vault/` (T01).

Wazuh n'est pas utilisé pour ce projet.
