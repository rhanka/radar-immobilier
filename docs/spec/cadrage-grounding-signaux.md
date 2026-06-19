# Cadrage — Grounding des signaux (v2.3)

Objectif : rendre chaque Signal / DesignationEvent « grounded » avec une URL
streamable du PV source + page + citation verbatim, pour débloquer le bouton
PDF de l'UI et satisfaire le gate v2.3.

## 1. Contrat de grounding exigé par le gate v2.3

Source : `tools/graphify-v23/gate.sh` (étapes 6 et 7) + `tools/graphify-v23/worker.sh`
(clean-refs, étape 8) + transforms `graphify_to_extraction_v23.js` /
`extraction_to_v23_graph.js`.

Le gate REJETTE (`exit 1`) dans deux cas liés au grounding :

- **Étape 6 — `missing_signal_description_count_N`** : un Signal ou
  DesignationEvent dont `properties.description` est vide.
- **Étape 7 — `missing_grounded_signal_ref_genX_missY`** :
  - `genX` = nombre d'`edges[].refs[]` dont `rawRef` commence par `generated://`
    (refs fabriquées non nettoyées) ;
  - `missY` = nombre de Signal/DesignationEvent portant
    `properties.evidence_quality == "missing_source_link"`.

La condition « grounded » d'un noeud (clean-refs `worker.sh`, étape 8) est :
au moins UN des champs suivants non vide dans `node.properties` :

```
docSha | sourceUrl | pdfPath | rawRef
```

Si AUCUN n'est présent → le noeud est marqué
`properties.evidence_quality = "missing_source_link"` → le gate le rejette.

**Contrat MINIMAL exact** (pour passer le gate) :
> Chaque Signal/DesignationEvent doit avoir `properties.description` non vide
> ET au moins un de `properties.{docSha,sourceUrl,pdfPath,rawRef}`.
> `docSha` SEUL suffit.

**Grounding RICHE** (au-delà du gate, requis par l'UI / le produit) :
les `edges[].refs[]` portent `{docSha, page, excerpt}` (citation verbatim du
passage justifiant le signal). Le `mkRef` du transform mappe :
`source_file` 64-hex → `docSha`, `http…` → `sourceUrl`, `*.pdf` / `/pdf/` →
`pdfPath`, sinon `rawRef` ; `page` et `excerpt` (= texte de la citation)
sont copiés tels quels.

## 2. État réel de rimouski (baseline SCW `graph/rimouski/latest.json`)

- ontology_version **2.3**, municipality `rimouski`, pv_count 12.
- 53 nodes / 71 edges. **2 Signals + 10 DesignationEvents = 12 noeuds** groundables.
- Les 12 noeuds portent DÉJÀ `properties.docSha` (5 doc_sha distincts).
- 0 noeud `missing_source_link`, 0 ref `generated://`.

=> **Le baseline rimouski PASSE déjà le gate v2.3** (docSha présent partout).
Ce qui MANQUE pour le grounding produit : **page + citation verbatim** par
noeud, portées sur les `edges[].refs` (aujourd'hui `excerpt:"" page:1`).

5 doc_sha distincts :
- `0ba26024…6444e1` (cptaq Duchesne, derogation H312)
- `0d75f684…f7b4d` (ppcmoi Spar / Manoir, signal Spar 328 logements)
- `24850b86…2cd4e` (cptaq Dubois)
- `a4781f17…a6cd5` (derogations Orge / Arthur-Buies)
- `da8cd8b1…090ff` (rezonage H1289/R1287, creation C384, derogation 514, signal pôle commercial)

## 3. Récupérabilité des PV par doc_sha — OUI

- Bucket : `radar-immobilier-docs-pocs` (creds `.env` SCRAPE_S3_*, endpoint
  `https://s3.fr-par.scw.cloud`, region fr-par).
- Pattern CAS : `raw/<source>/cas/<sha256>.<ext>`.
- Source rimouski : `raw/proces-verbaux-rimouski/cas/<docSha>.pdf`.
- **Les 5 PV sont présents** (PDF v1.5, 58–101 pages, texte extractible via
  pdftotext) et téléchargeables par docSha.
- ⚠️ **PAS de fichiers `.meta.json`** pour cette source dans le CAS. Donc le
  résolveur `findDocumentMetadata(store,{docSha})` — qui scanne les `.meta.json`
  pour mapper docSha→rawRef — ne trouverait RIEN pour rimouski. Le rawRef est
  toutefois dérivable directement : `raw/<source>/cas/<docSha>.pdf`.

## 4. Route de streaming PDF côté api

- **Existe déjà** : `GET /api/documents/raw?rawRef=<clé S3>` →
  `api/src/routes/documents.ts`, sert les bytes via `ObjectStore.get()` avec
  Content-Type résolu. Store scrape = `getScrapeObjectStore(config)`
  (`api/src/storage/s3-object-store.ts`).
- **Manque** : pas de route `GET /…/pdf/:docSha` qui prenne un docSha nu et
  résolve le rawRef. Comme les `.meta.json` sont absents, l'ajout doit
  dériver/essayer le pattern CAS `raw/<source>/cas/<docSha>.pdf` (ou
  lister `raw/*/cas/<docSha>.*`) plutôt que se reposer uniquement sur
  `findDocumentMetadata`.

## 5. Plan pilote rimouski

1. Pour chaque doc_sha : `pdftotext -layout` → repérer la page + passage
   verbatim justifiant chaque signal/événement (Sonnet 4.6, `claude -p
   --model claude-sonnet-4-6`, ciblé sur le PV). AUCUNE invention.
2. Réinjecter `{docSha,page,excerpt}` sur les `edges[].refs` correspondants du
   baseline, re-transform v2.3 → gate → publish SCW → projeter PG.
3. Vérif SQL : count signaux groundés (`source_url`/`citation` ≠ null) > 0.
4. Ajouter la route `GET /…/pdf/:docSha` côté api si nécessaire (UI #2).
