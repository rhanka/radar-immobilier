# SPEC — Graph city key `(city_slug, id)` and per-city repair from S3 (#812)

- **Status**: EVOL — committed design, ready to plan, **simplified after the owner decisions of
  2026-10-04 (§3)**. No implementation in this document.
- **Date**: 2026-10-04.
- **Origin**: owner decision D2 of 2026-10-04, **option C**: primary key `(city_slug, id)` for
  graph nodes, edges attached to the city, repair of every city from its own S3
  `graph/<city>/latest.json` (S3 is the source of truth). Decision dossier:
  `docs/spec/reports/dossier-villes-ecart/DOSSIER_DECISION_VILLES_ECART_2026-10-04.md`
  (PR #815) §2, §4, §6, D2, D3.
- **Card**: #812. **Plan**: `plan/812-BRANCH_fix-graph-city-key.md`.
- **Method**: `harness brainstorm` (EVOL rung; STUDY and VOL were done by the dossier), multi-peer
  adversarial review (§14), then `harness plan --lots`.
- **Guiding rule (owner)**: keep it simple — one PR, one migration, no new rollback tooling, no
  archive.
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
   `latest.json`, through a reviewed, idempotent CD job, preprod first then prod.
4. Re-run the document-date recovery (without `--heal`) on the repaired cities.
5. Prove it with a read-only measurement carrying the dossier's rules: repaired groups at 0, no
   foreign evidence, S3 still clean.

Non-goals:

- D1 (G1, empty legacy nodes): stays under D1 with the existing `projection` job (owner Q3).
- D4/D5 (`--heal` on G5a/G5b), D6 (producer bug of G5c), D7 (brigham): independent of the key
  change (dossier §3.2), run under their own decisions.
- The fate of the legacy exploitation flow (`runExploitation` → `upsertGraph`, dossier §2.5). This
  spec only changes its conflict target and its lock so that it stays city-scoped.
- Renaming or prefixing ids (options A and B of D2, rejected by the owner).
- Any change to S3 `graph/<city>/latest.json` content. The repair never writes `latest.json`.
- Any new rollback tooling, archive or restore script (owner Q4, Q5).

## 3. Owner decisions (2026-10-04)

Recorded as given; they supersede the open questions of the previous revision.

| # | Question | Owner decision | Effect on this spec |
|---|---|---|---|
| Q1 | Nodes with `city_slug IS NULL` in prod | **Deleted** before the key change, not attached to a city. | Migration 0013 deletes them as its first step (K2). No pre-migration measurement is needed. |
| Q2 | Suspend the refresh and freeze graph-touching merges during the preprod run | **Yes.** | `refresh-suspend` / `refresh-resume` run-job options; main frozen R1b→R6 (K6, §7.4). |
| Q3 | G1 cities in the repair job | **No**, G1 stays under D1 (`projection` job). | The repair list excludes G1 (§7.4). |
| Q4 | Per-city S3 archive of PG rows | **No archive.** | No S3 write by the repair; no dangling-edge archive table; no restore script. |
| Q5 | Rollback after the first graph write | **Forward-fix only.** The existing daily backup stays the only safety net, without new tooling. | No down-migration, no schema-down job, no rollback lot (§11). |

## 4. Design decisions (K1–K14)

Numbered `K` to avoid confusion with the dossier's D1–D7.

| # | Decision | Rationale |
|---|---|---|
| K1 | `graph_nodes` primary key becomes `(city_slug, id)`; `city_slug` becomes `NOT NULL`. | Matches S3 (one file per city). A PK column cannot be NULL. |
| K2 | Migration 0013 starts by **deleting** the `graph_nodes` rows with `city_slug IS NULL` and the edges whose endpoints only exist among them; the deleted count is raised as a `NOTICE` in the migrate Job log (owner Q1). | Preprod measured 0. No sentinel (it would recreate a shared id space). |
| K3 | `graph_edges` gets `city_slug text NOT NULL`; unique natural key `(city_slug, src_id, dst_id, kind)` replaces `graph_edges_natural_key_idx`; `graph_edges_src_idx` / `graph_edges_dst_idx` become `(city_slug, src_id)` / `(city_slug, dst_id)`. No foreign key to `graph_nodes`. | An edge belongs to the graph of one city (one `latest.json`). |
| K4 | Edge backfill in the migration: `city_slug` = city of the `src_id` node, else of the `dst_id` node (lookups unique while the old PK still holds, i.e. **before** the PK swap inside the same migration). Edges with neither endpoint present are **deleted** (count in the log). The backfill is a placement, not a provenance proof; correctness comes from the per-city edge reconciliation of K7 during the repair, and is measured (§9). | Dangling edges are never served. No archive (owner Q4). |
| K5 | **One migration**, `api/drizzle/0013_graph_city_key.sql`, hand-authored (like 0002/0003), in one transaction, `SET LOCAL lock_timeout = '10s'`; `schema.ts` aligned. The current PK name is read from `pg_constraint` (prod has a schema drift on `graph_nodes`, e.g. no `created_at`), never hard-coded. `geo_resolutions_natural_key_idx` gains `city_slug` (FACT `match-refs.ts:231-237` accepts another city's lot, so two cities with the same node id can resolve the same lot, and `resolve-refs.ts:111` drops the second insert). | Branch template: one migration max. Drift-safe. Fails fast instead of queueing an `ACCESS EXCLUSIVE` behind a refresh transaction. |
| K6 | Release: the CD runs backup → migrate → set-image → assert (`.github/workflows/build-push-images.yml:719-770`) **only when armed**. **Gate of R1**: `BACKUP_BEFORE_RELEASE_ENABLED`, `BACKUP_BEFORE_RELEASE_PROD_ENABLED`, `PREPROD_CD_ENABLED`, `REFRESH_CRONJOB_PREPROD_ENABLED`, `REFRESH_CRONJOB_PROD_ENABLED` read and recorded as `true` (FACT `:237`, `:688-692`, `:727-728`, `:974-988`, `:1285`, `:1319`, `:1403-1427`), and `ROLLBACK_ON_FAILURE_ENABLED` recorded as `false` for this release (K13). Release outside refresh windows (05:17, 11:17, 17:17, 23:17 UTC, 1 h 30–2 h) and outside 02:23 UTC; an old pod issuing `ON CONFLICT (id)` between migrate and set-image fails inside its transaction (nothing written). The refresh CronJob is **not** suspended across the release (an overlay `suspend: true` fails `refresh-018.mk:174` in CI and the promote assert `:1438-1448`); it is suspended after R1 and resumed before R6 by new `run-job.yaml` options `refresh-suspend` / `refresh-resume` (`kubectl patch cronjob radar-refresh-pv`; verb `patch` held by both CI roles, `10-rbac.yaml:29-31`, `11-ci-deployer-preprod-rbac.yaml:100`). Preprod CD re-applies the CronJob on every push to main, hence the freeze (owner Q2) and the repair's suspension precondition. | One release, no data-loss window, no CI or promote conflict. |
| K7 | All writes use the city: nodes `ON CONFLICT (city_slug, id)`, edges `ON CONFLICT (city_slug, src_id, dst_id, kind)`, in `upsertGraphAtomic` **and** the legacy `upsertGraph`; `citySlug: null` removed from both signatures (branch `graph-store.ts:1008-1018` deleted); stop-gap `WHERE` deleted. Deletions are city-scoped on both tables (today the dangling-edge purge `graph-store.ts:1147-1156` deletes other cities' edges sharing an orphan id — FACT), and the projection **deletes the city's edges absent from the new graph**, as it does for nodes. | Same root cause; without the edge reconciliation, edges placed at the wrong city by K4 would survive. |
| K8 | Every read by id binds the city (inventory §6). API **paths do not change** (node-bearing routes are already `/:city`-scoped); `/api/graph/mrc/:mrc` adds `citySlug` on every edge and the UI keys nodes and edges by `(citySlug, id)`. | Ids visible to users and MCP stay identical (the main benefit of C). |
| K9 | Every graph writer (`upsertGraphAtomic`, `upsertGraph`, the repair) takes `pg_advisory_xact_lock(hashtext('graph-city:' \|\| city))` first in its city transaction, and reads the guard baseline (today read **before** the transaction, `graph-store.ts:1033-1036`), evaluates the three guards and mutates inside that same transaction, after the lock. | No writer can slip between the guard read and the write. |
| K10 | The repair is a **new script** `api/src/scripts/repair-graph-city-key.ts`, run by a new `run-job.yaml` job `graph-city-key-repair` (`repair_mode` preview\|apply, `repair_cities`), one transaction per city: pass 1 **decontamination** of proven-foreign nodes, pass 2 **standard projection** in a savepoint with the unchanged three guards (§7). | Foreign rows are what makes the guards refuse G2/G4 today; correcting exactly those lets the unchanged guards do the rest. |
| K11 | "Foreign" is a **per-node, same-id, loss-explained** rule: a PG node `(C, x)` is `foreign` when everything the projection of `graph/C/latest.json` would remove from it (docShas and business properties) is present on node `x` of `graph/D/latest.json` for one `D ≠ C`; `clean` when nothing would be removed; `unknown` otherwise. The `proces-verbaux-<slug>/` path test of the dossier is a secondary signal only. | Slug naming differs from `city_slug` in places (dossier §4.3, lascension); the legacy additive merge (`graph-store.ts:877-892`) can mix local properties with foreign refs. |
| K12 | `run-job.yaml` gains `target_env` (`preprod` \| `prod`, default `prod`) selecting the kubeconfig secret (`KUBE_CONFIG_DATA` / `KUBE_CONFIG_DATA_PREPROD`, FACT `build-push-images.yml:595-604`), namespace, pre-flight host and manifest twin, for `projection`, `document-date-recovery`, `graph-drift-measure`, `graph-city-key-repair`, `mapper`, `snapshot`, `refresh-suspend`, `refresh-resume`. The preprod CI account has no `pods/log` nor `pods/exec` (FACT `11-ci-deployer-preprod-rbac.yaml:16,23,78-91`): each Job writes a ≤ 4 KiB summary to its termination message (printed by the workflow) and its full report to S3 under `reports/graph-city-key/<run-id>/`. Preprod twins for `32-graph-projection-only-job.yaml`, `35-run-geo-mapper-job.yaml`, `35-consistency-snapshot-job.yaml` and the new jobs. | Preprod first through the same jobs, no manual cluster access. |
| K13 | Forward-fix only (owner Q5). No down-migration. The CD image auto-rollback (`build-push-images.yml:1032-1042`) is disarmed for this release: once one colliding city is projected, the old image would mix cities (`subgraphForCity` selects edges by id alone, `graph-store.ts:1325`). The existing daily backup (02:23 UTC) and the CD pre-release backup stay the only DB safety net; no new tooling. | Owner decision; avoids an unsafe automatic image rollback. |
| K14 | Measurement as a CD job `graph-drift-measure` (`api/src/scripts/measure-graph-drift.ts`, compiled, read-only transaction, S3 list/get only), shipped **in the same PR** and run on the post-migration schema only. Derived geo data of repaired nodes are purged by the repair and rebuilt by `mapper` (new `mapper_cities` input passing `CITIES`, read by `35-run-geo-mapper-job.yaml:14`) then `snapshot`. | The dossier `.mjs` "in the pod by stdin" needs `kubectl exec` (manual access). With Q1 decided, no pre-migration baseline is needed, so no separate first PR. `geo_*` tables are insert-only (`resolve-refs.ts:111`). |

## 5. Schema migration — `api/drizzle/0013_graph_city_key.sql`

Single transaction (drizzle `--> statement-breakpoint` markers, journal entry in
`api/drizzle/meta/_journal.json`):

0. `SET LOCAL lock_timeout = '10s'` (K5). On timeout the migrate Job fails and the CD stops before
   set-image; the release is re-run.
1. **NULL cities** (K2): delete edges whose `src_id` and `dst_id` only match NULL-city nodes, then
   `DELETE FROM graph_nodes WHERE city_slug IS NULL`; `RAISE NOTICE` with both counts.
2. **Edge city** (K4), while `graph_nodes.id` is still unique: `ALTER TABLE graph_edges ADD COLUMN
   city_slug text;` backfill from the `src_id` node, then from the `dst_id` node; `DELETE` the rows
   still NULL (`RAISE NOTICE` count); `SET NOT NULL`.
3. **Edge keys** (K3): drop `graph_edges_natural_key_idx`, `graph_edges_src_idx`,
   `graph_edges_dst_idx`; create unique `graph_edges_city_natural_key_idx (city_slug, src_id,
   dst_id, kind)`, `graph_edges_city_src_idx`, `graph_edges_city_dst_idx`. No duplicates possible:
   the old triple was unique and the city is a function of it.
4. **Node key** (K1): `SET NOT NULL` on `graph_nodes.city_slug`; drop the current PK by its name
   read from `pg_constraint` in a `DO` block; `ADD CONSTRAINT graph_nodes_pkey PRIMARY KEY
   (city_slug, id)`; drop the redundant `graph_nodes_city_idx`; keep the other indexes.
5. **Geo key** (K5): `geo_resolutions_natural_key_idx` becomes `(city_slug, node_id,
   relation_type, target_id)` (existing rows stay unique under the wider key).
6. **Postcheck**: `graph_nodes` count = before − deleted NULL-city rows; `graph_edges` count =
   before − deleted edges; raise on mismatch.

`schema.ts`: composite PK, `citySlug` `notNull()` on both tables, new edge indexes; comments saying
"null = cross-city / global" removed. Duration: tables of tens of thousands of rows (size
`unverified`), expected seconds, inside the CD migrate poll of 600 s.

Other tables (FACT, `schema.ts` and `api/drizzle/*.sql`):

| Table | Holds a graph node id? | Change |
|---|---|---|
| `geo_resolutions` | `node_id` + `city_slug` | key widened (step 5); conflict target in `resolve-refs.ts:111`; rows of repaired nodes purged and rebuilt (K14) |
| `geo_unresolved` | `node_id` + `city_slug` (audit, no unique key) | rows of repaired nodes purged and rebuilt (K14) |
| `prospect_marks` | no (lot anchor) | none |
| `prospect_notes` (annotations) | no (`signal_id` → `signals.id` uuid, lot anchor) | none |
| `opportunities`, `opportunity_dossiers`, `constraint_hits` | no | none |
| `consistency_snapshots` | no (per city, rebuilt by `snapshot`) | none |
| `refresh_document_outcomes` | no (per document) | none |
| evidence / refs | inside `graph_nodes.props.refs` (jsonb) | moves with the node row |
| SQL views / materialized views | none on graph tables | none |

## 6. Inventory — every access to the graph tables

Legend: **ID** = keyed by id alone (must change) · **C+ID** = already binds the city · **C** =
city-only filter (no change needed beyond the key). Line numbers on `128bde8b`.

### 6.1 Writes

| Location | What | Today | Change |
|---|---|---|---|
| `api/src/services/graph/graph-store.ts:861-871` | `upsertGraph` node upsert `onConflictDoUpdate({ target: graphNodes.id })` | ID | target `[citySlug, id]`; drop `citySlug: null` |
| `graph-store.ts:911-913` | `upsertGraph` edge upsert target `(src_id, dst_id, kind)` | ID | add `citySlug` to rows (`buildEdgeRow(link, citySlug)`, `graph-store.ts:214`) and target |
| `graph-store.ts:1008-1018` | `upsertGraphAtomic` `citySlug === null` branch | — | delete (K7) |
| `graph-store.ts:1103-1111` | `upsertGraphAtomic` node upsert target `graphNodes.id` | ID | target `[citySlug, id]`; delete stop-gap `WHERE` |
| `graph-store.ts:1126-1129` | `upsertGraphAtomic` edge upsert | ID | as `upsertGraph` |
| `graph-store.ts:1147-1156` | dangling-edge delete `inArray(srcId/dstId, orphanIds)` | ID (deletes other cities' edges) | add `eq(graphEdges.citySlug, citySlug)` (K7) |
| `graph-store.ts:1134-1137`, `1158-1163` | orphan node select/delete | C+ID | none |
| `graph-store.ts:466`, `488` | `mergeNodeRows` / `mergeEdgeRows` merge by `id` / triple inside one city | in-memory, one city | none (single-city input) |
| `api/src/services/sources/exploitation.ts:173` | legacy `upsertGraph(db, citySlug, …)` | via `upsertGraph` | follows `upsertGraph`; fate of the flow is outside this spec |
| `api/src/scripts/collect-exploit-source.ts:74-84` | legacy flow via `runExploitation` | via `upsertGraph` | none beyond `upsertGraph` |
| callers of `upsertGraphAtomic`: `graph/refresh-run.ts:314`, `scripts/project-graph-from-s3.ts:124`, `scripts/recover-document-dates.ts:163`, `scripts/graphify-34-enrich.ts:92`, `scripts/filet-auto-link-pv.ts:306`, `scripts/purge-avis-bylaws.ts:407` | city-scoped projection | C | type change only (`citySlug: string`) |

### 6.2 Reads in the API and services

| Location | What | Today | Change |
|---|---|---|---|
| `graph-store.ts:1231-1259` `queryNeighbors(db, nodeId)` | edges by `src_id`/`dst_id`, nodes `inArray(id)` | **ID** | signature `(db, citySlug, nodeId)`, bind city on both tables. No production caller (tests only) |
| `graph-store.ts:1292-1333` `subgraphForCity` | nodes by city; edges `or(eq(srcId, id)…)` then filter dst | nodes C, edges **ID** (can return another city's edge whose ids both exist in the city) | edges `where city_slug = $city` (drop the giant `OR`) |
| `graph-store.ts:1360-1395` `subgraphForMrc` | nodes `inArray(citySlug)`; edges `inArray(srcId, ids)`; `nodeIds` set by id | **ID** (ids of two cities of the MRC collapse) | edges `inArray(citySlug, citySlugs)`; endpoint check on `(city, id)`; response edges carry `citySlug` (K8) |
| `graph-store.ts:1416-1455` `listMrcs` | counts by city | C | none |
| `graph-store.ts:2071-2119` `listCitiesWithSignalNodes`, `getSignalNodesForCity` | signal nodes by city | C | none |
| `api/src/services/data-quality/summary.ts:119-138` `loadDbSnapshot` | nodes by city, edges `inArray(srcId, nodeIds)` | edges **ID** | edges by `city_slug` |
| `api/src/services/geo/geo-features.ts:156-181` | `geo_resolutions` by city, then `graphNodes` `inArray(id, nodeIds)` | **ID** | add `eq(graphNodes.citySlug, citySlug)` |
| `geo-features.ts:350-375` `getOpportuniteFeatures` | signal nodes by city | C | none |
| `api/src/services/geo/run-geo-mapper.ts:90-92`, `measure-geo-mapping.ts:230-232`, `populate-geo.ts:395-399` | raw SQL on `graph_nodes` `WHERE city_slug = …` | C | none |
| `api/src/services/geo/resolve-refs.ts:103-112` | insert `geo_resolutions` `ON CONFLICT (node_id, relation_type, target_id) DO NOTHING` | key without city; collides across cities (`match-refs.ts:231-237` accepts another city's lot) | conflict target `(city_slug, node_id, relation_type, target_id)` (0013 step 5) |
| `api/src/services/geo/priority-resolver.ts:205-213` | in-memory adjacency by `srcId`/`dstId` over one graph | in memory | none while its input is a single-city graph (no production caller found); noted for review |
| `api/src/services/consistency/load-consistency-raw.ts:53-81`, `api/src/routes/source-coverage.ts:702-760` | aggregates `GROUP BY city_slug` | C | none |
| `api/src/services/graph/graphify-34-snapshot.ts:102-159` | snapshot from `subgraphForCity` | C | none (benefits from the edge fix) |

### 6.3 HTTP routes

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

### 6.4 UI

| Location | Today | Change |
|---|---|---|
| `ui/src/lib/signals/signals-live.ts:62` | T1 signal id is `gn-${citySlug}-${index}` | none (already city-qualified) |
| `ui/src/lib/components/maps/EvaluationMapView.svelte:170-175` | parses `gn-<city>-<n>` | none |
| `ui/src/lib/components/signals/SignalsT1View.svelte:230`, `SignalPdfOverlay.svelte:1142-1175`, `App.svelte:71-78` | keyed by the `gn-…` id | none |
| `ui/src/lib/components/reconciliation/MrcGraphView.svelte:169`, `353-355`, `386` | `nodeById` and `{#each}` keyed by `node.id`, edges resolved by `srcId`/`dstId` | **ID** across cities: key `${citySlug}\u0000${id}`; resolve edge endpoints with `edge.citySlug` |
| `ui/src/lib/components/reconciliation/CityGraphView.svelte:149`, `275`, `309` | single city | none (server already restricts to the city) |
| `ui/src/lib/graph/graph-client.ts:20-75` | `GraphEdge` type | add `citySlug` to the edge type of the MRC response |

### 6.5 MCP (`packages/immo-mcp`)

FACT. Tools `search_lots`, `get_lot_card`, `search_signals`, `get_opportunity_dossier`,
`list_documents`, `read_document_excerpt` (`packages/immo-mcp/src/tools.ts:117-200`). The only one
wired to graph data is `search_signals`, through `GET /api/graph-signals/:city`
(`packages/immo-mcp/src/data-source.ts:285-330`): it is city-scoped and no tool takes a node id as
input. Change: none in code; the `search_signals` output already carries the city; a contract test
asserts that each returned signal carries `citySlug` so an MCP client can address `(city, id)`.
No external consumer addresses a node by id alone (`unverified` for shared links outside the repo:
no route accepts one, so such a link cannot exist).

### 6.6 Scripts, jobs, manifests

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
| `docs/spec/reports/dossier-villes-ecart/preuves/diagnostic/mesure-lecture-seule.mjs` (PR #815) | `pgCityById` = `id → city` map (assumes unique ids); returns early when id sets agree (line 70) | **ID** | replaced by the CD job `graph-drift-measure` (K14, §9) |

### 6.7 Tests that assert the old key

`api/src/services/graph/graph-store.test.ts` (mocks of `onConflictDoUpdate` target, `queryNeighbors`
at 1342-1414 and 1650), `api/src/routes/graph.test.ts`, `api/tests/integration/refresh-018.spec.ts`
(`upsertGraphAtomic` at 309), `api/tests/integration/graph-signals-date-parity.spec.ts`,
`graph-signals.sainte-martine-508.test.ts`, `graphify-34-enrichment.integration.test.ts`,
`geo/regulatory-status-zone.integration.test.ts`, `sources/live-scrape.test.ts`,
`scripts/worker-live-reexploit.test.ts`, `graph/project-state-to-graph.test.ts`,
`graph/graphify-34-enrichment.test.ts`, `scripts/purge-avis-bylaws*.test.ts`,
`ui/src/lib/components/reconciliation/CityGraphView.test.ts`.
They are updated in the lot that changes the code they cover.



## 7. Code changes and repair

### 7.1 Store

1. `graph-store.ts`: K7, K8, K9 as listed in §6.1–6.2; `buildEdgeRow(link, citySlug)`;
   `UpsertAtomicResult` gains `deletedStaleEdges`, loses the cross-city case.
2. The part of `upsertGraphAtomic` that turns a `latest.json` into rows (`graphifyGraphSchema.parse`,
   `buildNodeRow`, `mergeNodeRows`, `buildEdgeRow`, `mergeEdgeRows`, `materializeSeveredSources`,
   `graph-store.ts:993-1004`) becomes an exported pure `prepareCityProjection(citySlug, graphJson)`,
   used by the projection, the repair and the measurement (a simulation is the projection, not a
   copy of it).
3. Guards (`findMissingBusinessProperties`, `findMissingSourceRefs`, `countCompleteSignals`,
   `graph-store.ts:571-830`): **unchanged**; only where they run moves inside the transaction (K9).

### 7.2 Repair script — `api/src/scripts/repair-graph-city-key.ts`

- **Inputs**: `--apply` (absent ⇒ preview: the real code path in a transaction that is always
  rolled back; no persistent write), explicit city slugs (required), `--run-id` (default
  `graph-city-key-repair-<UTC>`).
- **Preconditions (exit 2)**: PK of `graph_nodes` is `(city_slug, id)` (read from
  `pg_constraint`); in apply mode the refresh CronJob is suspended and no projection, recovery,
  mapper or repair Job is active (the `run-job.yaml` busy pre-check `:238-249`, extended so that
  these jobs list each other).
- **Reads**: every `graph/<city>/latest.json` once through `prepareCityProjection`, kept as a
  per-city, per-id index of docShas and business properties; PG rows of the target city inside its
  transaction, after the K9 lock.
- **Writes (apply only)**: PG only. Never S3 data; the run report goes to
  `reports/graph-city-key/<run-id>/repair.json` and a ≤ 4 KiB summary to the termination message.
- **Per city, one transaction, after the K9 lock**:
  1. Classify each PG node `(C, x)` (K11). Let `S` be C's own row for `x` from
     `prepareCityProjection` (absent if `x` is not in C's file) and `loss` what replacing the row by
     `S` (or deleting it) would remove: docShas, and `props.properties` values (same predicate as
     `findMissingBusinessProperties`).
  2. **Pass 1 — decontamination**: if any node is `unknown`, the city is refused (no write, listed
     for review). Otherwise each `foreign` node is **replaced by `S`** when `x` is in C's file (its
     local part survives: the loss is exactly what D's file explains), or **deleted** when it is not
     (the whole row is explained by D; its incident edges in C go with it). Its `geo_*` rows in C are
     purged.
  3. **Pass 2 — projection** in a savepoint: the body of `upsertGraphAtomic` (upsert, orphan nodes,
     stale and dangling edges, three guards). A guard refusal now means a local loss (G5c, G6): the
     savepoint is rolled back, pass 1 stays committed — the city is decontaminated but not
     re-aligned, reported as such.
  4. `geo_*` rows of nodes deleted by pass 2 are purged. Commit.
- **Report per city**: `{ city, classes: { clean, foreign, unknown }, pass1 | refused,
  pass2 | refused(reason), geoPurged }`, with **before** verdicts (the three guards against the
  current PG state, comparable to the dossier `sim.json`) and **after** verdicts. Example: gore is
  `refused (gate1-business-property)` before, as in `sim.json:1328`, and expected `pass` after.
  Exit 1 when any city is refused or errored; cities are independent.
- **Idempotence**: a second run finds only `clean` nodes; pass 2 upserts identical content.

### 7.3 CD jobs

- `deploy/k8s/42-graph-city-key-repair-job.yaml`, `deploy/k8s/43-graph-drift-measure-job.yaml`,
  their preprod twins, and preprod twins of the projection, geo mapper and consistency snapshot
  jobs; modelled on `41-document-date-recovery-job.yaml` (label `component: graph-projection`,
  `backoffLimit: 0`, `activeDeadlineSeconds` ≤ ~3 h 45 between refresh windows, SCRAPE S3 binding,
  added to `SCRAPE_FILES` in `deploy/ci/check-object-storage-bindings.sh:13-17`). Not in
  `kustomization.yaml`.
- `run-job.yaml`: options `graph-drift-measure`, `graph-city-key-repair`, `refresh-suspend`,
  `refresh-resume`; inputs `target_env`, `repair_mode`, `repair_cities`, `mapper_cities`;
  termination-message print; mutual busy pre-check.
- Post-rollout assert: one `GET /api/graph/<city>` and one `GET /api/graph-signals/<city>` must
  return 200 (the `/health` probe only runs `SELECT 1`, `api/src/db/client.ts:36`).

### 7.4 Run order (outside refresh windows and 02:23 UTC, one job at a time)

Target list `L` (computed at R2) = cities with id drift in G2, G3, G4 **∪** cities with ≥ 1 node
`foreign` or `unknown` (including cities whose id sets agree, e.g. fortierville in `sim.json`)
**∪** cities with edge drift; G1 excluded (D1); G5c and G6 included for pass 1, `pass2 refused`
expected.

| Step | preprod (`radar-immobilier-preprod`) | prod (`radar-immobilier`) | Gate |
|---|---|---|---|
| R1 | gate K6 checked; release through CD | same; tag `vX.Y.Z` | migrate Job Complete (NOTICE counts recorded); served image and CronJob image = release |
| R1b | `refresh-suspend`; freeze graph-touching merges to main | `refresh-suspend` | `suspend: true` read back |
| R2 | `graph-drift-measure` | same | PK `[city_slug, id]`, 0 NULL city; list `L` produced |
| R3 | `graph-city-key-repair` preview on `L` | same | before-verdicts match `sim.json` (differences explained by S3 content added since 2026-10-04); after-verdicts `pass` except listed G5c/G6; `unknown` reviewed |
| R4 | `graph-city-key-repair` apply on `L` | same | report = preview |
| R5 | `document-date-recovery` apply, `recovery_heal=false`, cities whose pass 2 succeeded; then `mapper` (`mapper_cities` = `L`) and `snapshot` | same | 0 HALT, 0 abort; jobs Complete |
| R6 | `graph-drift-measure` (acceptance §9); `refresh-resume`; unfreeze main | same | §9 criteria; `suspend: false` read back |

Prod starts only after R6 passes in preprod.

## 8. Date-recovery re-run

`recover-document-dates.ts` needs no change: it compares `latest.json` ids with
`subgraphForCity(db, city)` ids and projects through `upsertGraphAtomic`. After R4 the id sets of
repaired cities are equal, so R5 writes dates (archiving `latest.json` first, as today) and
re-projects. `--heal` stays forbidden on these cities (dossier §6.1 point 3).

## 9. Acceptance measurement

`graph-drift-measure` carries the rules of the dossier script `mesure-lecture-seule.mjs` (PR #815),
keyed by `(city, id)`, with the content check run for **every** city (the dossier script returns
early at line 70 when id sets agree), node classes from the repair's classifier, edge drift
(`edgesNotInS3`, `edgesMissingInPg` against `prepareCityProjection`), the PK columns, and refresh
outcomes read from the S3 refresh receipts. Its rules are checked against the dossier script by an
integration test on a seeded database (same fixtures, same groups and `foreignPg`, the expected
differences listed: content-only contamination, completeness count without the cross-city
exclusion).

Acceptance after R6, per environment:

| Measure | Target |
|---|---|
| nodes `foreign` | **0** |
| nodes `unknown` | 0, or each listed and accepted by the owner |
| `foreignPg.nodes` (path rule of the dossier) | **0**, residuals explained by a slug mismatch listed |
| `foreignS3.nodes` | 0 |
| groups `G2G4-collision-refused`, `G3-S3-collision-only` | **0** |
| `edgesNotInS3`, `edgesMissingInPg` on cities whose pass 2 succeeded | **0** |
| groups `G5c`, `G6`, `G5ab`, `G1` | only cities listed under D1/D4–D7 |
| NULL city | 0 |
| first refresh pass after resume | 0 `postgres-regression-refused` for cities whose pass 2 succeeded |

## 10. Tests

`make test ENV=test-fix-graph-city-key`, `make test-e2e ENV=e2e-fix-graph-city-key`, never
`ENV=dev`.

Unit: two cities with the same id → two rows; same edge triple in two cities → two rows; dangling
and stale edge purges stay in the city; `subgraphForCity` never returns another city's edge;
`subgraphForMrc` keeps `(A, x)` and `(B, x)`; classifier clean / foreign / unknown, including a
foreign docSha also present on another id of C's file (stays `foreign`), local properties with
foreign refs from the legacy merge (`unknown`), property-only contamination, slug mismatch; repair:
pass 1 refused on `unknown`, replace keeps the local part, pass-2 refusal keeps pass 1, idempotence;
`prepareCityProjection` parity with the current projection on existing fixtures.

Integration (Postgres test stack): migration 0013 on a database seeded at 0012 with shared ids,
shared edge triples, dangling edges, NULL-city rows (deleted, counts in NOTICE), a drifted PK name,
a held lock (`lock_timeout`); geo same node id in two cities resolving the same lot → two rows;
gore / barkmere end to end (seeded contamination, migrate, preview verdicts, apply, second run
no-op, `recover-document-dates --apply` without HALT); fortierville-like case; a projection of the
same city started during a repair waits on the lock; measurement rules vs the dossier script;
`refresh-018.spec.ts`, `graph-signals-date-parity.spec.ts` green.

E2E: MRC graph view with two cities sharing an id (two nodes, correct edges, no duplicate key);
Signals T1 and PDF overlay unchanged on a contaminated-then-repaired city.

CI: `make k8s-validate ENV=ci`; object-storage binding check.

## 11. Rollback

Forward-fix only (owner Q5, K13). No down-migration and no rollback job are built. The CD image
auto-rollback is disarmed for this release. The only DB safety net is the existing one: the CD
pre-release backup and the daily backup (02:23 UTC), operated by the immo tenant; no new tool. S3
is never written by the repair; R5 archives `latest.json` exactly as the recovery does today.

## 12. Risks

| Risk | Mitigation |
|---|---|
| CD migrate or CronJob update disarmed | R1 gate on five variables (K6). |
| Lock queue during the migration | `lock_timeout` (K5). |
| Old image after the first graph write | auto-rollback disarmed; forward-fix (K13). |
| Misclassification of foreign content | per-node, same-id, loss-explained rule; `unknown` refused; before/after verdicts; preprod rehearsal. |
| Concurrent writer during repair | per-city lock in every writer (K9); CronJob suspended; freeze; busy pre-check. |
| No archive of repaired rows | owner Q4: `latest.json` stays authoritative; a city can be re-projected at any time; preview shows every change before apply. |

## 13. Removed by the owner decisions (versus the previous revision)

- Per-city S3 archive of PG rows and its read-back (Q4).
- `graph_edges_dangling_0013` archive table: dangling edges are deleted (Q4).
- Down-migration `api/drizzle/rollback/0013_graph_city_key.down.sql`, the `graph-schema-down` job
  and its preprod twin, the journal-row handling (Q5).
- NULL-city precheck that blocked the release, replaced by deletion in the migration (Q1).
- The separate first PR for the measurement job and the pre-migration baseline R0 (no longer
  needed once Q1 is decided): one PR, one release.
- G1 cities from the repair list (Q3).

## 14. Adversarial review log

Two independent peers, distinct lenses, seats only (no API key): **peer A** (Codex) — data
correctness and migration safety; **peer B** (Claude) — operations, repair, rollback, inventory.
Round 1: A reject, B approve-with-changes. Round 2: B approve-with-changes, A reject. Every finding
was checked against the code; all were accepted. Findings tied to removed items (archive, down
script, R0) are closed by the owner decisions of §3.

### 14.1 Findings and where they are resolved

| # | Peer · round | Severity | Finding (short) | Resolution in this revision |
|---|---|---|---|---|
| A1 | A · 1 | blocker | Foreign refs do not prove foreign properties (legacy merge, `graph-store.ts:877-892`). | K11 loss-explained rule; `unknown` refuses the city. |
| A2 | A · 1 | major | Classification on all ids of C, guard on the same id. | K11 same-id; unit test. |
| A3 | A · 1 | blocker | Dossier script exits early when ids agree (fortierville). | §9 content check for every city; list `L` includes it. |
| A4 | A · 1 | blocker | Edges not reconciled from S3. | K7 stale-edge deletion; §9 edge drift. |
| A5 | A · 1 | major | `geo_resolutions` key collides across cities. | K5 key widened; R5 `mapper`. |
| A6 | A · 1 | blocker | Down then up skipped by the drizzle journal. | Closed by Q5: no down-migration. |
| A7 | A · 1 | major | Image auto-rollback without schema rollback; `/health` = `SELECT 1`. | K13 auto-rollback disarmed; graph check in the post-rollout assert. |
| A8 | A · 1 | major | Repair lock not taken by other writers. | K9 lock in every writer. |
| A9 | A · 1 | major | Simulation and equivalence criteria inconsistent. | `prepareCityProjection` shared; before/after verdicts; §9 expected differences listed. |
| A-R2-1 | A · 2 | blocker | Pass 1 deleted whole rows; a pass-2 rollback could drop a local part. | §7.2 pass 1 replaces by C's own row, deletes only fully explained rows. |
| A-R2-2 | A · 2 | major | Down did not handle the archive table nor later migrations. | Closed by Q4/Q5: no archive table, no down. |
| A-R2-3 | A · 2 | major | Guard baseline read before the transaction (`graph-store.ts:1033`). | K9: baseline, guards, writes after the lock in one transaction. |
| A-R2-4 | A · 2 | major | Old image serves cross-city edges after duplication (`:1325`). | K13. |
| A-R2-5 | A · 2 | minor | gore verdict is gate1 (`sim.json:1328`); preview not read-only. | §7.2 corrected. |
| B1 | B · 1 | blocker | Preprod unreachable from `run-job.yaml`. | K12. |
| B2 | B · 1 | blocker | Measurement needs `kubectl exec`. | K14 CD job. |
| B3 | B · 1 | major | CD migrate conditional on variables. | K6 R1 gate. |
| B4 / N1 | B · 1–2 | major / blocker | CronJob image not tied to the release; overlay suspension breaks CI and promote. | K6: CronJob armed at release, `refresh-suspend` / `refresh-resume` after. |
| B5 | B · 1 | major | Rollback not operable. | Closed by Q5: forward-fix only, stated. |
| B6 | B · 1 | major | Repair ignores edges; list too narrow. | K7; list `L` (§7.4). |
| B7 / N3 | B · 1–2 | major | Derived geo data omitted; no preprod mapper/snapshot. | K14; K12 twins. |
| B8 | B · 1 | major | No `lock_timeout`; busy lists not mutual. | K5; §7.3. |
| B9 / N5 | B · 1–2 | minor | Plan scope and ENV gaps. | Plan rewritten (one branch, one ENV pair). |
| B10 / N2 | B · 1–2 | minor | R2 baseline tolerance; receipts path; `priority-resolver.ts:205-213`. | No R0 baseline; receipts read by the measure job; priority-resolver noted (§6.2). |
| N4 | B · 2 | minor | Down job twin and order. | Closed by Q5. |

### 14.2 Round 3

Peer A round 3 on this simplified revision: see the PR thread (result added below when received).
