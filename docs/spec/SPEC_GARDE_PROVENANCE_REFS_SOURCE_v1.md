# SPEC — Garde de provenance des refs source par-nœud (§7.6-reg) — v1

> **Statut** : SPEC held pour gate i-cond + co-val recette (intégrité). **DESIGN uniquement — implémentation NON démarrée.**
> **Auteur** : i-arch (graph-store). **Domaine** : `api/src/services/graph/graph-store.ts` (`upsertGraphAtomic` + gardes) et son miroir read-only `graph-candidate-check.ts` (#598).
> **Déclencheur** : régression owner-constatée — les 4 signaux rezonage Ste-Martine ont **perdu leur ref PV source** après une projection grounding REPLACE, sans abort. Root-cause data = extraction.
> **⚠️ Paramètre ouvert BLOQUANT l'implémentation** : le **champ exact** protégé (`props.refs` ? `sourceRef` ? `docRefs`/`docSha` ? `docSha` du DesEvent lié ?) est **à confirmer par la mesure extraction** avant tout code. Ce document conçoit la garde **indépendamment** de ce choix ; §5 l'isole.

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

> Pour tout nœud présent **à la fois** dans l'état PG courant (avant) **et** dans le candidat (après), l'ensemble des **refs source identifiantes** de l'avant doit être **préservé** dans l'après. Une ref source présente avant et **absente après** = **régression de provenance** → **ville abortée** (rollback, 0 perte), sauf exemption intentionnelle.

Formellement, par nœud `n ∈ before ∩ after` (match par `id`) et hors `intendedRemovals` :
`sourceRefIdentities(before[n]) ⊆ sourceRefIdentities(after[n])`

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

Intégration dans `upsertGraphAtomic` : **gate3 en lecture seule AVANT la transaction** (comme gate1). Si `findMissingSourceRefs` non vide → `return { aborted: true, reason: "source-ref provenance regression for <city>: <nodeId>: <missingRefIds>; projection refused" }`. **NE throw PAS** (les autres villes continuent) — identique à gate1.

Ordre : gate1 (business-props) → **gate3 (provenance refs)** → transaction → gate2 (complétude, count). Toute garde qui fire → abort.

## 4. Exemption intentionnelle

`intendedRemovals: ReadonlySet<string>` (per-NŒUD, #551) exempte gate3 comme gate1 : un nœud dont le retrait/rotation de provenance est **voulu** (purge, correction de source) est passé dans `intendedRemovals` → gate3 le saute. **Note de conception** : `intendedRemovals` est per-nœud, pas per-ref ; si une **rotation de ref fine** (remplacer la ref A par la ref B sur un nœud conservé) devient un besoin réel, ce sera une extension séparée (`intendedRefRemovals` per-ref) — **hors de ce lot** (YAGNI tant que non mesuré).

## 5. ⚠️ LE CHAMP À PROTÉGER — paramètre ouvert (mesure extraction requise)

`sourceRefIdentities(node)` doit renvoyer l'ensemble des **identifiants stables** des refs source d'un nœud. Le **choix du champ + de la clé d'identité** dépend de la structure réelle mesurée par extraction. Candidats :

| Option | Identité | Pour | Contre |
|---|---|---|---|
| **A. `props.refs[].docSha`** | hash de contenu du document source | identité **stable** (même PV = même sha), robuste à la reformulation de la citation | suppose que chaque ref porte un `docSha` |
| B. `props.refs[].rawRef` | clé objet S3 brute (le PV) | présent quand pas de docSha | une re-clé S3 romprait l'identité |
| C. `sourceRef` (colonne nœud) | ref source unitaire du nœud | simple | 1 seule ref, insuffisant si multi-refs |
| D. `docSha` du DesEvent lié (`raises_signal`) | provenance héritée | couvre le cas #600 | dépend de la topologie ; **écarté si le modèle = « PV propre du signal »** |

**Recommandation provisoire (à confirmer)** : **Option A (`props.refs[].docSha`)** comme clé d'identité primaire, avec repli B (`rawRef`) quand `docSha` absent — c'est la provenance **content-stable** du nœud lui-même, cohérente avec le modèle owner « le PV EST la citation propre du signal ». **À VALIDER** par la mesure extraction (structure réelle des refs sur les 4 rezonage + le champ où vit la provenance PV) **avant implémentation**.

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

## 8. Questions ouvertes (à clore avant/pendant l'implémentation)

- **Q1 (bloquante)** : le champ + la clé d'identité (§5) — mesure extraction.
- **Q2** : périmètre des types de nœuds — gate3 sur TOUS les nœuds porteurs de refs (générique, comme gate1) ou restreint à `Signal`/`DesignationEvent` ? Défaut proposé : **générique** (toute provenance mérite protection), sauf contre-indication mesurée.
- **Q3** : une ref « source » vs une ref « enrichissement grounding » sont-elles distinguables dans la structure ? Si oui, gate3 ne protège que les refs **source** (la citation grounding ajoutée n'est pas une provenance à figer). À clarifier avec extraction.

---

**Rien n'est implémenté tant que Q1 (le champ) n'est pas confirmé par extraction** (consigne i-cond). Ce document est le design ; l'implémentation (garde + tests + upgrade #598) suivra dans un lot de code séparé, held-for-gate + co-val recette.
