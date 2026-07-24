# Graphify 3.4 — Legacy Filter A (z|m|p) HEAD inventory

**Date:** 2026-07-24
**Base:** worktree `feat/graphify-3-4-foundation` (branched off `origin/main`),
base commit `5f036a5`.
**Status:** reference inventory (foundation lot). No change to runtime A
behaviour — this document describes what EXISTS at HEAD.

This document satisfies requirement #1 of the addendum
[`graphify-3.4-legacy-filter-a-addendum.md`](graphify-3.4-legacy-filter-a-addendum.md)
("Redo the HEAD inventory"): the exact map of HEAD files and functions that carry
the legacy `z|m|p` Filter A, its counters, its order, and its URL states. Every
path and symbol below was verified against the code on the stated date. The
goldens that freeze this behaviour are described at the end.

Axis convention: `z` = zoning, `m` = multi-4+ (density), `p` = early stage
(`avis_motion` / `projet_reglement`). Canonical Filter A = `z|m|p` (all three
axes checked). The `r` axis (residential relevance) and the `vivier-v2` vivier
("B") are POST-A additions; they sit outside the addendum invariant and appear
here only where they coexist with A on the same pass.

---

## 1. Server authority — A predicates and counters

### 1.1 Atomic predicates `z / m / p`
File: `api/src/services/graph/graph-store.ts`

| Axis | Function | Anchor | Rule (verbatim from code) |
|------|----------|--------|---------------------------|
| z | `isZonageSignal(type, category, etape)` | `graph-store.ts:1004` | `DesignationEvent` → always zoning; `Signal` + `category ∈ ZONAGE_CATEGORIES` OR `etape ∈ ZONAGE_CATEGORIES` → zoning; otherwise no. |
| — | `ZONAGE_CATEGORIES` (15 values) | `graph-store.ts:968` | rezonage, derogation, derogation_mineure, piia, cptaq, ppcmoi, lotissement, subdivision, densification, usage_conditionnel, modification_zonage, changement_usage, zone_agricole, contrainte_reglementaire, patrimoine. |
| m | `isMulti4Plus(type, nbUnitesMax, intensite)` | `graph-store.ts:1172` | `Signal` only; `intensite === "haute"` OR `nb_unites_max ≥ 4` (parseInt). `DesignationEvent` → false. |
| p | `isPrecoceSignal(etapeAnnote, label, description)` | `graph-store.ts:1362` | annotated stage if present (trimmed), else `deriveEtape(label, description)`; early ⟺ `avis_motion` OR `projet_reglement`. |
| — | `deriveEtape(label, description)` | `graph-store.ts:1083` | keyword derivation (avis de motion → second projet → projet de règlement → …), default `inconnu`. |
| — | `ETAPES_PRECOCES` | `graph-store.ts:1061` | `["avis_motion", "projet_reglement"]`. |

### 1.2 Legacy A membership and counters
File: `api/src/services/graph/vivier-v2.ts`

| Element | Anchor | Role |
|---------|--------|------|
| `LegacySubsetKey` (8 keys) | `vivier-v2.ts:45` | `"" \| z \| m \| p \| z\|m \| z\|p \| m\|p \| z\|m\|p`. |
| `LEGACY_SUBSET_KEYS` | `vivier-v2.ts:76` | canonical order of the 8 keys (single source). |
| `LEGACY_ZMP_VERSION` | `vivier-v2.ts:55` | `"legacy-zmp-v1"` — version carried by each membership. |
| `LegacyZmpMembership` | `vivier-v2.ts:57` | `{ version, signalId, flags:{z,m,p} }`. |
| `extractLegacyZmpInput(node)` | `vivier-v2.ts:154` | **reproduces the legacy SQL projection 8fe75cd**: reads ONLY `props.properties.{category,description,etape,nb_unites_max,intensite}` + `label` + `type` + `sourceRef`. |
| `classifyLegacyZmpSignal(signal)` | `vivier-v2.ts:389` | computes `{z,m,p}` via the three §1.1 predicates. |
| `buildLegacyZmpProjection(memberships)` | `vivier-v2.ts:414` | A projection = `{ version, a:{ count, signalIds } }` where `signalIds` = ids such that `z ∧ m ∧ p`, **in input order**. |
| `computeLegacySubsetCounts(signals)` | `vivier-v2.ts:426` | per signal, `+1` to `""`, then `+1` to every key whose flags are ALL true (superset: `subsetCounts["z"]` counts every zoning signal, etc.). |

