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

## 3. Design decisions (K1–K16)

Numbered `K` to avoid confusion with the dossier's D1–D7.

| # | Decision | Rationale |
|---|---|---|
| K1 | `graph_nodes` primary key becomes `(city_slug, id)`; `city_slug` becomes `NOT NULL`. | Matches S3 (one file per city). A PK column cannot be NULL. |
| K2 | NULL-city rows are **not** given a sentinel. The migration starts with a precheck that **raises** if any `graph_nodes.city_slug IS NULL` row exists; the release then aborts before `set-image` (backup already taken). R0 (`graph-drift-measure`, K13) measures the prod count read-only before the release. | Preprod measured 0. A sentinel (`__global__`) would recreate a shared id space. Fail-closed, decided on evidence. |
| K3 | `graph_edges` gets `city_slug text NOT NULL`; unique natural key `(city_slug, src_id, dst_id, kind)` replaces `graph_edges_natural_key_idx`; `graph_edges_src_idx` / `graph_edges_dst_idx` become `(city_slug, src_id)` / `(city_slug, dst_id)`. No foreign key to `graph_nodes` (unchanged soft reference, keeps the projection's upsert order free). | An edge belongs to the graph of one city (one `latest.json`). |
| K4 | Edge backfill in the migration: `city_slug` = city of the `src_id` node, else of the `dst_id` node (both lookups unique while the old PK still holds, i.e. **before** the PK swap inside the same migration). Edges with neither endpoint present are copied to `graph_edges_dangling_0013` then deleted. | Dangling edges are never served (every edge read requires the src node in the city set). Archive keeps them restorable. |
| K5 | **One migration**, `api/drizzle/0013_graph_city_key.sql`, hand-authored (like 0002/0003), in one transaction; `schema.ts` aligned. The constraint name of the current PK is resolved from `pg_constraint` (prod has a schema drift on `graph_nodes`, e.g. no `created_at`), never hard-coded. | Branch template: one migration max. Drift-safe. |
| K6 | Release ordering: the CD path runs backup → migrate → set-image → assert (`.github/workflows/build-push-images.yml:719-770`) **only when armed**: preprod by `vars.BACKUP_BEFORE_RELEASE_ENABLED` (`:688-692`, `:727-728`), prod by `vars.BACKUP_BEFORE_RELEASE_PROD_ENABLED` (`:1285`, `:1319`); the legacy main→prod job (`vars.PREPROD_CD_ENABLED != 'true'`, `:237`) never migrates. The refresh CronJob follows the release image only when `REFRESH_CRONJOB_PREPROD_ENABLED` / `REFRESH_CRONJOB_PROD_ENABLED` are armed (`:974-988`, `:1403-1427`), and promote-prod then asserts that the live CronJob is **not suspended** and carries the promoted digest (`:1438-1448`). **Gate of R1**: these five variables read and recorded as `true`. The release runs outside refresh windows (05:17, 11:17, 17:17, 23:17 UTC, 1 h 30–2 h each) and outside 02:23 UTC; between migrate and set-image an old pod issuing `ON CONFLICT (id)` fails **inside its transaction** (fail-closed, nothing written). The CronJob is **not** suspended across the release (an overlay with `suspend: true` fails `refresh-018.mk:174` verify-renders in CI and the promote assert). It is suspended **after** R1 and resumed before R6 by two new `run-job.yaml` options `refresh-suspend` / `refresh-resume` (`kubectl patch cronjob radar-refresh-pv`, verbs `patch` held by both CI roles: `10-rbac.yaml:29-31`, `11-ci-deployer-preprod-rbac.yaml:100`). In preprod every push to main re-applies the overlay (resumes the CronJob), so the repair re-checks the suspension as a precondition (§7.1) and main is frozen for graph-touching merges from R2 to R6. No expand/contract second migration. | One release, no data-loss window, no permanent failure mode, no CI or promote conflict (peer B #3, #4, round-2 N1). |
| K7 | All writes use the city in the conflict target: nodes `ON CONFLICT (city_slug, id)`, edges `ON CONFLICT (city_slug, src_id, dst_id, kind)`, in `upsertGraphAtomic` **and** the legacy `upsertGraph`. `citySlug: null` is removed from both signatures (the "cross-city upsert" branch at `graph-store.ts:1008-1018` is deleted). The one-line stop-gap `WHERE graph_nodes.city_slug = excluded.city_slug` is deleted. | No Legacy Fallback; a NULL city can no longer be stored (K1). |
| K8 | Deletions in `upsertGraphAtomic` are city-scoped on **both** tables: dangling-edge purge adds `graph_edges.city_slug = $city` (today `graph-store.ts:1147-1156` deletes other cities' edges sharing an orphan id — a second cross-city defect, FACT). In addition, the projection **deletes the city's edges absent from the new graph** (same rule as for nodes), so that PG edges of a city equal its `latest.json` edges after a projection. | Same root cause. Without it, edges of city B that the backfill (K4) attached to city A on a shared id would survive at A and be served by `subgraphForCity` (peer B #6). |
| K9 | Every read by id binds the city (inventory §5): neighbour/edge reads, geo joins, MRC aggregation. API **paths do not change** (all node-bearing routes are already `/:city`-scoped); multi-city responses (`/api/graph/mrc/:mrc`) add `citySlug` on every edge and the UI keys nodes and edges by `${citySlug}\u0000${id}`. | Ids visible to users and MCP stay identical (the main benefit of C). |
| K10 | The repair is a **new script** `api/src/scripts/repair-graph-city-key.ts`, run by a **new** `run-job.yaml` job `graph-city-key-repair` (inputs `repair_mode` preview\|apply, `repair_cities`), one transaction per city: pass 1 **decontamination** (delete proven-foreign rows), pass 2 **standard projection** in a savepoint with the unchanged three guards (§7). | Foreign rows are what makes the guards refuse G2/G4 today; removing exactly those, and nothing else, lets the unchanged guards do the rest. |
| K11 | "Foreign" is a **per-node, same-id, loss-explained** rule: a PG node `(C, x)` is `foreign` when everything the projection of `graph/C/latest.json` would remove from it (docShas and business properties) is present on node `x` of `graph/D/latest.json` for one `D ≠ C`; `clean` when nothing would be removed; `unknown` otherwise (§7.2). The `proces-verbaux-<slug>/` path test of the dossier is a secondary signal only. | Slug naming differs from `city_slug` in places (dossier §4.3, lascension); the legacy additive merge can mix local properties with foreign refs (peer A #1, #2). |
| K12 | `run-job.yaml` gains a `target_env` input (`preprod` \| `prod`, default `prod`) that selects **the kubeconfig secret** (`KUBE_CONFIG_DATA` for prod, `KUBE_CONFIG_DATA_PREPROD` for preprod, FACT `build-push-images.yml:595-604`), the namespace, the pre-flight expected host and the manifest twin, for `projection`, `document-date-recovery`, `graph-drift-measure`, `graph-city-key-repair`, `graph-schema-down`, `mapper`, `snapshot`, `refresh-suspend` and `refresh-resume`. The preprod CI service account has no `pods/log` nor `pods/exec` (FACT `deploy/k8s/11-ci-deployer-preprod-rbac.yaml:16,23,78-91`), so every such Job writes a summary (≤ 4 KiB) to its **termination message** and its full report to S3; the workflow prints the termination message. Preprod twins are added for `32-graph-projection-only-job.yaml`, `35-run-geo-mapper-job.yaml`, `35-consistency-snapshot-job.yaml` and every new job (today prod-only, namespace hard-coded). | Same jobs, same parameters, preprod first, without manual cluster access (peer B #1). |
| K13 | The read-only measurement becomes a CD job `graph-drift-measure` (TypeScript script compiled in the image, read-only transaction, S3 list/get only, report to S3 + termination message). It must run on **both** schemas (before and after 0013). It ships in a **first, separate PR** (with K12), released before the migration, so that R0 runs on the pre-migration schema with the same tool used for acceptance. | Running the dossier `.mjs` "in the pod by stdin" needs `kubectl exec`, which no CI account has and which is a manual access (peer B #2). |
| K14 | Derived geo data are re-derived for repaired cities: the repair deletes, city-scoped, the `geo_resolutions` and `geo_unresolved` rows of the node ids it replaced (pass 1) or deleted (pass 2), then the run order calls `mapper` (with a new `mapper_cities` input passing `CITIES`, already read by `35-run-geo-mapper-job.yaml:14`) and `snapshot`. | `geo_*` tables are insert-only (`resolve-refs.ts:111` `ON CONFLICT DO NOTHING`, no delete in `api/src`) and computed from node props: rows derived from foreign content would remain (peer B #7). |
| K15 | Every graph writer (`upsertGraphAtomic`, `upsertGraph`, the repair) takes `pg_advisory_xact_lock(hashtext('graph-city:' \|\| city))` as the first statement of its city transaction. | A repair-only lock does not exclude the refresh or the legacy exploitation route (peer A #8, peer B #8). |
| K16 | Rollback policy: down-migration only before the first graph write after R1; forward-fix after (§11). | Duplicate ids exist as soon as one colliding city is projected; no prod restore tooling exists (peer A #6, #7, peer B #5). |


## 4. Schema migration — `api/drizzle/0013_graph_city_key.sql`

Single transaction, in this order (pseudo-SQL; the implementation keeps drizzle's
`--> statement-breakpoint` markers and the journal entry in `api/drizzle/meta/_journal.json`):

0. **Lock budget**: `SET LOCAL lock_timeout = '10s'`. If a refresh or API transaction holds the
   tables, the migration fails fast (the migrate Job fails, CD aborts **before** set-image), instead
   of queueing an `ACCESS EXCLUSIVE` that would block every API read until the Job deadline
   (`36-db-migrate-job.yaml`, `activeDeadlineSeconds: 540`). The refresh CronJob is already
   suspended (K6); a retry is a re-run of the release.
1. **Precheck NULL cities** (K2): `DO $$ … IF EXISTS (SELECT 1 FROM graph_nodes WHERE city_slug IS
   NULL) THEN RAISE EXCEPTION 'graph_nodes has % rows with NULL city_slug; migration 0013 refused'`.
2. **Edges: add and backfill city** (K4), while `graph_nodes.id` is still unique; the
   pre-migration edge count is kept in a temp table for step 7:
   `ALTER TABLE graph_edges ADD COLUMN city_slug text;`
   `UPDATE graph_edges e SET city_slug = n.city_slug FROM graph_nodes n WHERE n.id = e.src_id;`
   then the same from `dst_id` for rows still NULL. The backfill is a **placement**, not a
   provenance proof: an edge of city B on an id shared with A may land at A. Correctness is restored
   by the per-city edge reconciliation of the projection (K8) during the repair (§7), and measured
   (`edgesNotInS3`, §9).
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
6. **Geo key** (K14): `geo_resolutions_natural_key_idx` `(node_id, relation_type, target_id)`
   (`0007_geo_mapper.sql:93`) becomes `(city_slug, node_id, relation_type, target_id)`. FACT:
   `match-refs.ts:231-237` accepts a lot of **another** city when unambiguous, so two cities with the
   same node id can resolve the same lot `target_id`, and today the second insert is silently dropped
   by `ON CONFLICT … DO NOTHING` (`resolve-refs.ts:111`). Existing rows are unique under the wider
   key, so the swap holds. The missing resolutions are rebuilt by the `mapper` run of §7.5 (R5b).
7. **Postcheck**: `graph_nodes` count unchanged; `count(graph_edges) +
   count(graph_edges_dangling_0013)` equal to the step-2 count; `geo_resolutions` count unchanged;
   raise on mismatch.

`schema.ts`: `graphNodes` uses `primaryKey({ columns: [t.citySlug, t.id] })`, `citySlug` `notNull()`;
`graphEdges` gets `citySlug: text("city_slug").notNull()` and the three new indexes; comments that
say "null = cross-city / global" are removed.

Duration: two tables of tens of thousands of rows (exact size `unverified`, measured by R0);
expected seconds, inside the CD migrate poll of 600 s.

Other tables (FACT, checked in `schema.ts` and `api/drizzle/*.sql`):

| Table | Holds a graph node id? | Change |
|---|---|---|
| `geo_resolutions` | `node_id` + `city_slug` | key widened with `city_slug` (step 6); conflict target in `resolve-refs.ts:111`; derived rows of repaired nodes purged and rebuilt (K14) |
| `geo_unresolved` | `node_id` + `city_slug` (audit, no unique key) | derived rows of repaired nodes purged and rebuilt (K14) |
| `prospect_marks` | no (lot anchor `lot_version_id`, `no_lot`, `city_slug`) | none |
| `prospect_notes` (annotations) | no (`signal_id` → `signals.id` uuid, lot anchor) | none |
| `opportunities`, `opportunity_dossiers`, `constraint_hits` | no (uuid `signals`, zone/lot canonical ids) | none |
| `consistency_snapshots` | no (per city payload, rebuilt by `snapshot` in R5b) | none |
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
| `api/src/services/geo/resolve-refs.ts:103-112` | insert `geo_resolutions` `ON CONFLICT (node_id, relation_type, target_id) DO NOTHING` | key without city; collides across cities (`match-refs.ts:231-237` accepts another city's lot) | conflict target `(city_slug, node_id, relation_type, target_id)` (0013 step 6) |
| `api/src/services/geo/priority-resolver.ts:205-213` | in-memory adjacency by `srcId`/`dstId` over one graph | in memory | none while its input is a single-city graph (no production caller found); noted for review |
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
| `docs/spec/reports/dossier-villes-ecart/preuves/diagnostic/mesure-lecture-seule.mjs` (PR #815) | `pgCityById` = `id → city` map (assumes unique ids); returns early when id sets agree (line 70) | **ID** | replaced by the CD job `graph-drift-measure` (K13, §9) |

### 5.7 Tests that assert the old key

`api/src/services/graph/graph-store.test.ts` (mocks of `onConflictDoUpdate` target, `queryNeighbors`
at 1342-1414 and 1650), `api/src/routes/graph.test.ts`, `api/tests/integration/refresh-018.spec.ts`
(`upsertGraphAtomic` at 309), `api/tests/integration/graph-signals-date-parity.spec.ts`,
`graph-signals.sainte-martine-508.test.ts`, `graphify-34-enrichment.integration.test.ts`,
`geo/regulatory-status-zone.integration.test.ts`, `sources/live-scrape.test.ts`,
`scripts/worker-live-reexploit.test.ts`, `graph/project-state-to-graph.test.ts`,
`graph/graphify-34-enrichment.test.ts`, `scripts/purge-avis-bylaws*.test.ts`,
`ui/src/lib/components/reconciliation/CityGraphView.test.ts`.
They are updated in the lot that changes the code they cover.


## 6. Code changes (behaviour)

1. `graph-store.ts`: K7, K8, K9 as listed in §5.1–5.2; `buildEdgeRow(link, citySlug)`;
   `UpsertAtomicResult.reason` no longer has the cross-city case; `UpsertAtomicResult` gains
   `deletedStaleEdges` (edges of the city absent from the new graph, K8).
2. **Projection preparation extracted**: the part of `upsertGraphAtomic` that turns a
   `latest.json` into rows (`graphifyGraphSchema.parse`, `buildNodeRow`, `mergeNodeRows`,
   `buildEdgeRow`, `mergeEdgeRows`, `materializeSeveredSources`, `graph-store.ts:993-1004`) becomes
   an exported pure `prepareCityProjection(citySlug, graphJson)`. The projection, the repair, its
   preview and the measurement all use it, so a simulation is the projection, not a copy of it
   (peer A #9).
3. Guards (`findMissingBusinessProperties`, `findMissingSourceRefs`, `countCompleteSignals`,
   `graph-store.ts:571-830`): **unchanged**. They read the city's rows only; after the key change
   those rows can no longer receive another city's content.
4. Shared per-city write lock (K15): `upsertGraphAtomic`, `upsertGraph` and the repair take
   `pg_advisory_xact_lock(hashtext('graph-city:' || $city))` as the first statement of their
   transaction.
5. New pure helpers for the repair (§7): `indexS3Nodes` (per city, per id: docShas and business
   properties, from `prepareCityProjection`) and `classifyCityNodes(pgRows, s3Index, citySlug)`.
6. New `repairCityGraph(db, store, citySlug, s3Index, runId)`: the two-pass transaction of §7.2.

## 7. Repair — `api/src/scripts/repair-graph-city-key.ts`

### 7.1 Contract

- **Inputs**: `--apply` (absent ⇒ preview, read-only), city slugs (absent ⇒ refused: an explicit
  list is required, produced by the measurement of §9), `--run-id <token>` (default
  `graph-city-key-repair-<UTC>`).
- **Preconditions (refuse to start, exit 2)**: migration 0013 applied (PK of `graph_nodes` is
  `(city_slug, id)`, read from `pg_constraint`); in apply mode, the refresh CronJob suspended and no
  active refresh, backup, projection, recovery, mapper or repair Job — the `run-job.yaml` busy
  pre-check (`run-job.yaml:238-249`) is extended so that `radar-graph-city-key-repair`,
  `radar-graph-projection-only`, `radar-document-date-recovery` and `radar-run-geo-mapper` each list
  the others; the in-script check is the per-city lock of K15, which every graph writer takes.
- **Reads**: every `graph/<city>/latest.json` once, through `prepareCityProjection`, to build
  `indexS3Nodes` (ids, docShas, business properties; the memory profile of the dossier script);
  PG rows (nodes and edges) of the target city, inside the city transaction, under the lock.
- **Writes (apply only)**: S3 archive `graph-city-key-repair/<run-id>/<city>/pg-rows.json` (nodes,
  edges and `geo_*` rows of the city as read **under the lock in the same transaction**, plus
  sha256), written and read back before any PG write of that transaction; PG through the passes
  below. Never writes `graph/<city>/latest.json`. Run report
  `graph-city-key-repair/<run-id>/report.json` and a ≤ 4 KiB summary in the termination message (K12).
- **Output** per city: `{ city, classes: { clean, foreign, unknown }, pass1: { replaced, deleted }
  | refused, pass2: { nodeCount, edgeCount, deletedNodes, deletedEdges, deletedStaleEdges } |
  refused(reason), geoPurged, archiveKey }`. Exit 1 when any city is refused or errored, 0 otherwise.
  Per-city independence: a refused city never stops the others.

### 7.2 Per-city algorithm

Classification is **per node, against the same id**, and explains every loss against the
**initial** PG state (peer A #1, #2). For each PG node `(C, x)` let `S` = the row that
`prepareCityProjection(C, latest.json)` produces for `x` (absent if `x` is not in C's file), and
`loss(C, x)` = the docShas of the PG row absent from `S` plus the business properties
(`props.properties` keys with a value, same predicate as `findMissingBusinessProperties`) that `S`
lacks or holds with a different value.

- `clean`: `loss = ∅` (the three guards would accept this node).
- `foreign` (K11): `loss ≠ ∅` and there is **one** city `D ≠ C` whose `latest.json` row for the same
  id `x` contains every docSha and every property value of `loss` (the lost content is explained by
  D's file). The `proces-verbaux-<slug>/` path test is a secondary signal in the report only.
- `unknown`: anything else, including a loss partly explained (the legacy additive `upsertGraph`,
  `graph-store.ts:877-892`, keeps old refs under new properties and can produce a row whose refs are
  foreign and whose properties are local).

Then, inside **one** transaction per city, under the K15 lock:

1. Read PG rows of C, classify, write and verify the archive.
2. **Pass 1 — decontamination**: refused for the whole city (no write, city listed for manual
   review) if any node is `unknown`. Otherwise, for each `foreign` node: delete its row and its
   city-scoped `geo_*` rows; delete the city's edges incident to it.
3. **Pass 2 — projection** in a **savepoint**: the body of `upsertGraphAtomic` on the post-pass-1
   state (upsert, orphan nodes, stale edges K8, dangling edges, three guards). Because pass 1
   removed only rows whose every loss is explained by another city's file, a guard refusal here is
   a **local** loss (G5c, G6): the savepoint is rolled back and pass 1 alone is committed, i.e. the
   city is decontaminated but not re-aligned (intended partial result, reported).
4. `geo_*` rows of nodes deleted by pass 2 are purged (city-scoped). Commit.

Idempotence: a second run on the same city finds only `clean` nodes; pass 2 upserts identical
content with 0 deletions.

### 7.3 Preview

Preview runs steps 1–4 in a transaction that is always rolled back (no archive write), with the
real code path. Its report carries two verdict sets per city: **before** (the three guards against
the current PG state — must reproduce the dossier `sim.json` verdicts for the same cities and the
same S3 content) and **after** (the outcome of pass 1 + pass 2). Example: gore is
`refused (gate3-source-ref)` before (as in `sim.json`) and expected `pass` after (peer A #9).

### 7.4 CD jobs

- Manifests: `deploy/k8s/42-graph-city-key-repair-job.yaml` (prod) and its preprod twin
  `deploy/k8s/graph-city-key-repair/job.yaml`, modelled on `41-document-date-recovery-job.yaml`
  (label `component: graph-projection` for the network policy, `backoffLimit: 0`,
  `activeDeadlineSeconds` ≤ the ~3 h 45 between refresh windows, SCRAPE S3 binding, the manifest
  added to `SCRAPE_FILES` in `deploy/ci/check-object-storage-bindings.sh:13-17`). Not in
  `kustomization.yaml`. Same pattern for `graph-drift-measure` (K13), and a preprod twin of
  `32-graph-projection-only-job.yaml`.
- `run-job.yaml`: new options `graph-drift-measure`, `graph-city-key-repair`; inputs
  `repair_mode` (preview|apply), `repair_cities`, `mapper_cities`, `target_env` (K12); busy
  pre-check extended (§7.1); termination-message print.

### 7.5 Run order (each step outside refresh windows and 02:23 UTC, one job at a time)

Target list `L` (per environment) = cities with id drift (G2, G3, G4) **∪** cities with ≥ 1 node
`foreign` or `unknown` content (including cities whose id sets agree, e.g. fortierville in
`sim.json`, peer A #3) **∪** cities owning an id shared in S3 **∪** cities with `edgesNotInS3 > 0`,
minus nothing: G5c and G6 cities are included for pass 1 and expected `pass2 refused`.

| Step | preprod (`radar-immobilier-preprod`) | prod (`radar-immobilier`) | Gate to continue |
|---|---|---|---|
| P | PR-1 released (K12, K13) | same tag | `graph-drift-measure` runs in both namespaces |
| R0 | `graph-drift-measure` on pre-migration schema: baseline (sizes, NULL-city count for Q1, provisional list `L`) | same | report archived on #812 |
| R1 | check the five CD variables of K6 = true; release PR-2 through CD, outside windows | same; tag `vX.Y.Z` | migrate Job Complete (its postcheck holds the edge counts); served image = release; CronJob image = release digest (promote assert); backup object present |
| R1b | `refresh-suspend` (run-job); freeze graph-touching merges to main | `refresh-suspend` | CronJob `suspend: true` read back |
| R2 | `graph-drift-measure` | same | structural only: PK `[city_slug, id]`, `pgNullCity` = 0, `graph_edges_dangling_0013` count = migration log; the **authoritative list `L`** is recomputed here (refreshes between R0 and R1b change it) |
| R3 | `graph-city-key-repair` preview on `L` | same | before-verdicts reproduce the `sim.json` verdict for the same cities, any difference explained by S3 content added since 2026-10-04; after-verdicts: `pass` except listed G5c/G6; 0 `unknown`, or each `unknown` reviewed |
| R4 | `graph-city-key-repair` apply on `L` | same | report = preview |
| R5 | `document-date-recovery` apply, `recovery_heal=false`, cities whose pass 2 succeeded | same | 0 HALT, 0 abort |
| R5b | `mapper` (`mapper_cities` = `L`), then `snapshot` | same | jobs Complete |
| R6 | `graph-drift-measure`: acceptance (§9); then `refresh-resume` (run-job) and unfreeze main | same | all criteria of §9; CronJob `suspend: false` read back; first pass 0 `postgres-regression-refused` on repaired cities |

Prod starts only after R6 passes in preprod.

## 8. Date-recovery re-run

`recover-document-dates.ts` needs no change: it compares `latest.json` ids with
`subgraphForCity(db, city)` ids (C) and projects through `upsertGraphAtomic`. After R4, the id sets
of repaired cities are equal, so R5 writes dates (archive of `latest.json` first, as today) and
re-projects. `--heal` stays forbidden on these cities (dossier §6.1 point 3).

## 9. Acceptance measurement (same read-only tool)

`graph-drift-measure` (`api/src/scripts/measure-graph-drift.ts`, K13) carries the rules of the
dossier script `mesure-lecture-seule.mjs` (PR #815) with these changes only:

- keyed by `(city, id)` (no `id → city` map); the "owned by another city" exclusion in the
  completeness count is removed;
- the content check runs for **every** city, not only those whose id sets differ (the dossier script
  returns early at line 70 when ids agree);
- node classes `clean` / `foreign` / `unknown` computed with the repair's `classifyCityNodes`;
- edges: `edgesNotInS3` and `edgesMissingInPg` per city (PG edges of the city vs `latest.json`
  edges through `prepareCityProjection`);
- `pgPrimaryKey` (columns read from `pg_constraint`); refresh outcomes read from the S3 refresh
  receipts (`postgres-regression-refused` per city since a given time).

**Equivalence** (peer A #9): on a seeded database (integration test) and on preprod before
migration (R0), the fields common to v1 (`groups`, `perCity.group`, `foreignPg`, `foreignS3`,
`pgNullCity`, `drift`) are equal, except the documented expected differences: cities whose ids agree
but whose content is foreign appear in v2 only (listed), and `ca` changes for cities affected by the
removed exclusion (listed).

Acceptance after R6, per environment:

| Measure | Target |
|---|---|
| nodes `foreign` | **0** |
| nodes `unknown` | 0, or each listed and accepted by the owner |
| `foreignPg.nodes` (path rule of the dossier) | **0**, residuals explained by a slug mismatch listed |
| `foreignS3.nodes` | 0 (unchanged) |
| groups `G2G4-collision-refused`, `G3-S3-collision-only` | **0** |
| `edgesNotInS3`, `edgesMissingInPg` on cities whose pass 2 succeeded | **0** |
| groups `G5c`, `G6`, `G5ab`, `G1` | only the cities listed under D1/D4–D7, unchanged or reduced |
| `pgNullCity` | 0 |
| `pgPrimaryKey` | `[city_slug, id]` |
| first refresh pass after resume | 0 `postgres-regression-refused` for cities whose pass 2 succeeded |

## 10. Tests

Following `rules/testing.md` (`make test ENV=test-<slug>`, never `ENV=dev`).

Unit (`api/src/services/graph/graph-store.test.ts`, new `repair-graph-city-key.test.ts`):

- two cities with the same id → two rows, each with its own props and refs;
- edges with the same triple in two cities → two rows;
- dangling-edge purge in city A leaves city B's edges on the shared id; stale edges of the city
  absent from the new graph are deleted, other cities' edges untouched;
- `subgraphForCity` never returns an edge of another city; `subgraphForMrc` keeps both
  `(A, x)` and `(B, x)`;
- `classifyCityNodes`: clean / foreign / unknown, including (a) a foreign docSha that also appears
  on **another** id of C's file (must stay `foreign`, peer A #2), (b) local properties with foreign
  refs from the legacy merge (must be `unknown`, peer A #1), (c) a property-only contamination
  without docSha, (d) a slug that differs from the rawRef path;
- `repairCityGraph`: pass 1 refused on `unknown`; pass 2 refused → pass 1 still committed;
  idempotence; archive equals the replaced state;
- `prepareCityProjection` gives the same rows as the pre-refactor projection on existing fixtures.

Integration (Postgres test stack, `api/tests/integration/`):

- migration 0013 on a database seeded at 0012 with: shared ids, shared edge triples, dangling
  edges, a renamed PK constraint (drift), a held lock (must fail on `lock_timeout`), a NULL-city row
  (must raise);
- `geo_resolutions`: same node id in two cities resolving the same lot → two rows after 0013;
- the gore / barkmere scenario end to end (seed contaminated rows as today's code produces them,
  migrate, repair preview = expected before/after verdicts, apply, second repair no-op,
  `recover-document-dates --apply` without HALT); fortierville-like case (ids equal, content
  foreign);
- concurrency: a projection of the same city started during a repair waits on the K15 lock;
- down script: up → down → up with the real drizzle migrator (journal row removed by the down,
  `dialect.js` skips an already-recorded migration, peer A #6);
- `refresh-018.spec.ts`, `graph-signals-date-parity.spec.ts` green with the new key.

E2E (`make test-e2e ENV=e2e-<slug>`): MRC graph view renders two cities that share an id
(two nodes, correct edges, no duplicate-key error); Signals T1 and PDF overlay unchanged on a city
whose node was contaminated (fixture).

CI and manifests: `make k8s-validate ENV=ci` for the new job manifests; object-storage binding check.

## 11. Rollback

Policy (K16): **down-migration only before the first graph write after R1; forward-fix after.**

| Layer | Mechanism |
|---|---|
| Image | The CD image-only auto-rollback (`build-push-images.yml:1032-1042`, `ROLLBACK_ON_FAILURE_ENABLED`) never touches the DB. On 0013 the old image keeps **reading** (extra column, wider key) and its **writes fail closed** (`ON CONFLICT (id)` has no matching constraint): no data loss, graph frozen. Recovery = forward fix (re-run the release), not a DB restore. The post-rollout assert adds a graph check (one `GET /api/graph/<city>` and one `GET /api/graph-signals/<city>` 200) to the `/health` probe, which only runs `SELECT 1` (`api/src/db/client.ts:36`). |
| Refresh CronJob | `rollback.yml` only touches Deployments (`rollback.yml:4-8`). Order for any rollback: (1) `refresh-suspend`; (2) image rollback; (3) `graph-schema-down` if still allowed; (4) `refresh-resume` only after the CronJob image matches the image now served. |
| Schema, before any graph write after R1 | `api/drizzle/rollback/0013_graph_city_key.down.sql`, run by a reviewed one-shot Job through `run-job.yaml` (`graph-schema-down`, `target_env`; prod manifest `44-graph-schema-down-job.yaml` and its preprod twin), **after** the image rollback (the new image cannot run on the old schema; the old image reads the new schema and its writes fail closed): prechecks that ids are unique across cities and edge triples unique across cities (refuses otherwise); restores PK `(id)`, the edge triple key and indexes, re-inserts `graph_edges_dangling_0013`, restores the geo key; **deletes the 0013 row from `drizzle.__drizzle_migrations`** in the same transaction so a later release re-applies 0013. |
| Schema, after a graph write | the down refuses (duplicate ids exist as soon as one colliding city is projected). Rollback = DB restore from the CD pre-migration backup `db-backups/<env>-<sha>-<ts>.sql.gz` (`run-db-backup.sh:48,59`). FACT: no restore tool targets prod today (the bascule restore reads `pg/<D>/radar.dump`, preprod only), and a restore loses every write since the backup. Per the global backup rule, restore is operated by the immo tenant, not by this branch. Decision Q5. |
| Repair data | per-city S3 archive (nodes, edges, `geo_*`), taken under the lock in the repair transaction. No restore script (Q4): `latest.json` stays authoritative and a city can be re-projected at any time; the archive serves forensics and targeted restore. |
| S3 | never written by the repair; R5 archives `latest.json` as today. |

## 12. Risks

| Risk | Mitigation |
|---|---|
| NULL-city rows in prod | K2 precheck; R0 measures the count; owner decision if > 0 (Q1). |
| CD migrate disarmed | R1 gate on the three variables (K6). |
| Refresh CronJob on a mismatched image | five CD variables gated at R1; promote assert on the CronJob digest; suspension by `refresh-suspend` after R1 only; repair precondition re-checks the suspension (K6). |
| Lock queue on migration | `lock_timeout` (§4 step 0). |
| Misclassification of foreign content | per-node, same-id, loss-explained rule (K11); `unknown` refused; preview with before/after verdicts; preprod rehearsal. |
| Concurrent graph writer during repair | shared per-city advisory lock in every writer (K15); suspended CronJob; extended busy pre-check; archive read under the lock. |
| Legacy exploitation route writes during repair | it goes through `upsertGraph`, which takes the K15 lock. |
| No prod DB restore tooling | K16 forward-fix policy; Q5. |
| Unknown consumer of ids alone | inventory §5: none in routes, UI, MCP. |

## 13. Adversarial review log

Two independent peers, distinct lenses, seats only (no API key): **peer A** (Codex) — data
correctness and migration safety; **peer B** (Claude) — operations, repair, rollback, inventory
completeness. Round 1 verdicts: peer A **reject**, peer B **approve-with-changes**. Every finding
was checked against the code before being accepted.

### 13.1 Findings and reconciliation

| # | Peer | Severity | Finding | Resolution |
|---|---|---|---|---|
| A1 | A | blocker | Foreign refs do not prove foreign properties: legacy `upsertGraph` keeps old refs under new props (`graph-store.ts:877-892`). | Accepted. K11 rewritten: per node, every lost docSha **and** property explained by one other city's same-id row; else `unknown` → pass 1 refused (§7.2). |
| A2 | A | major | K11 tested docSha absence on all nodes of C, the guard tests the same id. | Accepted. Same-id classification; unit test (a) in §10. |
| A3 | A | blocker | Dossier script exits early when ids agree (fortierville case in `sim.json`). | Accepted. Measurement checks content for every city; list `L` includes content-only contamination (§7.5, §9). |
| A4 | A | blocker | Edges not reconciled from S3. | Accepted. K8: projection deletes the city's edges absent from the new graph; pass 1 deletes edges incident to foreign nodes; `edgesNotInS3` / `edgesMissingInPg` acceptance. Same as B6. |
| A5 | A | major | `geo_resolutions` key collides across cities (`match-refs.ts:231-237` allows another city's lot). | Accepted. Key widened in 0013 step 6; rebuild in R5b. Same family as B7. |
| A6 | A | blocker | Down then up is skipped by the drizzle migrator (journal). | Accepted. Down deletes the journal row; up→down→up integration test; edge-triple uniqueness precheck. Same as B5. |
| A7 | A | major | CD image auto-rollback without schema rollback; `/health` only `SELECT 1`. | Accepted. K16 forward-fix policy; graph check added to the post-rollout assert (§11). |
| A8 | A | major | Repair lock not taken by other writers; archive may differ from replaced state. | Accepted. K15 shared per-city advisory lock in every writer; archive read under the lock in the same transaction. Same as B8. |
| A9 | A | major | Equivalence and simulation criteria contradictory; simulation skipped `materializeSeveredSources`. | Accepted. `prepareCityProjection` shared by all; before/after verdicts; equivalence on common fields with listed expected differences (§7.3, §9). |
| B1 | B | blocker | Preprod unreachable from `run-job.yaml` (prod secret, hard-coded namespace, no `pods/log` for the preprod SA, no preprod projection twin). | Accepted. K12 rewritten (secret by `target_env`, termination message + S3 report, projection twin). |
| B2 | B | blocker | Measurement "in the pod by stdin" = manual `kubectl exec`. | Accepted. K13: CD job `graph-drift-measure`, TypeScript, shipped in a first PR so R0 runs pre-migration. |
| B3 | B | major | CD migrate is conditional on three variables. | Accepted. R1 gate (K6, §7.5). |
| B4 | B | major | Refresh CronJob image not guaranteed by the release; `rollback.yml` ignores it. | Accepted. CronJob suspended R1→R6, image checked before resume (K6). |
| B5 | B | major | Rollback neither operable nor verifiable (no job, journal, validity limit, no prod restore path). | Accepted. `graph-schema-down` job; journal; validity "before first graph write"; Q5 for prod restore. |
| B6 | B | major | Repair does not cover edges; list too narrow; no edge measure. | Accepted (see A4); list `L` widened. |
| B7 | B | major | Derived geo data omitted. | Accepted. K14 purge + `mapper` + `snapshot` (R5b). |
| B8 | B | major | No `lock_timeout`; busy lists not mutual; deadline sizing. | Accepted. §4 step 0; §7.1; §7.4. |
| B9 | B | minor | Plan scope paths and exceptions missing; §5.7 incomplete. | Accepted. Plan updated; §5.7 completed. |
| B10 | B | minor | R2 tolerance; receipts read path; `priority-resolver.ts:205-213` resolves edges by id in memory. | Accepted. Refresh suspended so no tolerance; receipts read by the measure job; priority-resolver noted in §5.2 (single-city input, no change). |
| N1 | B (round 2) | blocker | Suspending the CronJob by overlay PR fails `refresh-018.mk:174` verify-renders and the promote-prod assert (`build-push-images.yml:1438-1448`); the prod overlay is applied after migrate only. | Accepted. No suspension across the release; `refresh-suspend` / `refresh-resume` run-job options (`kubectl patch`, verb held by both CI roles) after R1; five CD variables gated at R1; main frozen in preprod R2→R6 (K6, §7.5, Q2). |
| N2 | B (round 2) | minor | R2 gate "counts = R0 − dangling" broken by refreshes between R0 and R1. | Accepted. R2 gate is structural; list `L` recomputed at R2 (§7.5). |
| N3 | B (round 2) | major | `mapper`, `snapshot` have no preprod twin; `snapshot` missing from K12. | Accepted. K12 extended; twins in the plan scope; `mapper_cities` in PR-1. |
| N4 | B (round 2) | minor | No preprod twin for the down Job; down vs image-rollback order unwritten. | Accepted. Twin added; order written in §11. |
| N5 | B (round 2) | minor | Multi-branch plan with one Allowed list and one ENV. | Accepted. Plan lists paths and ENV per branch. |

Round 2 (revision 3e6ce058): peer B **approve-with-changes** (B2, B3, B5, B6, B8, B9 resolved; B1, B4, B7, B10 partial or open through N1–N5, all accepted above). Peer A round 2: see §13.2.

### 13.2 Peer A round 2

_Pending at the time of this revision; recorded on the PR when received._

## 14. Open questions for the owner

| # | Question | Context and stakes | Default if not answered |
|---|---|---|---|
| Q1 | If prod has `city_slug IS NULL` rows, delete them, or attach them to a city? | The migration refuses while any exist (K2). Preprod: 0. Prod: `unverified`, measured by R0. | Release blocked until decided. |
| Q2 | Accept the suspension of the refresh CronJob from R1b to R6 (a few hours per environment, no new PV extracted meanwhile) and a freeze of graph-touching merges to main during the preprod run? | Needed so that no writer competes with the repair and the list `L` stays stable (K6, K15); preprod CD re-applies the CronJob on every push to main. The extraction cost of refused cities stops during the suspension. | Suspension and freeze. |
| Q3 | Repair scope: list `L` (§7.5), or also G1 cities in the same job (instead of the `projection` job of D1)? | D1 is a separate owner decision; the repair job would also handle G1 (pass 2 removes empty nodes). | G1 stays under D1. |
| Q4 | Keep the per-city S3 archive of PG rows without a restore script? | A restore script costs a lot; S3 `latest.json` is authoritative. | Archive only. |
| Q5 | After the first graph write following R1, accept "forward-fix only" (no DB restore path), or require first a documented prod restore exercise by the immo operator? | No restore tool targets prod today; a restore loses every write since the backup. Owner of backups: the immo tenant. | Forward-fix only, stated in the release PR. |
