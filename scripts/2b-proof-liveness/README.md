# #2b — Balayage périodique de vivacité des preuves servies

Décision owner (« **canonique + sweep** ») : la source publique canonique reste
le lien principal (traçabilité) + l'archive same-origin à côté (déjà en place),
**et** un job planifié re-mesure la vivacité des URL de preuve et **flague les
mortes**. Pas de repli auto-404 (CORS interdit le probe cross-origin en client),
pas de nouveau backend : un simple GitHub Action.

## Pièces

- `manifest.json` — jeu d'URL à balayer, **dérivé** de l'extraction recette
  `PROOF_URLS_SERVED.json` (`proofs[]`). Deux classes :
  - `critical` (`hasArchive=false`) : **orphelines** = seul vecteur de « 404 nu »
    (aucun repli archive same-origin). 16 URLs à la génération.
  - `monitored` (`object-storage-public`) : preuves publiques re-autorisées par
    la whitelist #2b — surveillées, non bloquantes. 300 URLs à la génération.
  Les preuves `clean` **avec** repli archive ne sont pas balayées : leur risque
  de 404 nu est borné par l'archive same-origin (`rawRef` → `/api/documents/raw`).
- `sweep.mjs` — script Node (sans dépendance) : HEAD→GET poli, timeout, pool de
  concurrence. Écrit un rapport JSON. **Exit 1 SSI** une orpheline (sans archive)
  est morte (le vrai risque). `node sweep.mjs --self-test` teste la décision sans
  réseau.
- `.github/workflows/2b-proof-liveness-sweep.yml` — planifié (lundi 07:00 UTC) +
  `workflow_dispatch`. **Jamais** sur `pull_request` (le fetch réseau externe
  reste hors du gate CI). Le job devient rouge sur une orpheline morte.

## Régénérer le manifeste

Quand l'extraction servie change (nouvelles villes/preuves, re-mesure recette),
régénérer depuis la source recette :

```
python3 - <<'PY'
import json, collections
src = "docs/reports/recette/PROOF_URLS_SERVED.json"  # extraction recette
d = json.load(open(src)); proofs = d["proofs"]; sel = {}
for p in proofs:
    url = p.get("sourceUrl")
    if not url: continue
    orphan = not p.get("a_un_archive_S3"); oss = p.get("subtype") == "object-storage-public"
    if not (orphan or oss): continue
    ha = bool(p.get("a_un_archive_S3")); e = sel.get(url)
    if e is None:
        sel[url] = {"sourceUrl": url, "citySlug": p.get("citySlug"),
                    "municipality": p.get("municipality"), "hasArchive": ha, "subtype": p.get("subtype")}
    else:
        e["hasArchive"] = e["hasArchive"] and ha
items = sorted(sel.values(), key=lambda x: (x["hasArchive"], x["citySlug"] or "", x["sourceUrl"]))
crit = [x for x in items if not x["hasArchive"]]
manifest = {"contract": "2b-proof-liveness-manifest/v1",
            "source": "recette PROOF_URLS_SERVED.json (proofs[]) — " + d.get("contract", ""),
            "source_note": d.get("generated_note", ""), "derived_at": "YYYY-MM-DD",
            "scope": "orphelines (hasArchive=false) + object-storage-public (#2b).",
            "counts": {"total": len(items), "critical_no_archive": len(crit),
                       "monitored_object_storage": len(items) - len(crit)}, "items": items}
json.dump(manifest, open("scripts/2b-proof-liveness/manifest.json", "w"), ensure_ascii=False, indent=2)
print(len(items), "URLs |", len(crit), "critiques")
PY
```

Le manifeste est un **snapshot versionné** (le runner CI n'a pas d'accès S3 :
les creds object-storage vivent côté cluster, pas sur le runner). Le rafraîchir
périodiquement garde la couverture alignée sur l'extraction servie.