**Order — honest statement.** `buildLegacyZmpProjection` **preserves input order**
(a plain `filter`/`map`) — there is no sort or tie-break on the A side. It follows
that the SERVED A order is exactly the order of the nodes as returned by the query
`getSignalNodesForCity` (`graph-store.ts:1528`). That query has **NO `ORDER BY`**,
so PostgreSQL does not guarantee a stable row order across runs. Consequently the
END-TO-END displayed A order is **not a contractual runtime order**. The goldens
(§4) freeze only what is genuinely deterministic: `buildLegacyZmpProjection`
preserves its INPUT order, and the UI `projectLegacyVivierA` follows the server
AUTHORITY's `signalIds` order — neither asserts a DB row order that the store does
not provide. Making the DB order contractual (add a deterministic `ORDER BY` and
golden it) is a runtime change and belongs to a later, non-foundation lot; this
foundation lot does not assert an order the query cannot back.

### 1.3 Per-city aggregation (bulk rail) and parity
File: `api/src/services/graph/graph-store.ts`

| Element | Anchor | Role |
|---------|--------|------|
| `SubsetKey` (16 z/m/p/r keys) | `graph-store.ts:1284` | superset of the 8 legacy keys + the `r` axis. |
| `buildSubsetKey(z,m,p,r=false)` | `graph-store.ts:1298` | with 3 args → identical to the historical `{z,m,p}` model. |
| `aggregateGraphSignalProjectionRows(rows)` | `graph-store.ts:1401` | **single pass**: the 8 legacy keys are written from `computeLegacySubsetCounts(legacySignals)` (`graph-store.ts:1460-1463`); the `r` axis (B′) is added separately and **does not touch** the 8 legacy keys. |
| `classifyGraphNodeLegacyZmp(input)` | `graph-store.ts:1349` | legacy membership of a card node, from the same input as the counters. |
| `listCitiesWithSignalNodes(db)` | `graph-store.ts:1494` | reads `graph_nodes` (types `Signal`/`DesignationEvent`) → `aggregateGraphSignalProjectionRows`. |

**Wiring invariant:** for every city and every legacy key,
`aggregate.subsetCounts[key] === computeLegacySubsetCounts(...)[key]`. This is the
rail↔legacy parity frozen by the server golden (§4.1).

---

## 2. Routes — A contract exposure
File: `api/src/routes/graph-signals.ts`

| Endpoint | Anchor | A output |
|----------|--------|----------|
| `GET /api/graph-signals/by-city` | `graph-signals.ts:859` | `{ cities:[{ citySlug, signalCount, subsetCounts }] }` — the bulk counters (incl. the 8 legacy keys). |
| `GET /api/graph-signals/:city` | `graph-signals.ts:866` | on non-empty city: `{ ok:true, citySlug, legacyProjection, nodes }` where each node carries `legacySubset` (`graph-signals.ts:413`, typed field `graph-signals.ts:82`) and `legacyProjection = buildLegacyZmpProjection(...)` (`graph-signals.ts:895`). On a city with no signal nodes: **HTTP 404** `{ ok:false, error:"no_signal_nodes", citySlug }` (`graph-signals.ts:872`). |

The detailed A projection (`legacyProjection.a.signalIds`) is the server authority
the UI revalidates item-by-item (see §3.2). The client maps the 404 to an empty,
authority-less state (`{ ok:false, legacyProjection:null, nodes:[] }`,
`graph-signal-detail-client.ts:570`).

---

## 3. UI presentation — filter and URL states

### 3.1 Client filter helper (NOT the A display path)
File: `ui/src/lib/signals/graph-signal-filter.ts`

| Element | Anchor | Rule |
|---------|--------|------|
| `ZONAGE_CATEGORIES_CLIENT` | `graph-signal-filter.ts:14` | client mirror of server `ZONAGE_CATEGORIES` (15 identical values). |
| `nodeIsZonage(node)` | `graph-signal-filter.ts:41` | mirror of `isZonageSignal` (type + `category`/`etape`). |
| `legacyPrecoceFlag(node)` | `graph-signal-filter.ts:120` | reads `node.legacySubset.flags.p` **iff** membership is valid (`version==="legacy-zmp-v1"` ∧ `signalId===node.id`), else `null`. |
| `nodeMatchesSubset(node, subsetKey)` | `graph-signal-filter.ts:144` | splits the key by `\|`; `z` → `nodeIsZonage`; `p` → `legacyPrecoceFlag ?? B′ fallback`; **unknown flags ignored**. |
| `filterNodesBySubset(nodes, subsetKey)` | `graph-signal-filter.ts:173` | filter; empty key → **same array reference** (identity). |

