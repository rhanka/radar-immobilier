# Graphify 3.4 — Legacy Filter A (z|m|p) HEAD inventory

**Date:** 2026-07-24
**Base:** worktree `feat/graphify-3-4-foundation` (branché sur `origin/main`),
commit de base `5f036a5`.
**Statut:** inventaire de référence (foundation lot). Aucune modification du
comportement A runtime — ce document décrit ce qui EXISTE à HEAD.

Ce document répond à l'exigence #1 de l'addendum
[`graphify-3.4-legacy-filter-a-addendum.md`](graphify-3.4-legacy-filter-a-addendum.md)
(« Redo the HEAD inventory ») : la carte exacte des fichiers et fonctions HEAD
qui portent le filtre A legacy `z|m|p`, ses compteurs, son ordre et ses états
URL. Tous les chemins et symboles ci-dessous ont été vérifiés dans le code à la
date indiquée. Les goldens qui figent ce comportement sont décrits en fin de
document.

Convention d'axes : `z` = zonage, `m` = multi-4+ (dimension), `p` = précoce
(avis_motion / projet_reglement). Le filtre A canonique = `z|m|p` (les trois axes
cochés). L'axe `r` (pertinence résidentielle) et le vivier `vivier-v2` (« B ») sont
des ajouts POST-A ; ils sont hors de l'invariant de l'addendum et n'apparaissent
ici que là où ils cohabitent avec A sur la même passe.

---

## 1. Autorité serveur — prédicats et compteurs A

### 1.1 Prédicats atomiques `z / m / p`
Fichier : `api/src/services/graph/graph-store.ts`

| Axe | Fonction | Ancre | Règle (verbatim du code) |
|-----|----------|-------|--------------------------|
| z | `isZonageSignal(type, category, etape)` | `graph-store.ts:1004` | `DesignationEvent` → toujours zonage ; `Signal` + `category ∈ ZONAGE_CATEGORIES` OU `etape ∈ ZONAGE_CATEGORIES` → zonage ; sinon non. |
| — | `ZONAGE_CATEGORIES` (15 valeurs) | `graph-store.ts:968` | rezonage, derogation, derogation_mineure, piia, cptaq, ppcmoi, lotissement, subdivision, densification, usage_conditionnel, modification_zonage, changement_usage, zone_agricole, contrainte_reglementaire, patrimoine. |
| m | `isMulti4Plus(type, nbUnitesMax, intensite)` | `graph-store.ts:1172` | `Signal` seulement ; `intensite === "haute"` OU `nb_unites_max ≥ 4` (parseInt). `DesignationEvent` → false. |
| p | `isPrecoceSignal(etapeAnnote, label, description)` | `graph-store.ts:1362` | étape annotée si présente (trim), sinon `deriveEtape(label, description)` ; précoce ⟺ `avis_motion` OU `projet_reglement`. |
| — | `deriveEtape(label, description)` | `graph-store.ts:1083` | dérivation par mots-clés (avis de motion → second projet → projet de règlement → …), défaut `inconnu`. |
| — | `ETAPES_PRECOCES` | `graph-store.ts:1061` | `["avis_motion", "projet_reglement"]`. |

### 1.2 Membership legacy A et compteurs
Fichier : `api/src/services/graph/vivier-v2.ts`

| Élément | Ancre | Rôle |
|---------|-------|------|
| `LegacySubsetKey` (8 clés) | `vivier-v2.ts:45` | `"" | z | m | p | z\|m | z\|p | m\|p | z\|m\|p`. |
| `LEGACY_SUBSET_KEYS` | `vivier-v2.ts:76` | ordre canonique des 8 clés (source unique). |
| `LEGACY_ZMP_VERSION` | `vivier-v2.ts:55` | `"legacy-zmp-v1"` — version portée par chaque membership. |
| `LegacyZmpMembership` | `vivier-v2.ts:57` | `{ version, signalId, flags:{z,m,p} }`. |
| `extractLegacyZmpInput(node)` | `vivier-v2.ts:154` | **reproduit la projection SQL legacy 8fe75cd** : ne lit QUE `props.properties.{category,description,etape,nb_unites_max,intensite}` + `label` + `type` + `sourceRef`. |
| `classifyLegacyZmpSignal(signal)` | `vivier-v2.ts:389` | calcule `{z,m,p}` via les trois prédicats §1.1. |
| `buildLegacyZmpProjection(memberships)` | `vivier-v2.ts:414` | projection A = `{ version, a:{ count, signalIds } }` où `signalIds` = ids tels que `z ∧ m ∧ p`, **dans l'ordre d'entrée**. |
| `computeLegacySubsetCounts(signals)` | `vivier-v2.ts:426` | pour chaque signal, `+1` à `""` puis `+1` à toute clé dont TOUS les flags sont vrais (superset : `subsetCounts["z"]` compte tous les zonage, etc.). |

