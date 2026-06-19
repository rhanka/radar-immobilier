# Grounding des signaux v2.3 — Diagnostic + pilote Mont-Tremblant

Objectif produit : ancrer chaque Signal / DesignationEvent à sa source réelle
(PV + page + citation verbatim + URL streamable) pour (a) débloquer le bouton
PDF + la citation de l'UI (bug #2 « citation/PDF = 0 ») et (b) satisfaire le
gate v2.3 (`missing_grounded_signal_ref`). Pilote livré : **mont-tremblant**.

## 1. Diagnostic — le gap exact

### Ce que le gate v2.3 exige (`tools/graphify-v23/gate.sh`)
Le gate REJETTE (`exit 1`) un candidat dans deux cas liés au grounding :

- **Étape 6 — `missing_signal_description_count_N`** : un Signal/DesignationEvent
  avec `properties.description` vide.
- **Étape 7 — `missing_grounded_signal_ref_genX_missY`** :
  - `genX` = nb d'`edges[].refs[]` dont `rawRef` commence par `generated://` ;
  - `missY` = nb de Signal/DesignationEvent portant
    `properties.evidence_quality == "missing_source_link"`.

Un nœud est « grounded » (clean-refs `worker.sh` étape 8) ssi au moins UN de
`properties.{docSha,sourceUrl,pdfPath,rawRef}` est non vide. **`docSha` seul
suffit pour le gate.**

### Le vrai trou : grounding nominal vs grounding produit
- Les baselines publiées portent `properties.docSha` (hash du PV) → elles
  passent le gate. Mais `sourceUrl`, `citation`, `page` sont **null**, et les
  refs d'arête sont **synthétiques** (`source_file: generated://edge/N`,
  `page: 1`, `synthetic: true`). Donc côté produit : aucune citation verbatim,
  aucune page réelle, et le bouton PDF de l'UI ne s'affiche pas.
- Côté UI/API : `GET /api/graph-signals/:city` (`buildEvidence`) lit
  `props.refs[0]` puis les scalaires `props.properties.{sourceUrl,citation,page}`.
  La route de streaming PDF **existe déjà** :
  `GET /api/documents/raw?rawRef=<clé S3>` (`api/src/routes/documents.ts`).
  Le résolveur `findDocumentMetadata(store,{docSha})` peut retrouver
  `sourceUrl` via les `.meta.json` sidecar — mais SEULEMENT s'ils existent.

### Récupérabilité des PV
- Bucket SCW `radar-immobilier-docs-pocs`, CAS `raw/<source>/cas/<sha256>.<ext>`.
- mont-tremblant : 2 PV (3 p. + 15 p.), **avec** `.meta.json` (sourceUrl présent).
- rimouski : 5 PV, **sans** `.meta.json` (sourceUrl à reconstituer ; rawRef
  dérivable du pattern CAS).

## 2. Pipeline de grounding (réutilisable — `tools/grounding/`)
1. `nodes-by-sha` : mapper chaque Signal/DesignationEvent à un docSha réel.
   docSha direct sur le nœud, sinon propagé via l'arête `raises_signal` du
   DesignationEvent parent (aucune invention de source).
2. `pdftotext -layout` par page → texte marqué `===== PAGE N =====`.
3. `extract-citations.sh` : pour chaque PV, **Sonnet 4.6**
   (`claude -p --model claude-sonnet-4-6`) extrait, par nœud, la **page** + la
   **citation verbatim** (30–400 car., `found:false` si introuvable — zéro
   invention).
4. `build-grounded-graph.py` : injecte sur chaque nœud
   `refs:[{docSha,sourceUrl,rawRef,page,excerpt,citation}]` (top-level → `props.refs`
   lu par l'API) + scalaires `properties.{sourceUrl,rawRef,citation,page}` ;
   purge les refs d'arête `generated://`/`synthetic` ; bump `ontology_version`→`2.3`.
5. `gate.sh` → publish atomique SCW (backup `history/` automatique).

## 3. Résultat pilote — Mont-Tremblant (vérifié)

Extraction Sonnet 4.6 : **13/13** nœuds cités (2/2 sur PV `4d504aff`,
11/11 sur PV `aa42c72a`). Citations vérifiées verbatim contre le texte PV aux
pages citées (ex. `2026-DM-030`, `Règlement (2026)-102-85`, `239.58`).

Gate v2.3 (réel `gate.sh`) : header OK, shapes OK, préservation 3 Signals + 10
Events OK, 0 missing description, **0 generated_edge_refs, 0 missing_source_link**
→ **PUBLISHED** `graph/mont-tremblant/latest.json` (ontology_version 2.3),
backup `history/pre-v23-pilot-mt-*.json`.

Projection PG réelle (`graph_nodes`, via le mapping `upsertGraph` exact) :

| métrique          | baseline (v2.2) | grounded (v2.3) |
|-------------------|-----------------|-----------------|
| signals/events    | 13              | 13              |
| with source_url   | **0**           | **13**          |
| with citation     | **0**           | **13**          |
| with PDF (rawRef) | **0**           | **13**          |
| with page         | **0**           | **13**          |
| with docSha       | 10              | 13              |

=> **mont-tremblant = lots ✓ + zones ✓ + v2.3 ✓ + PDF/citation ✓ = COMPLÈTE.**

## 4. Rimouski — coordonné, non dupliqué
Au moment du pilote, l'agent `feat/grounding-pilot-rimouski` exécutait DÉJÀ
l'extraction de citations rimouski (4/5 PV faits, citations verbatim valides).
Pour éviter une course de publication sur `graph/rimouski/latest.json` et un
double appel LLM, rimouski n'a PAS été re-traité ici ; le pipeline ci-dessus est
identique et directement applicable (rimouski a juste besoin, en plus, du
backfill des `.meta.json` sidecar manquants pour exposer `sourceUrl`).