**Important:** `filterNodesBySubset` is **NOT the projection rendered for the A
display**. At HEAD, `SignauxMapView` builds the visible A set through
`projectNodesForVivierKey` / `projectLegacyVivierA` (§3.2, `SignauxMapView.svelte:343`
and `:549`); `filterNodesBySubset` is not on that path for A. In particular
`nodeMatchesSubset` **ignores the `m` token** (only `z`/`p`/`r`/`vivier-v2` are
tested), whereas the real display path (`projectComposedVivierA`) **honours `m`**
by reading `legacySubset.flags.m`. The golden therefore freezes the DISPLAY path,
not `filterNodesBySubset` (§4.2).

### 3.2 Validated A projection + URL/mode states (the A display path)
File: `ui/src/lib/signals/vivier-view-mode.ts`

| Element | Anchor | Role |
|---------|--------|------|
| `A_SUBSET_KEY` | `vivier-view-mode.ts:16` | `"z\|m\|p"` — A MODE key (default). |
| `DEFAULT_A_FLAGS` | `vivier-view-mode.ts:40` | `{z:true,m:true,p:true}`. |
| `keyFromAFlags` / `aFlagsFromKey` | `vivier-view-mode.ts:75` / `:84` | compose/read the A key from the checked axes (order `z\|m\|p`). |
| `modeFromSubsetKey(raw)` | `vivier-view-mode.ts:133` | all `z/m/p` vocabulary (incl. `""` and legacy `z\|p`) stays **mode A**; only the opaque `vivier-v2` namespace flips to B. |
| `subsetKeyForMode(mode)` | `vivier-view-mode.ts:144` | persisted MODE key: A → `z\|m\|p`, B → `vivier-v2`. |
| `parseProjectionMode(value)` | `vivier-view-mode.ts:203` | validates the server authority (`version`, `count`, id uniqueness, `count === signalIds.length`). |
| `projectLegacyVivierA(nodes, authority)` | `vivier-view-mode.ts:227` | EXACT A projection: `z∧m∧p` membership revalidated against the server ids AND their ORDER; any divergence (absent/corrupt authority, count/order/id mismatch, incompatible node membership) → `available:false` (no partial fallback). |
| `projectComposedVivierA(nodes, authority, key)` | `vivier-view-mode.ts:261` | `z\|m\|p` → delegates to the exact projection; any other composition filters on `legacySubset.flags` (incl. `m`), in node order. |
| `projectNodesForVivierKey(nodes, authority, key)` | `vivier-view-mode.ts:351` | live entry point used by `SignauxMapView`: mode A → `projectComposedVivierA`; mode B → `projectComposedVivierB`. |
| `routeSubsetKey(route)` | `vivier-view-mode.ts:445` | reads `filters["subset"]` from the URL and **normalizes to the MODE key**. |
| `initialVivierSubsetKey(route, stored)` | `vivier-view-mode.ts:452` | default `z\|m\|p`; a stored **partial** legacy key (e.g. `z\|p`) is normalized back to the A default (non-sticky). |
| `reconcileVivierRouteSubset(route, current)` | `vivier-view-mode.ts:462` | a city navigation persists only the MODE key; the LIVE sub-selection is never written to the URL. |

Client type: `GraphSignalNode` (`ui/src/lib/signals/graph-signal-detail-client.ts:509`),
field `legacySubset` (`:528`), `LegacyZmpProjection` (`:535`).

**URL states covered (addendum invariant):** default A = `z|m|p`;
`""`/`z|p`/`m`/`p`/`z` stay mode A; a stored partial key falls back to the A
default; `vivier-v2[...]` alone flips to B. These states are frozen by the UI
golden (§4.2).

---

## 4. Goldens & gate that freeze this inventory