**Note importante (ordre) :** `buildLegacyZmpProjection` **préserve l'ordre
d'entrée** (un simple `filter`/`map`) — il n'y a pas de tri ni de tie-break
supplémentaire côté A. L'ordre servi est donc celui des nœuds tels que renvoyés
par la requête (`getSignalNodesForCity`).

### 1.3 Agrégation par ville (rail bulk) et parité
Fichier : `api/src/services/graph/graph-store.ts`

| Élément | Ancre | Rôle |
|---------|-------|------|
| `SubsetKey` (16 clés z/m/p/r) | `graph-store.ts:1284` | surensemble des 8 clés legacy + l'axe `r`. |
| `buildSubsetKey(z,m,p,r=false)` | `graph-store.ts:1298` | à 3 args → identique au modèle `{z,m,p}` historique. |
| `aggregateGraphSignalProjectionRows(rows)` | `graph-store.ts:1401` | **une seule passe** : les 8 clés legacy sont écrites depuis `computeLegacySubsetCounts(legacySignals)` (`graph-store.ts:1460-1463`) ; l'axe `r` (B′) est ajouté à part et **ne touche pas** les 8 clés legacy. |
| `classifyGraphNodeLegacyZmp(input)` | `graph-store.ts:1349` | membership legacy d'un nœud carte, depuis la même entrée que les compteurs. |
| `listCitiesWithSignalNodes(db)` | `graph-store.ts:1494` | lit `graph_nodes` (types `Signal`/`DesignationEvent`) → `aggregateGraphSignalProjectionRows`. |

**Invariant de wiring :** pour chaque ville et chaque clé legacy,
`aggregate.subsetCounts[clé] === computeLegacySubsetCounts(...)[clé]`. C'est la
parité rail↔legacy figée par le golden serveur (§4.1).

---

## 2. Routes — exposition du contrat A
Fichier : `api/src/routes/graph-signals.ts`

| Endpoint | Ancre | Sortie A |
|----------|-------|----------|
| `GET /api/graph-signals/by-city` | `graph-signals.ts:859` | `{ cities:[{ citySlug, signalCount, subsetCounts }] }` — les compteurs bulk (dont les 8 clés legacy). |
| `GET /api/graph-signals/:city` | `graph-signals.ts:866` | `{ citySlug, legacyProjection, nodes }` où chaque nœud porte `legacySubset` (`graph-signals.ts:413`, champ typé `graph-signals.ts:82`) et `legacyProjection = buildLegacyZmpProjection(...)` (`graph-signals.ts:895`). |

La projection A détaillée (`legacyProjection.a.signalIds`) est l'autorité serveur
que l'UI revalide item par item (cf. §3.2).

---

## 3. Présentation UI — filtre et états URL

### 3.1 Filtre client (panneau/rail)
Fichier : `ui/src/lib/signals/graph-signal-filter.ts`

| Élément | Ancre | Règle |
|---------|-------|------|
| `ZONAGE_CATEGORIES_CLIENT` | `graph-signal-filter.ts:14` | miroir client de `ZONAGE_CATEGORIES` serveur (15 valeurs identiques). |
| `nodeIsZonage(node)` | `graph-signal-filter.ts:41` | miroir de `isZonageSignal` (type + `category`/`etape`). |
| `legacyPrecoceFlag(node)` | `graph-signal-filter.ts:120` | lit `node.legacySubset.flags.p` **si** membership valide (`version==="legacy-zmp-v1"` ∧ `signalId===node.id`), sinon `null`. |
| `nodeMatchesSubset(node, subsetKey)` | `graph-signal-filter.ts:144` | split de la clé par `\|` ; `z` → `nodeIsZonage` ; `p` → `legacyPrecoceFlag ?? repli B′` ; **flags inconnus ignorés**. |
| `filterNodesBySubset(nodes, subsetKey)` | `graph-signal-filter.ts:173` | filtre ; clé vide → **même référence** de tableau (identité). |

**Constat A capital (axe `m` côté client) :** dans `nodeMatchesSubset`, seuls
les tokens `z`, `p` (et `r`/`vivier-v2`) sont testés. Le token **`m` est un flag
inconnu → ignoré** : côté client, A ne filtre plus sur la dimension. L'axe `m`
ne survit que comme **compteur serveur** (rail) via `computeLegacySubsetCounts`.
Conséquence figée : `filterNodesBySubset(nodes,"z|m|p")` ≡
`filterNodesBySubset(nodes,"z|p")` en membership. Ce comportement est celui de
HEAD ; le golden UI le fige explicitement (§4.2).

### 3.2 Projection A validée + états URL/mode
Fichier : `ui/src/lib/signals/vivier-view-mode.ts`

