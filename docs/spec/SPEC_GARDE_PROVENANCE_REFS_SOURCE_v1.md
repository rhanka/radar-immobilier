# SPEC — Garde de provenance des refs source par-nœud (§7.6-reg) — v1

> **Statut** : SPEC held pour gate i-cond + co-val recette (intégrité). **DESIGN uniquement — implémentation NON démarrée.**
> **Auteur** : i-arch (graph-store). **Domaine** : `api/src/services/graph/graph-store.ts` (`upsertGraphAtomic` + gardes) et son miroir read-only `graph-candidate-check.ts` (#598).
> **Déclencheur** : régression owner-constatée — les 4 signaux rezonage Ste-Martine ont **perdu leur ref PV source** après une projection grounding REPLACE, sans abort. Root-cause data = extraction.
> **✅ CHAMP CONFIRMÉ (mesure extraction, v1.1)** : la provenance PV vit sur **3 loci** — `Signal.props.refs` (direct, cas PIIA/dérogation), `DesignationEvent.refs`/`docSha` + l'arête **`raises_signal.refs`** (cas rezonage via le hop, `Signal.props.refs=[]` aujourd'hui). Extraction PROPAGE additivement la ref sur `Signal.props.refs` des rezonage. La garde protège les **3 loci par-nœud ET par-arête**. §5 détaille.

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

> Pour tout **nœud OU arête** présent **à la fois** dans l'état PG courant (avant) **et** dans le candidat (après), l'ensemble des **refs source identifiantes** de l'avant doit être **préservé** dans l'après. Une ref source présente avant et **absente après** = **régression de provenance** → **ville abortée** (rollback, 0 perte), sauf exemption intentionnelle.

Formellement :
- par nœud `n ∈ before ∩ after` (match par `id`), hors `intendedRemovals` : `sourceRefIdentities(before[n]) ⊆ sourceRefIdentities(after[n])` ;
- par arête `e ∈ before ∩ after` (match clé naturelle `src_id+dst_id+kind`) : `sourceRefIdentities(before[e]) ⊆ sourceRefIdentities(after[e])`.

- **Ajouts autorisés** : le candidat PEUT ajouter des refs (enrichissement, ex. une citation grounding) — seule la **disparition** d'une ref existante est une régression. (Même philosophie que gate1 : anti-disparition, pas anti-évolution.)
- **Nœuds nouveaux** (absents de l'avant) : aucune contrainte (rien à préserver).
- **Nœuds supprimés** intentionnellement : exemptés via `intendedRemovals` (§4).

## 3. Sémantique de `gate3` (fidèle aux gardes existantes)

Nouvelle fonction pure exportée, sur le modèle de `findMissingBusinessProperties` :

```
findMissingSourceRefs(
  beforeRows, afterRows, citySlug,
  intendedRemovals = ∅,
): SourceRefRegression[]   // { citySlug, nodeId, missingRefIds: string[] }
```

- Construit `afterById = Map(after.id → after)`.
- Pour chaque `beforeRow` (skip si `intendedRemovals.has(id)`) :
  - `missing = sourceRefIdentities(before) \ sourceRefIdentities(after[id] ?? ∅)`
  - si `missing ≠ ∅` → pousser une régression.
- Un nœud business-porteur qui **disparaît entièrement** (absent de l'après) est déjà couvert : ses refs sont toutes « missing » → régression (sauf `intendedRemovals`).

**Volet ARÊTES** (nouveau vs gardes existantes) — fonction sœur :

```
findMissingSourceRefEdges(
  beforeEdges, afterEdges, citySlug,
): SourceRefRegression[]   // { citySlug, edgeKey, missingRefIds }
```

- `afterByKey = Map("src_id\0dst_id\0kind" → edge)`.
- Pour chaque arête avant : `missing = sourceRefIdentities(before) \ sourceRefIdentities(after[key] ?? ∅)` ; si non vide → régression.
- Les arêtes « avant » sont chargées read-only (comme les nœuds `beforeRows`), scopées à la ville (arêtes dont les deux extrémités sont des nœuds de la ville — cf `subgraphForCity`).

Intégration dans `upsertGraphAtomic` : **gate3 en lecture seule AVANT la transaction** (comme gate1), volet nœuds + volet arêtes. Si l'un des deux est non vide → `return { aborted: true, reason: "source-ref provenance regression for <city>: <node|edge>: <missingRefIds>; projection refused" }`. **NE throw PAS** (les autres villes continuent) — identique à gate1.

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

**Clé d'identité** d'une ref : **`docSha`** (hash de contenu du document = identité content-stable), repli `rawRef` quand `docSha` absent. Deux refs sont « la même » ssi même `docSha` (ou même `rawRef` à défaut).

**Conséquence de conception — gate3 couvre NŒUDS *ET* ARÊTES.** Les gardes existantes (gate1/gate2) ne touchent QUE les nœuds. Mais REPLACE supprime aussi les **arêtes** absentes du candidat (`upsertGraphAtomic` étapes 3-4) → une provenance portée par `raises_signal.refs` peut être effacée silencieusement. gate3 vérifie donc la préservation des refs source :
- **par-nœud** (match `id`) — `Signal` + `DesignationEvent` (+ générique, cf Q2) ;
- **par-arête** (match clé naturelle `src_id + dst_id + kind`) — au minimum `raises_signal`.

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

- **Q1 (le champ) — ✅ CLOSE** : 3 loci confirmés (§5) — `Signal.props.refs` + `DesignationEvent.props.refs`/`docSha` + arête `raises_signal.props.refs` ; identité = `docSha` (repli `rawRef`).
- **Q2 (périmètre types) — routée extraction** : gate3 générique (tous nœuds/arêtes porteurs de refs, comme gate1) ou restreint `Signal`/`DesignationEvent` + `raises_signal` ? Défaut proposé : **générique** (toute provenance mérite protection). En attente confirmation extraction.
- **Q3 (source vs enrichissement) — routée extraction** : distinguer une ref **source** (PV, à figer) d'une ref **enrichissement grounding** (ajoutée) ? Sans distinction, l'invariant `before⊆after` reste sûr (il ne fige que ce qui existait ; les ajouts grounding restent libres). En attente extraction.

> **Impl gate3 bloquée sur Q2/Q3** (i-cond : implémenter dès confirmation extraction). Q1 close permet de figer le design ; Q2/Q3 ne changent que le PÉRIMÈTRE (quels types), pas la mécanique.

---

**Rien n'est implémenté tant que Q1 (le champ) n'est pas confirmé par extraction** (consigne i-cond). Ce document est le design ; l'implémentation (garde + tests + upgrade #598) suivra dans un lot de code séparé, held-for-gate + co-val recette.