### 4.1 Server golden
- Test: `api/src/services/graph/legacy-filter-a-golden.test.ts`
- Fixtures: `api/tests/fixtures/graphify/legacy-filter-a/{rows.json,expected.json}`
- Freezes: per-signal `z/m/p` membership; the 8 legacy keys per city; the
  A projection in **input order**; the `aggregate` ↔ `computeLegacySubsetCounts`
  parity; empty states. Deterministic corpus of 8 signals / 2 cities. It does NOT
  assert a DB row order (see §1.2).

### 4.2 UI golden (DISPLAY path)
- Test: `ui/src/lib/signals/legacy-filter-a-golden.test.ts`
- Fixtures: `ui/src/lib/signals/fixtures/legacy-filter-a-{nodes,expected}.json`
- Freezes the projection SignauxMapView actually renders,
  `projectNodesForVivierKey` / `projectLegacyVivierA`:
  - projected member set AND order for every legacy subset state (incl. the
    honoured `m` axis and the empty key);
  - the `z|m|p` exact-authority contract (order follows the authority `signalIds`,
    item-by-item revalidation);
  - **fail-closed** on absent authority (404 → `null`) and on a corrupt authority
    (wrong version / count / order / duplicate / unknown id / over-claim);
  - **fail-closed** on corrupt/absent node membership;
  - the empty-city case (no nodes) → available, count 0;
  - URL/mode normalization (`modeFromSubsetKey`, `subsetKeyForMode`,
    `initialVivierSubsetKey`, `keyFromAFlags`/`aFlagsFromKey` round-trip).

### 4.3 Transport golden (route → UI)
- Tests: `api/src/routes/legacy-filter-a-transport-golden.test.ts` (emitter) and
  `ui/src/lib/signals/legacy-filter-a-transport.test.ts` (consumer).
- Shared artifact: `api/tests/fixtures/graphify/legacy-filter-a/
  route-transport.golden.json` — the payload `GET /api/graph-signals/:city`
  REALLY serializes for the `alpha` corpus (read back from the response bytes),
  plus its 404 payload. The UI test reads that same file across workspaces (one
  contract, no second copy) and replays it through the real client
  `fetchGraphSignalDetail` (stubbed `fetch`) and then through the view's own call
  `projectNodesForVivierKey(nodes, legacyProjection, key)`.
- Closes the gap §4.1/§4.2 leave open: both are layer-local, so a broken
  `legacySubset` / `legacyProjection` mapping *between* them stayed green. It is
  verified by mutation: renaming the served `legacySubset.signalId` turns the API
  side red, and dropping `legacyProjection` in the client turns the UI side red
  while the §4.2 golden still passes 25/25.
- Also freezes, at that frontier: 404 → honest empty state (`ok:false`,
  `legacyProjection:null`, `nodes:[]`) → unavailable projection; 5xx → error, never
  a silently empty map; served authority corrupt (wrong order, over-claim) or
  absent → fail-closed; served node membership dropped/mismatched → fail-closed;
  empty city → available, count 0; and per-subset render counts equal to the
  server golden `subsetCounts` (cross-layer parity).

### 4.4 Executable gate
- `scripts/graphify-legacy-a-gate.sh` — runs the three A goldens (server,
  transport, UI display) + the InputSet contract via the OFFICIAL `make test-api`
  / `make test-ui` targets (Make-only / Docker-first, no host `npx`);
  **exit ≠ 0** if any golden diverges. See the command header in the script.

---

## 5. Scope and limits of this inventory

- **Data-projection layer (Postgres):** the addendum requires a per-layer receipt
  (Graphify / projection / UI). This inventory covers the server authority
  (deriving counters/membership from `graph_nodes`) and the UI. The graph→Postgres
  projection (`upsertGraphAtomic`, `project-graph-from-s3.ts`) is NOT re-covered
  here: it belongs to the materializer/cutover lots (out of foundation scope) and
  must produce its own receipt.
- **SQL order:** as stated in §1.2, `getSignalNodesForCity` has no `ORDER BY`; this
  foundation lot does not add one and does not assert a DB row order. The goldens
  pin only deterministic, in-memory order properties (input-preserving projection
  server-side, authority-driven order client-side).
- This inventory freezes **no** `r`/`vivier-v2` behaviour: those are post-A axes,
  deliberately excluded from the legacy invariant so the A gate stays insensitive
  to B′/B evolution.
- No real production data is embedded: the golden corpora are deterministic and
  synthetic, chosen to exercise each predicate and each fail-closed branch.