| Élément | Ancre | Rôle |
|---------|-------|------|
| `A_SUBSET_KEY` | `vivier-view-mode.ts:16` | `"z|m|p"` — clé de MODE A (défaut). |
| `DEFAULT_A_FLAGS` | `vivier-view-mode.ts:40` | `{z:true,m:true,p:true}`. |
| `keyFromAFlags` / `aFlagsFromKey` | `vivier-view-mode.ts:75` / `:84` | compose/lit la clé A depuis les axes cochés (ordre `z\|m\|p`). |
| `modeFromSubsetKey(raw)` | `vivier-view-mode.ts:133` | tout le vocabulaire `z/m/p` (y compris `""` et le legacy `z\|p`) reste **mode A** ; seul le namespace opaque `vivier-v2` bascule en B. |
| `subsetKeyForMode(mode)` | `vivier-view-mode.ts:144` | clé de MODE persistée : A → `z\|m\|p`, B → `vivier-v2`. |
| `parseProjectionMode(value)` | `vivier-view-mode.ts:203` | valide l'autorité serveur (`version`, `count`, unicité des ids). |
| `projectLegacyVivierA(nodes, authority)` | `vivier-view-mode.ts:227` | projection A EXACTE : membership `z∧m∧p` revalidée contre les ids serveur ; tout écart → `available:false` (pas de repli partiel). |
| `projectComposedVivierA(nodes, authority, key)` | `vivier-view-mode.ts:261` | `z\|m\|p` → délègue à la projection exacte ; toute autre composition filtre sur `legacySubset.flags`. |
| `routeSubsetKey(route)` | `vivier-view-mode.ts:445` | lit `filters["subset"]` de l'URL et le **normalise à la clé de MODE**. |
| `initialVivierSubsetKey(route, stored)` | `vivier-view-mode.ts:452` | défaut `z\|m\|p` ; une clé legacy **partielle** stockée (ex. `z\|p`) est normalisée vers le défaut A (non collante). |
| `reconcileVivierRouteSubset(route, current)` | `vivier-view-mode.ts:462` | une navigation ville ne persiste que la clé de MODE ; la sous-sélection LIVE n'est jamais écrite en URL. |

Type client : `GraphSignalNode` (`ui/src/lib/signals/graph-signal-detail-client.ts:509`),
champ `legacySubset` (`:528`), `LegacyZmpProjection` (`:535`).

**États URL couverts (invariant addendum) :** défaut A = `z|m|p` ;
`""`/`z|p`/`m`/`p`/`z` restent mode A ; une clé partielle stockée retombe sur le
défaut A ; `vivier-v2[...]` seul bascule en B. Ces états sont figés par le golden
UI (§4.2).

---

## 4. Goldens & gate qui figent cet inventaire

### 4.1 Golden serveur
- Test : `api/src/services/graph/legacy-filter-a-golden.test.ts`
- Fixtures : `api/tests/fixtures/graphify/legacy-filter-a/{rows.json,expected.json}`
- Fige : membership `z/m/p` par signal ; les 8 clés legacy par ville ; la
  projection A **ordonnée** ; la parité `aggregate` ↔ `computeLegacySubsetCounts` ;
  les états vides. Corpus déterministe de 8 signaux / 2 villes.

### 4.2 Golden UI
- Test : `ui/src/lib/signals/legacy-filter-a-golden.test.ts`
- Fixtures : `ui/src/lib/signals/fixtures/legacy-filter-a-{nodes,expected}.json`
- Fige : membership+ordre de `filterNodesBySubset` par état de sous-ensemble
  (dont l'axe `m` ignoré) ; l'identité de la clé vide ; la normalisation des
  états URL/mode (`modeFromSubsetKey`, `subsetKeyForMode`, `initialVivierSubsetKey`,
  round-trip `keyFromAFlags`/`aFlagsFromKey`).

### 4.3 Gate exécutable
- `scripts/graphify-legacy-a-gate.sh` — lance les deux goldens A + le contrat
  InputSet ; **exit ≠ 0** si un golden diverge. Entièrement hors-ligne (ni
  Docker, ni S3, ni DB, ni réseau). Voir la commande en tête de script.

---

## 5. Périmètres et limites de cet inventaire

- **Couche « projection données » (Postgres) :** l'addendum exige un reçu par
  couche (Graphify / projection / UI). Cet inventaire couvre l'autorité serveur
  (dérivation des compteurs/membership à partir de `graph_nodes`) et l'UI. La
  projection graphe→Postgres (`upsertGraphAtomic`, `project-graph-from-s3.ts`)
  n'est PAS re-couverte ici : elle relève des lots materializer/cutover (hors
  périmètre foundation) et devra produire son propre reçu.
- Cet inventaire ne fige **aucun** comportement `r`/`vivier-v2` : ce sont des
  axes post-A, volontairement exclus de l'invariant legacy pour que le gate A
  reste insensible aux évolutions B′/B.
- Aucune donnée réelle de prod n'est intégrée : les corpus goldens sont
  déterministes et synthétiques, choisis pour exercer chaque prédicat.
