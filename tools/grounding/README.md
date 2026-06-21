# tools/grounding — ré-ancrage (grounding) des signaux v2.3

Pipeline pour ancrer chaque Signal/DesignationEvent à sa source réelle
(PV + page + citation verbatim + URL streamable), satisfaire le gate v2.3 et
alimenter le bouton PDF + la citation de l'UI.

Voir `docs/spec/grounding-pilot-mont-tremblant.md` pour le diagnostic complet et
les résultats du pilote mont-tremblant.

## Pipeline (bout en bout)

`docSha → PDF S3 → pdftotext → Sonnet 4.6 verbatim → inject properties.citation → gate → publish SCW`

1. **Map nœud→docSha** : `nodes-by-sha.json` — direct (`properties.docSha`) ou
   propagé via l'arête `raises_signal` du DesignationEvent parent. Aucune invention.
2. **Téléchargement S3** : PDF + sidecar `.meta.json` depuis
   `raw/proces-verbaux-<city>/cas/<docSha>.pdf` (fallback HTML).
3. **`pdftotext -layout`** par page → texte marqué `===== PAGE N =====`.
4. **Extraction citations — Sonnet 4.6** (`claude -p --model claude-sonnet-4-6`) :
   page + citation verbatim par nœud (`found:false` si introuvable).
5. **`build-grounded-graph.py`** : injecte
   `refs:[{docSha,sourceUrl,rawRef,page,excerpt,citation}]` (top-level → `props.refs`)
   + scalaires `properties.citation/page/sourceUrl/rawRef`, purge les refs
   `generated://`/`synthetic`, bump `ontology_version`→`2.3`.
6. **Gate + publish** : `gate-grounding.sh` (check 7bis, voir ci-dessous) qui
   délègue au gate canonique `tools/graphify-v23/gate.sh` (publish atomique SCW +
   backup `graph/<city>/history/`).

## Scripts

- `worker-grounding.sh <city> <candidate> <out> <work_dir> <root>` — étapes 1→5
  pour une ville (télécharge, extrait, injecte). Émet un graphe groundé prêt au gate.
- `extract-citations.sh` — variante autonome de l'étape 4 (pilote mont-tremblant,
  lit `nodes-by-sha.json` + `txtp/`).
- `build-grounded-graph.py <baseline> <out> [meta_dir] [cites_dir]` — étape 5.
- `gate-grounding.sh <city> <candidate> <baseline> <run_dir> <lane_id>` — wrapper
  de gate SPÉCIFIQUE au grounding (check 7bis → délègue au gate canonique).
- `drive-grounding.sh <worklist> <run_dir> [n_lanes]` — pilote multi-villes
  (faible concurrence, résumable via SCW), enchaîne worker → gate-grounding par ville.

## Garde-fous

- **Sonnet 4.6 uniquement** pour l'extraction LLM (pas codex/spark).
- Préservation des signaux 2.1/2.2 (le gate refuse toute régression).
- **Zéro invention** : si aucun PV n'est retrouvable pour un nœud, ne pas fabriquer
  de citation (`found:false`, le nœud reste tel quel).
- sourceUrl/rawRef proviennent des `.meta.json` sidecar S3 (CAS).

## Gate 7bis (citation verbatim obligatoire) — grounding-local

`gate-grounding.sh` ajoute un check **propre au grounding** : tout nœud-cible
portant un `docSha` DOIT porter une `citation` verbatim non vide (et il faut au
moins une citation). Sinon le LLM a échoué et on publierait un ancrage sans preuve.

⚠️ Ce check n'est **PAS** dans le gate canonique `tools/graphify-v23/gate.sh` :
celui-ci sert aussi au flux re-graphify où des signaux 2.1/2.2 légitimes n'ont pas
encore de citation. L'y mettre casserait ce flux. Le check vit donc ici uniquement.

## Durcissements (fix conservés)

Trois corrections faites lors du run de grounding sous charge, préservées ici :

1. **`worker-grounding.sh` — timeout + retries.** `claude -p` pouvait timeout à
   150 s sous charge → réponse vide → 0 citation. Corrigé : `timeout 360` + 3
   tentatives tant que la réponse est vide / sans JSON.
2. **`build-grounded-graph.py` — robustesse refs.** Crashait
   (`AttributeError 'str'.get`) sur des graphes anciens où `edges[].refs` sont des
   strings. Corrigé : filtrage `isinstance(r, dict)` (les refs non-dict sont
   conservées telles quelles, pas traitées comme synthétiques). Fallback aussi sur
   `description` vide → `label` du nœud.
3. **Gate 7bis.** Voir section ci-dessus : exiger la citation verbatim avant
   publication, dans le wrapper grounding (pas dans le gate partagé).
