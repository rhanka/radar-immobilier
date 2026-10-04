# SPEC — Graph city key `(city_slug, id)` and per-city repair from S3 (#812)

- **Status**: EVOL — committed design, ready to plan. No implementation in this document.
- **Date**: 2026-10-04.
- **Origin**: owner decision D2 of 2026-10-04, **option C**: primary key `(city_slug, id)` for
  graph nodes, edges attached to the city, repair of every city from its own S3
  `graph/<city>/latest.json` (S3 is the source of truth). Decision dossier:
  `docs/spec/reports/dossier-villes-ecart/DOSSIER_DECISION_VILLES_ECART_2026-10-04.md`
  (PR #815) §2, §4, §6, D2, D3.
- **Card**: #812. **Plan**: `plan/812-BRANCH_fix-graph-city-key.md`.
- **Method**: `harness brainstorm` (EVOL rung; STUDY and VOL were done by the dossier), multi-peer
  adversarial review (§13), then `harness plan --lots`.
- **Conventions**: FACT = verified in code or in a cited proof file · JUDGEMENT = design choice ·
  `unverified`, `source-gap`, `N-A` = declared limits. Code references are against
  `origin/main` `128bde8b`.

---

## 1. Problem (summary)

FACT. `graph_nodes` has a single primary key `id` (`api/drizzle/0002_graph_store.sql`,
`api/src/db/schema.ts:287`). Node ids are unique **inside one city only** (`bylaw-242` exists in
gore and barkmere; `bylaw-2026-04` in 9 cities). The projection writes nodes with
`INSERT … ON CONFLICT (id) DO UPDATE SET label, type, props, source_ref`
(`api/src/services/graph/graph-store.ts:1103-1111`): the second city overwrites the content of the
first city's row and never changes `city_slug`. `graph_edges` has no city at all: natural key
`(src_id, dst_id, kind)` (unique index `graph_edges_natural_key_idx`).

Measured effects (dossier §2.0, §4.3, read-only diagnostic of 2026-10-04):

| | prod (`radar-immobilier`) | preprod (`radar-immobilier-preprod`) |
|---|---|---|
| nodes carrying evidence from another city's PV (`foreignPg`) | 164 nodes / 109 cities | 121 nodes / 88 cities |
| cities blocked or incomplete through collision (G2+G3+G4) | 148 | 131 |
| S3 `latest.json` with foreign evidence | 0 | 0 |
| nodes with `city_slug IS NULL` | `unverified` | 0 |

A separate PR adds a one-line stop-gap (`… DO UPDATE … WHERE graph_nodes.city_slug =
excluded.city_slug`): no new contamination, but colliding cities silently do not receive the node.
This spec is the definitive fix; it deletes that stop-gap (No Legacy Fallback).

## 2. Goals and non-goals

Goals:

1. Each city owns its id space in PG, exactly as in S3: node key `(city_slug, id)`, edge key
   `(city_slug, src_id, dst_id, kind)`.
2. Every read that resolves a node or an edge by id also binds the city.
3. Remove every foreign evidence from PG and re-align the colliding cities on their own
   `latest.json`, through a reviewed, idempotent, archived CD job, preprod first then prod.
4. Re-run the document-date recovery (without `--heal`) on the repaired cities.
5. Prove it with the same read-only measurement as the dossier: repaired groups at 0,
   `foreignPg = 0`, S3 still clean.

Non-goals (explicitly out of this spec):

- D1 (G1, 71 cities of empty legacy nodes), D4/D5 (`--heal` on G5a/G5b), D6 (producer bug of G5c),
  D7 (brigham). They are independent of the key change (dossier §3.2) and run under their own
  decisions. The repair job below may be used for G1 cities, but that is D1's call.
- The fate of the legacy exploitation flow (`runExploitation` → `upsertGraph`, dossier §2.5). This
  spec only changes its conflict target so that it keeps compiling and stays city-scoped.
- Renaming or prefixing ids (options A and B of D2, rejected by the owner).
- Any change to S3 `graph/<city>/latest.json` content. The repair never writes `latest.json`.

## 3. Design decisions (K1–K12)

Numbered `K` to avoid confusion with the dossier's D1–D7.

| # | Decision | Rationale |
|---|---|---|
| K1 | `graph_nodes` primary key becomes `(city_slug, id)`; `city_slug` becomes `NOT NULL`. | Matches S3 (one file per city). A PK column cannot be NULL. |
| K2 | NULL-city rows are **not** given a sentinel. The migration starts with a precheck that **raises** if any `graph_nodes.city_slug IS NULL` row exists; the release then aborts before `set-image` (backup already taken). Lot 0 measures the prod count read-only before the release. | Preprod measured 0. A sentinel (`__global__`) would recreate a shared id space. Fail-closed, decided on evidence. |
| K3 | `graph_edges` gets `city_slug text NOT NULL`; unique natural key `(city_slug, src_id, dst_id, kind)` replaces `graph_edges_natural_key_idx`; `graph_edges_src_idx` / `graph_edges_dst_idx` become `(city_slug, src_id)` / `(city_slug, dst_id)`. No foreign key to `graph_nodes` (unchanged soft reference, keeps the projection's upsert order free). | An edge belongs to the graph of one city (one `latest.json`). |
| K4 | Edge backfill in the migration: `city_slug` = city of the `src_id` node, else of the `dst_id` node (both lookups unique while the old PK still holds, i.e. **before** the PK swap inside the same migration). Edges with neither endpoint present are copied to `graph_edges_dangling_0013` then deleted. | Dangling edges are never served (every edge read requires the src node in the city set). Archive keeps them restorable. |
| K5 | **One migration**, `api/drizzle/0013_graph_city_key.sql`, hand-authored (like 0002/0003), in one transaction; `schema.ts` aligned. The constraint name of the current PK is resolved from `pg_constraint` (prod has a schema drift on `graph_nodes`, e.g. no `created_at`), never hard-coded. | Branch template: one migration max. Drift-safe. |
| K6 | Release ordering: the CD path already runs backup → migrate → set-image → assert (`.github/workflows/build-push-images.yml:719-770`). Between migrate and set-image, any old pod issuing `ON CONFLICT (id)` fails with a SQL error **inside its transaction**: fail-closed, nothing is written, the refresh marks the city `postgres-write-failed` and retries on the next pass. The release is still scheduled outside refresh windows (05:17, 11:17, 17:17, 23:17 UTC, 1 h 30–2 h each) and outside the 02:23 UTC backup. No expand/contract second migration. | Simpler than two releases; the transient failure mode loses no data. Reviewed in §13. |
| K7 | All writes use the city in the conflict target: nodes `ON CONFLICT (city_slug, id)`, edges `ON CONFLICT (city_slug, src_id, dst_id, kind)`, in `upsertGraphAtomic` **and** the legacy `upsertGraph`. `citySlug: null` is removed from both signatures (the "cross-city upsert" branch at `graph-store.ts:1008-1018` is deleted). The one-line stop-gap `WHERE graph_nodes.city_slug = excluded.city_slug` is deleted. | No Legacy Fallback; a NULL city can no longer be stored (K1). |
| K8 | Deletions in `upsertGraphAtomic` are city-scoped on **both** tables: dangling-edge purge adds `graph_edges.city_slug = $city` (today `graph-store.ts:1147-1156` deletes other cities' edges sharing an orphan id — a second cross-city defect, FACT). | Same root cause, same fix. |
| K9 | Every read by id binds the city (inventory §5): neighbour/edge reads, geo joins, MRC aggregation. API **paths do not change** (all node-bearing routes are already `/:city`-scoped); multi-city responses (`/api/graph/mrc/:mrc`) add `citySlug` on every edge and the UI keys nodes and edges by `${citySlug}\u0000${id}`. | Ids visible to users and MCP stay identical (the main benefit of C). |
| K10 | The repair is a **new script** `api/src/scripts/repair-graph-city-key.ts`, run by a **new** `run-job.yaml` job `graph-city-key-repair` (inputs `repair_mode` preview\|apply, `repair_cities`), with two passes per city: pass 1 **decontamination** of proven-foreign nodes, pass 2 **standard projection** with the unchanged three guards (§7). | Foreign rows are what makes the guards refuse G2/G4 today; removing exactly those, and nothing else, lets the unchanged guards do the rest. |
| K11 | "Foreign" is defined on content provenance, not on slug strings: a PG ref `docSha` of a node `(C, id)` is **foreign** when it is absent from every node of `graph/C/latest.json` **and** present on node `id` of `graph/D/latest.json` for some `D ≠ C`. The `proces-verbaux-<slug>/` path test of the dossier is reported as a secondary signal only. | Slug/source naming differs from `city_slug` in places (dossier §4.3, lascension). The cross-file proof does not depend on naming. |
| K12 | `run-job.yaml` gains a `target_env` input (`preprod` \| `prod`, default `prod`) that selects namespace and the matching manifest twin, for `projection`, `document-date-recovery` and `graph-city-key-repair`, as required by dossier §6.2 (a). Whether preprod uses the same kubeconfig secret is `unverified` (Lot 0). | Same jobs, same parameters, preprod first. |

## 4. Schema migration — `api/drizzle/0013_graph_city_key.sql`

Single transaction, in this order (pseudo-SQL; the implementation keeps drizzle's
`--> statement-breakpoint` markers and the journal entry in `api/drizzle/meta/_journal.json`):

1. **Precheck NULL cities** (K2): `DO $$ … IF EXISTS (SELECT 1 FROM graph_nodes WHERE city_slug IS
   NULL) THEN RAISE EXCEPTION 'graph_nodes has % rows with NULL city_slug; migration 0013 refused'`.
2. **Edges: add and backfill city** (K4), while `graph_nodes.id` is still unique:
   `ALTER TABLE graph_edges ADD COLUMN city_slug text;`
   `UPDATE graph_edges e SET city_slug = n.city_slug FROM graph_nodes n WHERE n.id = e.src_id;`
   then the same from `dst_id` for rows still NULL.
3. **Dangling edges**: `CREATE TABLE graph_edges_dangling_0013 AS SELECT * FROM graph_edges WHERE
   city_slug IS NULL; DELETE FROM graph_edges WHERE city_slug IS NULL;`
   `ALTER TABLE graph_edges ALTER COLUMN city_slug SET NOT NULL;`
4. **Edge keys**: drop `graph_edges_natural_key_idx`, `graph_edges_src_idx`, `graph_edges_dst_idx`;
   create unique `graph_edges_city_natural_key_idx (city_slug, src_id, dst_id, kind)`,
   `graph_edges_city_src_idx (city_slug, src_id)`, `graph_edges_city_dst_idx (city_slug, dst_id)`.
   The backfill cannot create duplicates: the old triple was unique, the city is a function of it.
5. **Node key**: `ALTER TABLE graph_nodes ALTER COLUMN city_slug SET NOT NULL;` drop the current
   primary key by its name read from `pg_constraint` (`contype = 'p'`, `conrelid =
   'graph_nodes'::regclass`) through a `DO` block; `ALTER TABLE graph_nodes ADD CONSTRAINT
   graph_nodes_pkey PRIMARY KEY (city_slug, id);`. Existing ids are unique, so the new key holds.
   `graph_nodes_city_idx` becomes redundant with the PK prefix and is dropped;
   `graph_nodes_city_type_idx`, GIN, trigram and `label_tsv` indexes are kept.
6. **Postcheck**: assert row counts of `graph_nodes` unchanged and
   `count(graph_edges) + count(graph_edges_dangling_0013)` equal to the pre-migration edge count
   (captured in step 2 into a temp table); raise on mismatch.

`schema.ts`: `graphNodes` uses `primaryKey({ columns: [t.citySlug, t.id] })`, `citySlug` `notNull()`;
`graphEdges` gets `citySlug: text("city_slug").notNull()` and the three new indexes; comments that
say "null = cross-city / global" are removed.

Lock and duration: `ALTER TABLE … ADD PRIMARY KEY` and the edge `UPDATE` take an
`ACCESS EXCLUSIVE` / row locks on two tables of tens of thousands of rows (exact size `unverified`,
measured in Lot 0); expected seconds, inside the CD migrate poll of 600 s.

Other tables (FACT, checked in `schema.ts` and `api/drizzle/*.sql`):

| Table | Holds a graph node id? | Change |
|---|---|---|
| `geo_resolutions` | `node_id` + `city_slug` (natural key `(node_id, relation_type, target_id)`, `0007_geo_mapper.sql:93`) | none in schema: zone `target_id` is `zone-{city}-{code}` (`populate-geo.ts:249`), lot numbers are province-wide; readers must join on `(city_slug, node_id)` (§5). Whether the key needs the city is checked by an integration test (§10). |
| `geo_unresolved` | `node_id` + `city_slug` | none |
| `prospect_marks` | no (lot anchor `lot_version_id`, `no_lot`, `city_slug`) | none |
| `prospect_notes` (annotations) | no (`signal_id` → `signals.id` uuid, lot anchor) | none |
| `opportunities`, `opportunity_dossiers`, `constraint_hits` | no (uuid `signals`, zone/lot canonical ids) | none |
| `consistency_snapshots` | no (per city payload) | none |
| `refresh_document_outcomes` | no (per document) | none |
| evidence / refs | inside `graph_nodes.props.refs` (jsonb) | moves with the node row |
| SQL views / materialized views on graph tables | none found in `api/drizzle/*.sql` | none |

## 5. Inventory — every access to the graph tables

Legend: **ID** = keyed by id alone (must change) · **C+ID** = already binds the city · **C** =
city-only filter (no change needed beyond the key). Line numbers on `128bde8b`.

### 5.1 Writes

| Location | What | Today | Change |
|---|---|---|---|
| `api/src/services/graph/graph-store.ts:861-871` | `upsertGraph` node upsert `onConflictDoUpdate({ target: graphNodes.id })` | ID | target `[citySlug, id]`; drop `citySlug: null` |
| `graph-store.ts:911-913` | `upsertGraph` edge upsert target `(src_id, dst_id, kind)` | ID | add `citySlug` to rows (`buildEdgeRow(link, citySlug)`, `graph-store.ts:214`) and target |
| `graph-store.ts:1008-1018` | `upsertGraphAtomic` `citySlug === null` branch | — | delete (K7) |
| `graph-store.ts:1103-1111` | `upsertGraphAtomic` node upsert target `graphNodes.id` | ID | target `[citySlug, id]`; delete stop-gap `WHERE` |
| `graph-store.ts:1126-1129` | `upsertGraphAtomic` edge upsert | ID | as `upsertGraph` |
| `graph-store.ts:1147-1156` | dangling-edge delete `inArray(srcId/dstId, orphanIds)` | ID (deletes other cities' edges) | add `eq(graphEdges.citySlug, citySlug)` (K8) |
| `graph-store.ts:1134-1137`, `1158-1163` | orphan node select/delete | C+ID | none |
| `graph-store.ts:466`, `488` | `mergeNodeRows` / `mergeEdgeRows` merge by `id` / triple inside one city | in-memory, one city | none (single-city input) |
| `api/src/services/sources/exploitation.ts:173` | legacy `upsertGraph(db, citySlug, …)` | via `upsertGraph` | follows `upsertGraph`; fate of the flow is outside this spec |
| `api/src/scripts/collect-exploit-source.ts:74-84` | legacy flow via `runExploitation` | via `upsertGraph` | none beyond `upsertGraph` |
| callers of `upsertGraphAtomic`: `graph/refresh-run.ts:314`, `scripts/project-graph-from-s3.ts:124`, `scripts/recover-document-dates.ts:163`, `scripts/graphify-34-enrich.ts:92`, `scripts/filet-auto-link-pv.ts:306`, `scripts/purge-avis-bylaws.ts:407` | city-scoped projection | C | type change only (`citySlug: string`) |

### 5.2 Reads in the API and services

| Location | What | Today | Change |
|---|---|---|---|
| `graph-store.ts:1231-1259` `queryNeighbors(db, nodeId)` | edges by `src_id`/`dst_id`, nodes `inArray(id)` | **ID** | signature `(db, citySlug, nodeId)`, bind city on both tables. No production caller (tests only) |
| `graph-store.ts:1292-1333` `subgraphForCity` | nodes by city; edges `or(eq(srcId, id)…)` then filter dst | nodes C, edges **ID** (can return another city's edge whose ids both exist in the city) | edges `where city_slug = $city` (drop the giant `OR`) |
| `graph-store.ts:1360-1395` `subgraphForMrc` | nodes `inArray(citySlug)`; edges `inArray(srcId, ids)`; `nodeIds` set by id | **ID** (ids of two cities of the MRC collapse) | edges `inArray(citySlug, citySlugs)`; endpoint check on `(city, id)`; response edges carry `citySlug` (K9) |
| `graph-store.ts:1416-1455` `listMrcs` | counts by city | C | none |
| `graph-store.ts:2071-2119` `listCitiesWithSignalNodes`, `getSignalNodesForCity` | signal nodes by city | C | none |
| `api/src/services/data-quality/summary.ts:119-138` `loadDbSnapshot` | nodes by city, edges `inArray(srcId, nodeIds)` | edges **ID** | edges by `city_slug` |
| `api/src/services/geo/geo-features.ts:156-181` | `geo_resolutions` by city, then `graphNodes` `inArray(id, nodeIds)` | **ID** | add `eq(graphNodes.citySlug, citySlug)` |
| `geo-features.ts:350-375` `getOpportuniteFeatures` | signal nodes by city | C | none |
| `api/src/services/geo/run-geo-mapper.ts:90-92`, `measure-geo-mapping.ts:230-232`, `populate-geo.ts:395-399` | raw SQL on `graph_nodes` `WHERE city_slug = …` | C | none |
| `api/src/services/geo/resolve-refs.ts:103-112` | insert `geo_resolutions` `ON CONFLICT (node_id, relation_type, target_id)` | key without city | verified by test (§4 table); change only if the test shows a cross-city collision |
| `api/src/services/consistency/load-consistency-raw.ts:53-81`, `api/src/routes/source-coverage.ts:702-760` | aggregates `GROUP BY city_slug` | C | none |
| `api/src/services/graph/graphify-34-snapshot.ts:102-159` | snapshot from `subgraphForCity` | C | none (benefits from the edge fix) |

### 5.3 HTTP routes

| Route | File | Node id in request? | Change |
|---|---|---|---|
| `GET /api/graph/mrcs` | `api/src/routes/graph.ts:35` | no | none |
| `GET /api/graph/mrc/:mrc` | `graph.ts:52` | no; response holds nodes of several cities | edges and nodes carry `citySlug`; contract test |
| `GET /api/graph/:city` | `graph.ts:83` | no (city) | none (edge fix in `subgraphForCity`) |
| `GET /api/graph-signals/by-city` | `api/src/routes/graph-signals.ts:888` | no | none |
| `GET /api/graph-signals/:city` | `graph-signals.ts:911` | no (city); nodes returned with `id` + `citySlug` (`graph-signals.ts:419-460`) | none |
| `/api/documents/raw?rawRef=` | (raw route) | no (rawRef) | none |
| `POST` legacy exploitation in `api/src/routes/sources.ts:132` | — | no | follows `upsertGraph` |

No route takes a graph node id alone. FACT (grep of `api/src/routes/**` on `:id`, `nodeId`).

### 5.4 UI

| Location | Today | Change |
|---|---|---|
| `ui/src/lib/signals/signals-live.ts:62` | T1 signal id is `gn-${citySlug}-${index}` | none (already city-qualified) |
| `ui/src/lib/components/maps/EvaluationMapView.svelte:170-175` | parses `gn-<city>-<n>` | none |
| `ui/src/lib/components/signals/SignalsT1View.svelte:230`, `SignalPdfOverlay.svelte:1142-1175`, `App.svelte:71-78` | keyed by the `gn-…` id | none |
| `ui/src/lib/components/reconciliation/MrcGraphView.svelte:169`, `353-355`, `386` | `nodeById` and `{#each}` keyed by `node.id`, edges resolved by `srcId`/`dstId` | **ID** across cities: key `${citySlug}\u0000${id}`; resolve edge endpoints with `edge.citySlug` |
| `ui/src/lib/components/reconciliation/CityGraphView.svelte:149`, `275`, `309` | single city | none (server already restricts to the city) |
| `ui/src/lib/graph/graph-client.ts:20-75` | `GraphEdge` type | add `citySlug` to the edge type of the MRC response |

### 5.5 MCP (`packages/immo-mcp`)

FACT. Tools `search_lots`, `get_lot_card`, `search_signals`, `get_opportunity_dossier`,
`list_documents`, `read_document_excerpt` (`packages/immo-mcp/src/tools.ts:117-200`). The only one
wired to graph data is `search_signals`, through `GET /api/graph-signals/:city`
(`packages/immo-mcp/src/data-source.ts:285-330`): it is city-scoped and no tool takes a node id as
input. Change: none in code; the `search_signals` output already carries the city; a contract test
asserts that each returned signal carries `citySlug` so an MCP client can address `(city, id)`.
No external consumer addresses a node by id alone (`unverified` for shared links outside the repo:
no route accepts one, so such a link cannot exist).

### 5.6 Scripts, jobs, manifests

| Location | Today | Change |
|---|---|---|
| `api/src/scripts/report-opportunity-proof.ts:102-110` | raw SQL: `geo_resolutions WHERE node_id = n.id`, `graph_edges e JOIN graph_nodes x ON x.id = …` | **ID**: add `AND city_slug = n.city_slug` on `geo_resolutions`, `e.city_slug = n.city_slug` and `x.city_slug = n.city_slug` |
| `api/src/scripts/recover-document-dates.ts:119-138` | compares `latest.json` ids with `subgraphForCity` ids | C | none (stays valid, K9 benefit) |
| `api/src/scripts/project-graph-from-s3.ts:124` | `upsertGraphAtomic` per city | C | none |
| `api/src/scripts/purge-avis-bylaws.ts:287`, `emit-graphify34-candidates.ts:130`, `graphify-34-enrich.ts:67` | `subgraphForCity` | C | none |
| `api/src/scripts/prove-refresh-signals.ts`, `reconcile-167-slugs.ts` | read-only / slug mapping | C | none |
| `deploy/k8s/39-export-graph-nodes-job.yaml:80-115` | read-only export by city | C | none |
| `scripts/cohorte-vivier-b/reproduce-cohort.ts` | offline dump reader | — | none |
| `deploy/k8s/36-db-migrate-job.yaml` | runs `dist/db/migrate.js` | — | runs 0013 |
| `docs/spec/reports/dossier-villes-ecart/preuves/diagnostic/mesure-lecture-seule.mjs` (PR #815) | `pgCityById` = `id → city` map (assumes unique ids) | **ID** | versioned v2, §9 |

### 5.7 Tests that assert the old key

`api/src/services/graph/graph-store.test.ts` (mocks of `onConflictDoUpdate` target, `queryNeighbors`
at 1342-1414 and 1650), `api/src/routes/graph.test.ts`, `api/tests/integration/refresh-018.spec.ts`
(`upsertGraphAtomic` at 309), `api/tests/integration/graph-signals-date-parity.spec.ts`,
`graph-signals.sainte-martine-508.test.ts`, `graphify-34-enrichment.integration.test.ts`,
`geo/regulatory-status-zone.integration.test.ts`, `sources/live-scrape.test.ts`,
`scripts/worker-live-reexploit.test.ts`, `ui/src/lib/components/reconciliation/CityGraphView.test.ts`.
They are updated in the lot that changes the code they cover.

## 6. Code changes (behaviour)

1. `graph-store.ts`: K7, K8, K9 as listed in §5.1–5.2; `buildEdgeRow(link, citySlug)`;
   `UpsertAtomicResult.reason` no longer has the cross-city case.
2. Guards (`findMissingBusinessProperties`, `findMissingSourceRefs`, `countCompleteSignals`,
   `graph-store.ts:571-830`): **unchanged**. They already read the city's rows only; after the key
   change those rows can no longer hold another city's content.
3. New pure helpers in `graph-store.ts` used by the repair (§7): `indexS3DocShas` (per city, per id,
   the set of docShas) and `classifyForeignNodes(cityRows, cityS3Graph, s3Index)`.
4. New `decontaminateCityNodes(db, citySlug, cityS3Graph, foreign)`: one transaction, for each
   proven-foreign node either replaces its row with the city's own S3 node (when the id is in
   `graph/<city>/latest.json`) or deletes it (when it is not), edges untouched; refuses the city
   (no write) if any affected node is `mixed` (§7.2).

## 7. Repair — `api/src/scripts/repair-graph-city-key.ts`

### 7.1 Contract

- **Inputs**: `--apply` (absent ⇒ preview, read-only), city slugs (absent ⇒ refused: an explicit
  list is required, produced by the measurement of §9), `--run-id <token>` (default
  `graph-city-key-repair-<UTC>`).
- **Preconditions (refuse to start, exit 2)**: migration 0013 applied (PK of `graph_nodes` is
  `(city_slug, id)`, read from `pg_constraint`); a session advisory lock
  `pg_try_advisory_lock(hashtext('graph-city-key-repair'))` obtained; in apply mode, no active
  refresh, backup or recovery Job (the `run-job.yaml` pre-check already used for
  `document-date-recovery`, extended to this job and to `projection`).
- **Reads**: every `graph/<city>/latest.json` once, to build the docSha index (ids + docShas only,
  the memory profile of `mesure-lecture-seule.mjs`); PG rows of the target city.
- **Writes (apply only)**: S3 archive object
  `graph-city-key-repair/<run-id>/<city>/pg-rows.json` (nodes and edges of the city before any write,
  plus sha256), written and read back **before** pass 1; PG through pass 1 and pass 2. Never writes
  `graph/<city>/latest.json`.
- **Output**: one JSON line per city and a final report (same shape as `recover-document-dates`):
  `{ city, foreign, mixed, pass1: { replaced, deleted } | refused, pass2: { nodeCount, edgeCount,
  deletedNodes, deletedEdges } | refused(reason), archiveKey }`. Exit 1 when any city is refused or
  errored, 0 otherwise. Per-city independence: a refused city never stops the others.

### 7.2 Per-city algorithm

1. Load `graph/C/latest.json` (S3) and PG rows of C.
2. Classify each PG node of C (K11): `clean` (no foreign docSha), `foreign` (≥1 foreign docSha and
   every docSha of the row is foreign), `mixed` (foreign and non-foreign docShas together — only the
   legacy additive `upsertGraph` merge can produce this).
3. **Pass 1 — decontamination** (only if `foreign` ≥ 1): `decontaminateCityNodes`. Guard: zero
   `mixed` nodes, otherwise the city is refused for pass 1 and listed for manual review. Business
   properties of a `foreign` row are entirely foreign (REPLACE semantics,
   `graph-store.ts:1105-1110`), so replacing them is not a loss.
4. **Pass 2 — projection**: `upsertGraphAtomic(db, C, latest.json)` unchanged, with its three
   guards. Expected: pass for G2, G3, G4; refused for cities with a local loss (G5c, G6: these stay
   under D6/D7). A pass-2 refusal leaves pass 1 committed: the city is decontaminated but not
   re-aligned, which is the intended partial result.
5. Idempotence: a second run on the same city finds 0 foreign nodes (pass 1 skipped) and pass 2
   upserts identical content (0 deletions).

### 7.3 Preview

Preview performs steps 1–2 and simulates passes 1 and 2 in memory with the same pure guard functions
(`findMissingBusinessProperties`, `findMissingSourceRefs`, `countCompleteSignals`), against the
post-pass-1 state. Its report must reproduce the dossier simulation (`sim.json`) for the same cities
(acceptance of Lot 3, §10).

### 7.4 CD job

- Manifests: `deploy/k8s/42-graph-city-key-repair-job.yaml` (prod) and its preprod twin
  `deploy/k8s/graph-city-key-repair/job.yaml`, modelled on `41-document-date-recovery-job.yaml`
  (label `component: graph-projection` for the network policy, `backoffLimit: 0`,
  `activeDeadlineSeconds` sized in Lot 0, SCRAPE S3 binding checked by
  `deploy/ci/check-object-storage-bindings.sh`). Not in `kustomization.yaml`.
- `run-job.yaml`: new option `graph-city-key-repair`, inputs `repair_mode` (preview|apply),
  `repair_cities`, `target_env` (K12); same busy pre-check and log collection as
  `document-date-recovery`.

### 7.5 Run order (each step outside refresh windows and 02:23 UTC, one job at a time)

| Step | preprod (`radar-immobilier-preprod`) | prod (`radar-immobilier`) | Gate to continue |
|---|---|---|---|
| R0 | measurement v2, read-only: baseline JSON | same | baseline archived in the PR/issue |
| R1 | release with 0013 (CD to preprod) | tag `vX.Y.Z` | served image = merged commit / tag; migrate Job Complete |
| R2 | measurement v2 right after migration | same | counts unchanged vs R0 except `idsSharedAcrossCitiesInS3` semantics (§9) |
| R3 | `graph-city-key-repair` preview on the G2+G3+G4 list (131) and G5c | same on 148 + G5c | preview verdicts match the dossier simulation |
| R4 | `graph-city-key-repair` apply on the same list | same | report: pass 2 refused only for listed G5c/G6 cities |
| R5 | `document-date-recovery`, `recovery_mode=apply`, `recovery_heal=false`, `recovery_cities` = cities whose pass 2 succeeded | same | 0 HALT, 0 abort on that list |
| R6 | measurement v2: acceptance (§9) | same | all criteria of §9 |

Prod starts only after R6 passes in preprod.

## 8. Date-recovery re-run

`recover-document-dates.ts` needs no change: it compares `latest.json` ids with
`subgraphForCity(db, city)` ids (C) and projects through `upsertGraphAtomic`. After R4, the id sets
of repaired cities are equal, so R5 writes dates (archive of `latest.json` first, as today) and
re-projects. `--heal` stays forbidden on these cities (dossier §6.1 point 3).

## 9. Acceptance measurement (same read-only script)

The dossier's `mesure-lecture-seule.mjs` (PR #815) is versioned as
`api/src/scripts/measure-graph-drift.mjs` (run in the `radar-api` pod by stdin, as in the dossier;
Node only). Changes, and only these:

- `pgCityById` (`id → city`) is replaced by a set keyed `city\u0000id`; the "owned by another city"
  exclusion in the completeness count (`ca`) is removed, because ownership is now per city.
- Output adds `pgPrimaryKey` (columns of the PK read from `pg_constraint`) and `mixed` counts.
- Equivalence: run v1 and v2 read-only on preprod **before** migration; the JSON outputs must be
  equal except `measuredAt` (Lot 1 gate).

Acceptance after R6, per environment:

| Measure | Target |
|---|---|
| `foreignPg.nodes` | **0** |
| `foreignS3.nodes` | 0 (unchanged) |
| groups `G2G4-collision-refused`, `G3-S3-collision-only` | **0** |
| groups `G5c`, `G6`, `G5ab`, `G1` | only the cities listed under D1/D4–D7, unchanged or reduced |
| `pgNullCity` | 0 |
| `pgPrimaryKey` | `[city_slug, id]` |
| refresh pass following R6 | 0 `postgres-regression-refused` for repaired cities (refresh state receipts) |

## 10. Tests

Following `rules/testing.md` (`make test ENV=test-<slug>`, never `ENV=dev`).

Unit (`api/src/services/graph/graph-store.test.ts`, new `repair-graph-city-key.test.ts`):

- two cities with the same id → two rows, each with its own props and refs;
- edges with the same triple in two cities → two rows;
- dangling-edge purge in city A leaves city B's edges on the shared id;
- `subgraphForCity` never returns an edge of another city; `subgraphForMrc` keeps both
  `(A, x)` and `(B, x)`;
- `classifyForeignNodes`: clean / foreign / mixed, including a slug that differs from the rawRef
  path (K11);
- `decontaminateCityNodes`: replace, delete, refuse on mixed; idempotence;
- repair preview equals the in-memory simulation of the dossier for fixtures built from
  `sim.json` cases gore / barkmere (`bylaw-242`, `bylaw-134`).

Integration (Postgres test stack, `api/tests/integration/`):

- migration 0013 on a database seeded at 0012 with: shared ids, shared edge triples, dangling
  edges, a renamed PK constraint (drift), and a NULL-city row (migration must raise);
- the gore / barkmere scenario end to end: contaminate with the pre-0013 code path (seeded rows),
  migrate, repair apply, then a second repair (no-op), then `recover-document-dates --apply`
  (no HALT);
- `geo_resolutions` with the same `node_id` in two cities and the same `target_id` lot: documents
  whether its natural key needs the city (decides the open item of §4);
- `refresh-018.spec.ts`, `graph-signals-date-parity.spec.ts` green with the new key.

E2E (`make test-e2e ENV=e2e-<slug>`): MRC graph view renders two cities that share an id
(two nodes, correct edges, no duplicate-key error); Signals T1 and PDF overlay unchanged on a city
whose node was contaminated (fixture).

CI and manifests: `make k8s-validate ENV=ci` for the new job manifests; object-storage binding check.

## 11. Rollback

| Layer | Mechanism |
|---|---|
| Release | `rollback.yml` to the previous image **plus** the down-migration below (the old image issues `ON CONFLICT (id)`, which needs a unique `id`). |
| Schema (before any repair) | `api/drizzle/rollback/0013_graph_city_key.down.sql` (not in the drizzle journal, run by a reviewed one-shot Job): restore PK `(id)`, drop edge `city_slug` and indexes, recreate `graph_edges_natural_key_idx`, re-insert `graph_edges_dangling_0013`. Valid only while ids are still unique across cities. |
| Schema (after repair) | ids are no longer unique across cities, so the down-migration refuses (precheck). Rollback = restore the pre-migration PG backup taken by the CD (backup → migrate), then re-run R1 later. The backup's presence and restorability are checked before R1 (`unverified` today, dossier §6.2 f). |
| Repair data | per-city S3 archive `graph-city-key-repair/<run-id>/<city>/pg-rows.json`; a restore script is **not** built (JUDGEMENT): the S3 `latest.json` stays authoritative and a city can be re-projected at any time; the archive serves forensics and targeted manual restore. |
| S3 | never written by the repair; R5 archives `latest.json` as today. |

## 12. Risks

| Risk | Mitigation |
|---|---|
| NULL-city rows in prod | K2 precheck; Lot 0 read-only count; owner decision if > 0 (Q1). |
| Old pods during release | K6 fail-closed; release outside windows. |
| Misclassification of foreign content | K11 cross-file proof; `mixed` refused; preview compared with `sim.json`; preprod rehearsal. |
| Run-job targets prod only today | K12; preprod verified first (Lot 0). |
| Unknown consumer of ids alone | inventory §5: none in routes, UI, MCP. |
| Refresh pass writing during repair | advisory lock + busy pre-check + windows. |

## 13. Adversarial review log

Reviewed by two independent peers with distinct lenses before planning (seats only, no API key):
peer 1 — data correctness and migration safety; peer 2 — operations, repair, rollback and inventory
completeness. Findings and their reconciliation are recorded in §13.1; open items needing the owner
are in §14.

### 13.1 Findings and reconciliation

_Filled after review (see PR thread)._

## 14. Open questions for the owner

| # | Question | Context and stakes | Default if not answered |
|---|---|---|---|
| Q1 | If prod has `city_slug IS NULL` rows, delete them, or attach them to a city? | The migration refuses while any exist (K2). Preprod: 0. Prod: `unverified`, measured in Lot 0. | Release blocked until decided. |
| Q2 | Accept the transient fail-closed window of K6 (an in-flight old-image projection fails and retries next pass), or require an expand/contract in two releases? | Two releases double the CD cycle; the single release loses no data. | K6 (single release). |
| Q3 | Repair scope: G2+G3+G4 (+G5c for pass 1 only), or also G1 cities in the same job (instead of the `projection` job of D1)? | D1 is a separate owner decision; the repair job would also handle G1 (pass 2 removes empty nodes). | G1 stays under D1 with the `projection` job. |
| Q4 | Keep the per-city S3 archive of PG rows without a restore script? | A restore script costs a lot; S3 `latest.json` is authoritative. | Archive only. |
