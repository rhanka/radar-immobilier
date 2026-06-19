# tools/grounding — ré-ancrage (grounding) des signaux v2.3

Pipeline pour ancrer chaque Signal/DesignationEvent à sa source réelle
(PV + page + citation verbatim + URL streamable), satisfaire le gate v2.3 et
alimenter le bouton PDF + la citation de l'UI.

Voir `docs/spec/grounding-pilot-mont-tremblant.md` pour le diagnostic complet et
les résultats du pilote mont-tremblant.

## Étapes
1. Construire `nodes-by-sha.json` : map nœud→docSha (direct ou propagé via
   l'arête `raises_signal` du DesignationEvent parent). Aucune invention.
2. `pdftotext -layout` par page → texte marqué `===== PAGE N =====` (`txtp/`).
3. `extract-citations.sh` — **Sonnet 4.6** (`claude -p --model claude-sonnet-4-6`)
   extrait page + citation verbatim par nœud (`found:false` si introuvable).
4. `build-grounded-graph.py` — injecte
   `refs:[{docSha,sourceUrl,rawRef,page,excerpt,citation}]` (top-level → `props.refs`)
   + scalaires `properties.*`, purge les refs `generated://`/`synthetic`,
   bump `ontology_version`→`2.3`.
5. Publier via `tools/graphify-v23/gate.sh` (publish atomique SCW + backup history).

## Garde-fous
- Sonnet 4.6 uniquement pour l'extraction LLM (pas codex/spark).
- Préservation des signaux 2.1/2.2 (le gate refuse toute régression).
- Zéro invention : si aucun PV n'est retrouvable pour un nœud, ne pas fabriquer
  de citation (`found:false`, le nœud reste tel quel).
- sourceUrl/rawRef proviennent des `.meta.json` sidecar S3 (CAS).
