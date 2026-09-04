# SPEC — Garde de provenance des refs source par-nœud (§7.6-reg) — v1

> **Statut** : SPEC held pour gate i-cond + co-val recette (intégrité). **DESIGN uniquement — implémentation NON démarrée.**
> **Auteur** : i-arch (graph-store). **Domaine** : `api/src/services/graph/graph-store.ts` (`upsertGraphAtomic` + gardes) et son miroir read-only `graph-candidate-check.ts` (#598).
> **Déclencheur** : régression owner-constatée — les 4 signaux rezonage Ste-Martine ont **perdu leur ref PV source** après une projection grounding REPLACE, sans abort. Root-cause data = extraction.
> **✅ CHAMP CONFIRMÉ (mesure extraction, v1.2)** : provenance = **`docSha` SEUL** (content-stable, pas `(docSha,page)`), garde **node-level générique** sur `node.props.refs`, exclusion `rawRef ~ ^generated://`. La provenance vit à l'origine sur 3 loci (`Signal.props.refs` direct ; `DesignationEvent.refs`/`docSha` ; arête `raises_signal.refs`), mais #521 **matérialise** les refs d'arête SUR le nœud → gate3 reste **node-level** (pas de check per-arête). §5 détaille.

## 0. Portée & non-goals

**Dans le périmètre :** une **3e garde** (`gate3`) dans `upsertGraphAtomic`, empêchant une projection REPLACE d'**effacer ou d'écraser silencieusement l'identité de la ref source (provenance)** d'un nœud **déjà existant** en PG. Plus le report de cette garde dans le prédicteur read-only `predictProjectionAbort` (#598) pour qu'il redevienne un cohort-lock fiable.

**Hors périmètre (explicitement NON traité ici) :**
- ❌ La restauration des refs déjà perdues (data / re-grounding) = lane extraction.
- ❌ Le modèle produit « citation = PV propre du signal » (donnée) vs `citationFromEvent` (#600, affichage) — tranché à la réconciliation owner ; cette garde est **orthogonale** (elle protège la provenance quelle que soit la décision d'affichage).
- ❌ Toute correction/rotation LÉGITIME d'une ref (traitée via le mécanisme d'exemption existant `intendedRemovals`, §4).

## 1. État existant mesuré (source de vérité)

`upsertGraphAtomic(db, citySlug, graphJson, intendedRemovals)` — REPLACE atomique par ville (upsert + suppression des nœuds/arêtes absents du candidat), avec **2 gardes anti-régression** :

| Garde | Fonction | Couvre | **Angle mort** |
|---|---|---|---|
| gate1 | `findMissingBusinessProperties` | disparition/dégradation d'une clé sous **`props.properties`** (reglement_number, effet_densifiant, etape, instrument, …) | **NE couvre PAS `props.refs`** ni la provenance |
| gate2 | `countCompleteSignals` (après < avant) | **NOMBRE** de signaux « complets » (une ref citation+rawRef) | **COUNT-based, pas IDENTITY-based** : un candidat qui **remplace** la ref PV propre d'un nœud par une AUTRE ref « complète » préserve le count → passe ; si la ref PV n'était pas « complète », sa perte ne baisse pas non plus le count |

**Conséquence (la cause précise de la régression)** : REPLACE écrit `props.refs` par-nœud à partir du candidat ; **aucune garde ne protège l'IDENTITÉ de la ref source d'un nœud existant**. Un candidat grounding citation-focused peut donc écraser/supprimer la ref PV propre d'un signal sans qu'aucune garde n'aborte.

## 2. Invariant cible

> Pour tout **nœud** présent **à la fois** dans l'état PG courant (avant) **et** dans le candidat (après), l'ensemble des **docSha source** de l'avant doit être **préservé** dans l'après. Un docSha présent avant et **absent après** = **régression de provenance** → **ville abortée** (rollback, 0 perte), sauf exemption intentionnelle.

Formellement, par **nœud** `n ∈ before ∩ after` (match par `id`), hors `intendedRemovals` :
`docShas(before[n]) ⊆ docShas(after[n])`

> **NIVEAU NŒUD uniquement** (Q2, extraction) : la surface servie = `node.props.refs`. Les refs d'**arête** `raises_signal` sont la *source* de la matérialisation #521 (qui copie leur docSha SUR le nœud) — pas la surface gardée. #521 (matérialisation) **+** gate3 (protection nœud) protègent donc la provenance d'arête **indirectement**, sans check per-arête.

- **Ajouts autorisés** : le candidat PEUT ajouter des refs (enrichissement, ex. une citation grounding) — seule la **disparition** d'une ref existante est une régression. (Même philosophie que gate1 : anti-disparition, pas anti-évolution.)
- **Nœuds nouveaux** (absents de l'avant) : aucune contrainte (rien à préserver).
- **Nœuds supprimés** intentionnellement : exemptés via `intendedRemovals` (§4).

## 3. Sémantique de `gate3` (fidèle aux gardes existantes)

Nouvelle fonction pure exportée, sur le modèle de `findMissingBusinessProperties` :

```
findMissingSourceRefs(
  beforeRows, afterRows, citySlug,
  intendedRemovals = ∅,
): SourceRefRegression[]   // { citySlug, nodeId, missingDocShas: string[] }
```

- `nodeDocShas(row)` = ensemble des `docSha` des refs sous `props.refs` (repli : extraire le sha du `rawRef` `raw/proces-verbaux-<city>/cas/<docSha>.pdf` quand le champ `docSha` est vide), **EXCLUANT** toute ref dont `rawRef` commence par `generated://` (placeholders `gen_refs`, pas un vrai PV — Q3).
- Construit `afterById = Map(after.id → after)`.
- Pour chaque `beforeRow` (skip si `intendedRemovals.has(id)`) :
  - `missing = nodeDocShas(before) \ nodeDocShas(after[id] ?? ∅)`
  - si `missing ≠ ∅` → pousser une régression.
- **Générique** : tout nœud porteur de `props.refs` (miroir gate1), pas de restriction de type (Q2). Un nœud porteur de docSha qui **disparaît entièrement** est déjà couvert (tous ses docSha « missing »), sauf `intendedRemovals`.

Intégration dans `upsertGraphAtomic` : **gate3 en lecture seule AVANT la transaction** (comme gate1). Si non vide → `return { aborted: true, reason: "source-ref provenance regression for <city>: <nodeId>: <missingDocShas>; projection refused" }`. **NE throw PAS** (les autres villes continuent) — identique à gate1.

Ordre : gate1 (business-props) → **gate3 (provenance refs)** → transaction → gate2 (complétude, count). Toute garde qui fire → abort.

## 4. Exemption intentionnelle

`intendedRemovals: ReadonlySet<string>` (per-NŒUD, #551) exempte gate3 comme gate1 : un nœud dont le retrait/rotation de provenance est **voulu** (purge, correction de source) est passé dans `intendedRemovals` → gate3 le saute. **Note de conception** : `intendedRemovals` est per-nœud, pas per-ref ; si une **rotation de ref fine** (remplacer la ref A par la ref B sur un nœud conservé) devient un besoin réel, ce sera une extension séparée (`intendedRefRemovals` per-ref) — **hors de ce lot** (YAGNI tant que non mesuré).

## 5. ✅ CHAMP CONFIRMÉ (mesure extraction) — les 3 loci de provenance

La provenance PV vit sur **3 loci** (mesure extraction) ; `sourceRefIdentities(node|edge)` les couvre tous :

| Locus | Porté par | Cas |
|---|---|---|
| **`Signal.props.refs[]`** | le nœud Signal, directement | PIIA / dérogation (aujourd'hui) ; rezonage **après** le fix extraction (propagation additive de la ref sur le Signal) |
| **`DesignationEvent.props.refs[]` / `docSha`** | le nœud DesignationEvent | rezonage : l'event de zonage porte la ref PV + `docSha` |
| **arête `raises_signal.props.refs[]`** | l'**ARÊTE** event→signal | rezonage via le hop (la provenance transite par l'arête) |

**Clé d'identité (Q1)** : **`docSha` SEUL** (SHA-256 du PV, content-stable). **PAS `(docSha, page)`** — `page` est un raffinement intra-doc que le grounding remplace légitimement (page-1 générique → page-10 précise) pour le MÊME docSha ; l'inclure ferait un **faux-positif abort**. `rawRef` sert **uniquement** à EXTRAIRE le docSha du chemin (`…/cas/<docSha>.pdf`) quand le champ `docSha` est vide — pas comme clé alternative.

**Exclusion (Q3)** : une ref dont `rawRef ~ ^generated://` (placeholder `gen_refs`, pas un vrai PV) est **exclue** (pas une provenance à figer). Toute autre ref à docSha réel = provenance → figée, **y compris** les refs matérialisées #521 (`linkSource: projection-materialize-severed`).

**Niveau NŒUD (Q2)** : gate3 est **node-level** (surface servie = `node.props.refs`), **générique** sur tous les nœuds porteurs de refs. La provenance d'ARÊTE (`raises_signal.refs`) est protégée **indirectement** via #521 (matérialisation edge→node) + gate3-nœud — **pas** de check per-arête (cf §2).

**Note fix extraction (additif, non conflictuel)** : extraction propage la ref sur `Signal.props.refs` des rezonage. C'est un **AJOUT** → autorisé par l'invariant `before ⊆ after`. Après ce fix la carte lira `Signal.props.refs` en direct (source propre), et gate3 empêchera toute reprojection de la ré-effacer.

## 6. Upgrade #598 (cohort pre-flight)

`predictProjectionAbort` (`graph-candidate-check.ts`) **réutilise** aujourd'hui gate1+gate2 → il **hérite leur angle mort** (il ne prédit pas une perte/écrasement de ref source). Une fois `findMissingSourceRefs` implémentée :
- ajouter `sourceRefRegressions` au prédicteur (même réutilisation drift-proof que pour gate1/gate2) ;
- `wouldAbort = gate1 || gate3 || gate2` ;
- tests miroir. → #598 redevient un **cohort-lock fiable** (il prédit aussi les régressions de provenance).

## 7. Critères de co-val recette (intégrité)

1. **Perte** : candidat où un nœud existant PERD une ref source (présente en PG) → gate3 **aborte** (0 écriture, provenance préservée).
2. **Écrasement/swap** : candidat où la ref PV propre est remplacée par une autre ref « complète » (le cas qui passait gate2) → gate3 **aborte** (identité PV perdue détectée).
3. **Ajout** : candidat qui AJOUTE une ref (garde l'existante) → **pas d'abort** (enrichissement légitime).
4. **Exemption** : nœud dans `intendedRemovals` → **pas d'abort** (retrait voulu).
5. **#598** : les mêmes 4 cas prédits read-only sans écriture PG (miroir de gate3).

## 8. Questions

- **Q1 (clé d'identité) — ✅ CLOSE (extraction)** : **`docSha` SEUL** (content-stable), PAS `(docSha,page)` ; `rawRef` seulement pour extraire le docSha du chemin si vide (§5).
- **Q2 (périmètre) — ✅ CLOSE (extraction)** : **générique, node-level** — tous nœuds porteurs de `props.refs` ; les refs d'arête = source de matérialisation #521, pas la surface gardée (§5).
- **Q3 (source vs enrichissement) — ✅ CLOSE (extraction)** : figer TOUTE ref à docSha réel (y compris #521 `projection-materialize-severed`) ; **seule exclusion** = `rawRef ~ ^generated://` (§5).

> **✅ Impl gate3 DÉBLOQUÉE** (Q1/Q2/Q3 confirmées par extraction). Implémentation held-for-gate + co-val recette (lot de code séparé).

---

**Rien n'est implémenté tant que Q1 (le champ) n'est pas confirmé par extraction** (consigne i-cond). Ce document est le design ; l'implémentation (garde + tests + upgrade #598) suivra dans un lot de code séparé, held-for-gate + co-val recette.
