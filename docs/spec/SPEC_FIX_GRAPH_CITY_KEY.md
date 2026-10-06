# SPEC — Graph city key `(city_slug, id)` and per-city repair from S3 (#812)

- **Status**: EVOL — committed design, **revision 6 (2026-10-05)**: round-5 review integrated
  (§14.4) and aligned with the implementation branch `fix/graph-city-key` (deviations in §15).
  Simplified after the owner decisions of 2026-10-04 (§3).
- **Date**: 2026-10-04 (revision 6: 2026-10-05).
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
  `origin/main` `128bde8b` unless marked `782d20c9` (main after #820); the current line numbers of
  the main `graph-store.ts` anchors are listed in §6.

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

PR #820 (merged, `782d20c9`, v1.2.10) added a temporary **node** protection (`… DO UPDATE … WHERE
graph_nodes.city_slug IS NOT DISTINCT FROM excluded.city_slug` in both writers, plus
`cross-city-id-collision` reporting): no new node contamination, but colliding cities do not receive
the node, and **edges** sharing a triple are still overwritten (`ON CONFLICT (src_id, dst_id, kind) DO
UPDATE SET props`). This spec is the definitive fix; it deletes the whole #820 path (No Legacy
Fallback, K7).

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
| Q4 | Per-city S3 archive of PG rows | **No archive.** | No archive of PG data in S3 (the repair writes only its run report); no dangling-edge archive table; no restore script. |
| Q5 | Rollback after the first graph write | **Forward-fix only.** The existing daily backup stays the only safety net, without new tooling. | No down-migration, no schema-down job, no rollback lot (§11). |

## 4. Design decisions (K1–K14)

Numbered `K` to avoid confusion with the dossier's D1–D7.

| # | Decision | Rationale |
|---|---|---|
| K1 | `graph_nodes` primary key becomes `(city_slug, id)`; `city_slug` becomes `NOT NULL`. | Matches S3 (one file per city). A PK column cannot be NULL. |
| K2 | Migration 0013 starts by **deleting** every edge incident to a NULL-city node, then the `graph_nodes` rows with `city_slug IS NULL`; the deleted count is raised as a `NOTICE` in the migrate Job log (owner Q1). | Preprod measured 0. No sentinel (it would recreate a shared id space). |
| K3 | `graph_edges` gets `city_slug text NOT NULL`; unique natural key `(city_slug, src_id, dst_id, kind)` replaces `graph_edges_natural_key_idx`; `graph_edges_src_idx` / `graph_edges_dst_idx` become `(city_slug, src_id)` / `(city_slug, dst_id)`. No foreign key to `graph_nodes`. | An edge belongs to the graph of one city (one `latest.json`). |
| K4 | Edge backfill in the migration: `city_slug` = city of the `src_id` node, else of the `dst_id` node (lookups unique while the old PK still holds, i.e. **before** the PK swap inside the same migration). Edges with neither endpoint present are **deleted** (count in the log). The backfill is a placement, not a provenance proof; correctness comes from the per-city edge reconciliation of K7 during the repair, and is measured (§9). | Dangling edges are never served. No archive (owner Q4). |
| K5 | **One migration**, `api/drizzle/0013_graph_city_key.sql`, hand-authored (like 0002/0003), in one transaction, `SET LOCAL lock_timeout = '10s'`; `schema.ts` aligned. The current PK name is read from `pg_constraint` (prod has a schema drift on `graph_nodes`, e.g. no `created_at`), never hard-coded. `geo_resolutions_natural_key_idx` gains `city_slug` (FACT `match-refs.ts:231-237` accepts another city's lot, so two cities with the same node id can resolve the same lot, and `resolve-refs.ts:111` drops the second insert). | Branch template: one migration max. Drift-safe. Fails fast instead of queueing an `ACCESS EXCLUSIVE` behind a refresh transaction. |
| K6 | Release: the CD runs backup → migrate → set-image → assert (`.github/workflows/build-push-images.yml:719-770`) **only when armed**. **Gate of R1**: `BACKUP_BEFORE_RELEASE_ENABLED`, `BACKUP_BEFORE_RELEASE_PROD_ENABLED`, `PREPROD_CD_ENABLED`, `REFRESH_CRONJOB_PREPROD_ENABLED`, `REFRESH_CRONJOB_PROD_ENABLED` read and recorded as `true` (FACT `:237`, `:688-692`, `:727-728`, `:974-988`, `:1285`, `:1319`, `:1403-1427`), and **both** `ROLLBACK_ON_FAILURE_ENABLED` (preprod, `:1039`) and `ROLLBACK_ON_FAILURE_PROD_ENABLED` (prod, `:1543`) recorded as `false` for this release (K13). Release outside refresh windows (05:17, 11:17, 17:17, 23:17 UTC, 1 h 30–2 h) and outside 02:23 UTC; an old pod issuing `ON CONFLICT (id)` between migrate and set-image fails inside its transaction (nothing written). The refresh CronJob is **not** suspended across the release (an overlay `suspend: true` fails `refresh-018.mk:174` in CI and the promote assert `:1438-1448`); it is suspended after R1 and resumed before R6 by new `run-job.yaml` options `refresh-suspend` / `refresh-resume` (`kubectl patch cronjob radar-refresh-pv`; verb `patch` held by both CI roles, `10-rbac.yaml:29-31`, `11-ci-deployer-preprod-rbac.yaml:100`). Preprod CD re-applies the CronJob on every push to main, hence the freeze (owner Q2) and the repair's suspension precondition. | One release, no data-loss window, no CI or promote conflict. |
| K7 | All writes use the city: nodes `ON CONFLICT (city_slug, id)`, edges `ON CONFLICT (city_slug, src_id, dst_id, kind)`, in `upsertGraphAtomic` **and** the legacy `upsertGraph`; `citySlug: null` removed from both signatures (branch `graph-store.ts:1008-1018` deleted); the whole #820 path is deleted (A-R5-6): `SAME_CITY_CONFLICT_GUARD`, `idsSkippedByCityGuard`, the id-only owner lookup `resolveCrossCityCollisions` (`782d20c9` `graph-store.ts:862`), `CrossCityIdCollision` and the `crossCityCollisions` result fields, their consumers in `project-graph-from-s3.ts` / `recover-document-dates.ts` and the workflow log grep, and the guard tests. Deletions are city-scoped on both tables (today the dangling-edge purge `graph-store.ts:1147-1156` deletes other cities' edges sharing an orphan id — FACT), and the projection **deletes the city's edges absent from the new graph**, as it does for nodes. | Same root cause; without the edge reconciliation, edges placed at the wrong city by K4 would survive. |
| K8 | Every read by id binds the city (inventory §6). API **paths do not change** (node-bearing routes are already `/:city`-scoped); `/api/graph/mrc/:mrc` adds `citySlug` on every edge and the UI keys nodes and edges by `(citySlug, id)`. Readers that select edges by city keep an explicit check that **both** endpoints are nodes of that city (`subgraphForCity`, `subgraphForMrc`, `loadDbSnapshot`): an edge placed by its dst endpoint at migration (K4) is never served (A-R5-2). | Ids visible to users and MCP stay identical (the main benefit of C). |
| K9 | Every graph writer (`upsertGraphAtomic`, `upsertGraph`, the repair) takes `pg_advisory_xact_lock(hashtext('graph-city:' \|\| city))` first in its city transaction, and reads the guard baseline (today read **before** the transaction, `graph-store.ts:1033-1036`), evaluates the three guards and mutates inside that same transaction, after the lock. | No writer can slip between the guard read and the write. |
| K10 | The repair is a **new script** `api/src/scripts/repair-graph-city-key.ts`, run by a new `run-job.yaml` job `graph-city-key-repair` (`recovery_mode` preview\|apply, `recovery_cities` slugs or `all` in preview, K12). Per city it is **one projection, one transaction, all or nothing**: the standard projection body of `upsertGraphAtomic`, whose three guards are evaluated against a **baseline = the city's current PG rows minus the proven-foreign rows** (K11). Foreign rows are then simply overwritten by the city's own S3 row or deleted as orphans, like any projection. If a guard refuses, the whole city transaction is rolled back and the city is reported untouched. | Foreign rows are what makes the guards refuse G2/G4 today; taking exactly those out of the baseline, and nothing else, lets the unchanged guards protect every local value and the local completeness. No partial state (peer A round 3 #1). |
| K11 | "Foreign" is a **per-node, same-id, loss-explained, anchored** rule on real values (revision 6, §15 R6-1). For PG node `(C, x)` let `S` be C's own row for `x` from `prepareCityProjection` (absent if `x` is not in C's file); `lost` = every **ref object** of the PG row absent from `S` (compared on all its fields: docSha, rawRef, citation/excerpt/quote/text, page, date), plus every other **projected field** absent from or different in `S`: `label`, `type`, `source_ref`, every root key of `props` and every `props.properties` value. A lost element is *explained* by city `D ≠ C` when it is present with the same value on node `x` of `graph/D/latest.json` (a lost ref must be **contained** in a ref of D: D's ref may carry fields added since, e.g. a recovered date). The node is **`foreign`** when one `D` explains every element of `lost` **and** the contamination is anchored: a lost ref carries a docSha that appears nowhere in C's file (nodes and edges). Equality of generic fields (label, type, properties) with another city's row is **not** an anchor (PR #825 review A825-01: a city's own guarded value can coincide with another city's row). It is **`unknown`** when a lost ref carries a docSha foreign to C's file but no single D explains all of `lost` (mixed or changed content); a city with any `unknown` node is **refused explicitly before any mutation**. Otherwise it is **`clean`**: `lost = ∅`, or no foreign anchor; the three unchanged guards treat the row exactly as in a refresh projection (a ref-less contaminated row whose loss a guard protects refuses the city, for review). `clean` is not equality: the measurement counts content drift separately (K14 `nodesContentDiff`). The `proces-verbaux-<slug>/` path test is a secondary signal only. | Round 4 classified any non-empty unexplained `lost` as `unknown`; every city whose own `latest.json` evolved after its PG projection was refused (label or description edits, refs re-dated by the 2026-10-03 recovery: most of G2/G4). Only the anchor proves contamination; a docSha alone still protects neither citation nor rawRef, hence full ref objects in `lost`. |
| K12 | Preprod through the existing `run-job.yaml` input **`target`** (`prod` \| `preprod`, #820, `782d20c9` `run-job.yaml:43`, `:109`, `:134`): it already selects the kubeconfig secret and namespace and keeps the positive/negative pre-flight checks (prod and preprod share the API-server host; the preprod credential must not create Jobs in prod). Extended to `graph-city-key-repair`, `mapper`, `refresh-suspend`, `refresh-resume` (preprod twins: `deploy/k8s/graph-city-key-repair/job.yaml`, `deploy/k8s/geo-mapper-preprod/job.yaml`; the projection twin `deploy/k8s/graph-projection-preprod/job.yaml` exists since #820). `workflow_dispatch` stays at 10 inputs: the repair reuses `recovery_mode` / `recovery_cities`, the mapper reuses `project_cities`. The preprod CI account has no `pods/log` (`11-ci-deployer-preprod-rbac.yaml:16,23,78-91`): every producer the gates need writes a ≤ 4 KiB summary to its **termination message**, printed by the workflow — `repair-graph-city-key.ts` (plus its full report in S3 `reports/graph-city-key/<run-id>/repair.json`), `project-graph-from-s3.ts`, `recover-document-dates.ts` and `db/migrate.ts` (A-R5-3, A-R5-5); both CD migrate steps print the migrate summary (`status: committed` or `failed-rolled-back` + NOTICE counts). | Preprod first through the same jobs, no manual cluster access, no new targeting framework. |
| K13 | Forward-fix only (owner Q5). No down-migration. The CD image auto-rollbacks (preprod `build-push-images.yml:1032-1042`, prod `:1538-1546`) are disarmed for this release through both variables of K6: once one colliding city is projected, the old image would mix cities (`subgraphForCity` selects edges by id alone, `graph-store.ts:1325`). The existing daily backup (02:23 UTC) and the CD pre-release backup stay the only DB safety net; no new tooling. | Owner decision; avoids an unsafe automatic image rollback. |
| K14 | **No separate measurement script** (revision 6, §15 R6-2): `graph-city-key-repair` in preview over every city (`recovery_cities=all` ⇒ `--all`, refused in apply) **is** the read-only measurement — per city: id drift (`idsMissingInPg`, `idsNotInS3`), node content drift (`nodesContentDiff`: same id, any projected field different in either direction, whatever the class — A825-02), edge drift (`edgesMissingInPg`, `edgesNotInS3`) **and edge content** (`edgesContentDiff`: same key, different props — A-R5-1), node classes and lists, before verdicts (the three guards against the full current rows) and repair verdicts, `noop`; summary: `needsRepair`, `committed`, `refusedUnknown`, `refusedGuard`, `errors`, `unavailable` (target cities without a readable `latest.json`: `not-found` \| `read-failed` \| `unreadable`). Exit 1 on any refused, errored or unavailable city, or when the S3 report upload fails (`reportUploaded: false` in the termination summary, which also carries the bounded city lists). Derived geo data of repaired cities are rebuilt by `mapper` with `project_cities` = those cities: per **requested** city (even without current geometry — SOL-825-03), one transaction purges `geo_resolutions` and `geo_unresolved` then resolves again (`RESET=1`, `run-geo-mapper.ts`); empty `project_cities` keeps the append-only run over every city. Consistency snapshots are rebuilt by the existing CronJob `35-consistency-snapshot-cronjob.yaml` (prod) or the `snapshot` job; no preprod snapshot twin. | One script, one job; `geo_*` tables are insert-only (`resolve-refs.ts:111`). |

## 5. Schema migration — `api/drizzle/0013_graph_city_key.sql`

Single transaction (drizzle `--> statement-breakpoint` markers, journal entry in
`api/drizzle/meta/_journal.json`):

0. `SET LOCAL lock_timeout = '10s'` (K5). On timeout the migrate Job fails and the CD stops before
   set-image; the release is re-run.
1. **NULL cities** (K2), before any node deletion: delete every edge **incident** to a NULL-city
   node (`src_id IN (…) OR dst_id IN (…)`; ids are still unique, so such an id belongs to no city),
   then `DELETE FROM graph_nodes WHERE city_slug IS NULL`; `RAISE NOTICE` with both counts.
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
6. **Postcheck**: `graph_nodes` count = before − deleted NULL-city rows; every remaining edge has a non-NULL city (at least one endpoint resolved at backfill time; edges with an absent endpoint are reconciled per city by the repair projection, K7); `graph_edges` count =
   before − deleted edges; raise on mismatch.

The counts are raised as `NOTICE`; `api/src/db/migrate.ts` logs every NOTICE and writes the bounded
termination summary of K12. The node/edge block is idempotent (skipped with a NOTICE when the PK is
already `(city_slug, id)`), every index statement is guarded.

`schema.ts`: composite PK, `citySlug` `notNull()` on both tables, new edge indexes; comments saying
"null = cross-city / global" removed. Duration: tables of tens of thousands of rows (size
`unverified`), expected seconds, inside the CD migrate poll of 600 s.

Other tables (FACT, `schema.ts` and `api/drizzle/*.sql`):

| Table | Holds a graph node id? | Change |
|---|---|---|
| `geo_resolutions` | `node_id` + `city_slug` | key widened (step 5); conflict target in `resolve-refs.ts:111`; rows of repaired cities purged and rebuilt by `mapper` reset (K14) |
| `geo_unresolved` | `node_id` + `city_slug` (audit, no unique key) | rows of repaired cities purged and rebuilt by `mapper` reset (K14) |
| `prospect_marks` | no (lot anchor) | none |
| `prospect_notes` (annotations) | no (`signal_id` → `signals.id` uuid, lot anchor) | none |
| `opportunities`, `opportunity_dossiers`, `constraint_hits` | no | none |
| `consistency_snapshots` | no (per city, rebuilt by `snapshot`) | none |
| `refresh_document_outcomes` | no (per document) | none |
| evidence / refs | inside `graph_nodes.props.refs` (jsonb) | moves with the node row |
| SQL views / materialized views | none on graph tables | none |

## 6. Inventory — every access to the graph tables

Legend: **ID** = keyed by id alone (must change) · **C+ID** = already binds the city · **C** =
city-only filter (no change needed beyond the key). Line numbers on `128bde8b`; on `782d20c9` the
`graph-store.ts` anchors moved to: `buildEdgeRow` 217, `upsertGraph` 914, `upsertGraphAtomic` 1074,
row preparation 1089, NULL-city branch 1106, guard baseline read 1130, node conflict target 1201, edge
conflict target 1230, dangling-edge deletion 1252, `queryNeighbors` 1336, `subgraphForCity` 1397,
`subgraphForMrc` 1465, `listCitiesWithSignalNodes` 2176. #820 also added `resolveCrossCityCollisions`
(862) and the `crossCityCollisions` consumers in `project-graph-from-s3.ts:151` and
`recover-document-dates.ts:176`: all deleted (K7).

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
| `graph-store.ts:1292-1333` `subgraphForCity` | nodes by city; edges `or(eq(srcId, id)…)` then filter dst | nodes C, edges **ID** (can return another city's edge whose ids both exist in the city) | edges `where city_slug = $city` (drop the giant `OR`), then keep only edges whose src **and** dst are nodes of the city (A-R5-2) |
| `graph-store.ts:1360-1395` `subgraphForMrc` | nodes `inArray(citySlug)`; edges `inArray(srcId, ids)`; `nodeIds` set by id | **ID** (ids of two cities of the MRC collapse) | edges `inArray(citySlug, citySlugs)`; endpoint check on `(city, id)`; response edges carry `citySlug` (K8) |
| `graph-store.ts:1416-1455` `listMrcs` | counts by city | C | none |
| `graph-store.ts:2071-2119` `listCitiesWithSignalNodes`, `getSignalNodesForCity` | signal nodes by city | C | none |
| `api/src/services/data-quality/summary.ts:119-138` `loadDbSnapshot` | nodes by city, edges `inArray(srcId, nodeIds)` | edges **ID** | edges by `city_slug`, both endpoints in the city's node set (A-R5-2) |
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
| `api/src/scripts/recover-document-dates.ts:119-138` | compares `latest.json` ids with `subgraphForCity` ids | C | #820 collision reporting removed (`782d20c9` `:113`, `:176`); termination summary (K12) |
| `api/src/scripts/project-graph-from-s3.ts:124` | `upsertGraphAtomic` per city | C | #820 collision reporting removed (`782d20c9` `:88`, `:151-160`); `deletedStaleEdges` reported; termination summary (K12) |
| `api/src/db/migrate.ts` | drizzle migrator, success/failure log only | — | logs NOTICEs, termination summary (K12, A-R5-3) |
| `api/src/services/geo/run-geo-mapper.ts`, `deploy/k8s/35-run-geo-mapper-job.yaml` | append-only resolution, image `:latest` | C | `RESET=1` per city (K14); image `__IMAGE__` resolved like the projection; preprod twin |
| `api/src/scripts/purge-avis-bylaws.ts:287`, `emit-graphify34-candidates.ts:130`, `graphify-34-enrich.ts:67` | `subgraphForCity` | C | none |
| `api/src/scripts/prove-refresh-signals.ts`, `reconcile-167-slugs.ts` | read-only / slug mapping | C | none |
| `deploy/k8s/39-export-graph-nodes-job.yaml:80-115` | read-only export by city | C | none |
| `scripts/cohorte-vivier-b/reproduce-cohort.ts` | offline dump reader | — | none |
| `deploy/k8s/36-db-migrate-job.yaml` | runs `dist/db/migrate.js` | — | runs 0013 |
| `docs/spec/reports/dossier-villes-ecart/preuves/diagnostic/mesure-lecture-seule.mjs` (PR #815) | `pgCityById` = `id → city` map (assumes unique ids); returns early when id sets agree (line 70) | **ID** | replaced by the repair preview over every city (K14, §9) |

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

Pure classifier and per-city transaction in `api/src/services/graph/city-key-repair.ts`; the script
is the CLI.

- **Inputs**: `--apply` (absent ⇒ preview: the real code path in a transaction that is always
  rolled back; no persistent PG write), explicit city slugs or `--all` (preview only: the
  measurement, K14), `--run-id` (default `graph-city-key-repair-<UTC>`; the workflow passes
  `graph-city-key-<target>-<run id>`).
- **Preconditions (exit 2)**: PK of `graph_nodes` is `(city_slug, id)` (read from
  `pg_constraint`); usage errors. The `run-job.yaml` busy pre-check refuses to start while a refresh,
  backup, projection, recovery, mapper or repair Job is active (the existing #820 check extended).
  In apply mode the refresh CronJob is suspended first (`refresh-suspend`, owner Q2); the per-city
  lock (K9) already serializes a refresh projection with the repair of the same city.
- **Reads**: object store = the recovery's (`getScrapeObjectStore`, docs bucket, SCRAPE binding).
  Phase 1: for each target city, its `latest.json` through `prepareCityProjection` and its PG rows;
  the ids whose PG content differs from the city's own S3 rows. Phase 2: every
  `graph/<city>/latest.json`, keeping only the same-id rows of those ids (memory bounded). Phase 3:
  per city, the PG rows **inside its transaction, after the K9 lock**.
- **Writes**: PG only for data. The only S3 object written is the **run report**
  (`reports/graph-city-key/<run-id>/repair.json`; the store refuses `latest.json` keys outside the
  guarded writer); a ≤ 4 KiB summary goes to the termination message.
- **Per city, one transaction, all or nothing** (K10):
  1. Take the K9 lock; read the city's PG rows and edges; classify each node (K11): `clean`,
     `foreign`, `unknown`; measure the drift (ids, edge keys, edge content).
  2. A city with any `unknown` node is refused here, before any mutation.
  3. Run the projection body (`projectCityInTransaction`, shared with `upsertGraphAtomic`) on
     `prepareCityProjection(C, latest.json)` with its three unchanged guards evaluated against
     **baseline = current rows minus `foreign` rows** (business-property and source-ref guards on the
     baseline, completeness counted on the baseline). `foreign` rows are overwritten by C's own row
     or deleted as orphans; edges are reconciled (upsert, dangling, stale).
  4. Any guard refusal (a local loss: G5c, G6) rolls back the whole transaction: the city is
     untouched and reported. Preview always rolls back.
- **Report per city**: `{ city, mode, drift: { s3Nodes, pgNodes, idsMissingInPg, idsNotInS3,
  nodesContentDiff, edgesMissingInPg, edgesNotInS3, edgesContentDiff }, classes, foreignNodes, unknownNodes, before,
  verdict: pass | refused-unknown | refused-guard | error, reason, applied, result, noop }`, where
  `before` = the three guards against the full current rows (comparable to the dossier `sim.json`).
  Summary: `needsRepair` (not `noop`), `committed` (applied), `refusedUnknown`, `refusedGuard`,
  `errors`, `beforeRefused`, node counts. Exit 1 when any city is refused or errors (a red run is
  expected while G5c/G6 cities are in the list); cities are independent.
- **Idempotence**: a second run finds only `clean` nodes, no drift (`noop: true`); the projection
  upserts identical content.
- **Geo data** are not touched by the repair: rebuilt after the date recovery by `mapper` with
  `project_cities` = the committed cities (K14).

### 7.3 CD jobs

- `deploy/k8s/42-graph-city-key-repair-job.yaml` (prod, SCRAPE binding, added to `SCRAPE_FILES` in
  `deploy/ci/check-object-storage-bindings.sh`) and `deploy/k8s/graph-city-key-repair/job.yaml`
  (preprod, `radar-docs-s3-credentials`); modelled on `41-document-date-recovery-job.yaml` (label
  `component: graph-projection`, `backoffLimit: 0`, `activeDeadlineSeconds: 5400`). Not in
  `kustomization.yaml`.
- `deploy/k8s/35-run-geo-mapper-job.yaml` gains `__IMAGE__` (resolved like the projection: pinned
  input or the served image, instead of `:latest`), `__MAPPER_CITIES__`, `__MAPPER_RESET__`; preprod
  twin `deploy/k8s/geo-mapper-preprod/job.yaml`.
- `run-job.yaml` (extends the #820 structure, still 10 inputs): options `graph-city-key-repair`,
  `refresh-suspend`, `refresh-resume`; preprod allowed for them and for `mapper`; image resolution
  and the busy pre-check extended to repair and mapper (and listing each other); termination-message
  print for repair, projection and recovery.
- `build-push-images.yml`: both migrate steps print the migrate termination summary (K12). No other
  CD change: the post-rollout graph probe of revision 5 is dropped (K13 already disarms the image
  auto-rollback for this release; the served-sha gates of #456/#458 prove the rollout).

### 7.4 Run order (outside refresh windows and 02:23 UTC, one job at a time)

Target list `L` (computed at R2 from the measurement) = cities with `needsRepair` (id drift, edge
drift or edge-content drift, `foreign` or `unknown` nodes) **minus G1** (owner Q3: G1 stays under
D1). G5c and G6 cities may be in `L`; they are expected to be refused and left untouched (they wait
for D6 and D7).

| Step | preprod (`target=preprod`) | prod (`target=prod`) | Gate |
|---|---|---|---|
| R1 | gate K6 checked (incl. both rollback variables `false`); release through CD | same; tag `vX.Y.Z` | migrate summary `status: committed` with NOTICE counts recorded; served image and CronJob image = release |
| R1b | `refresh-suspend`; freeze graph-touching merges to main | `refresh-suspend` | `spec.suspend=true` read back |
| R2 | `graph-city-key-repair` preview, `recovery_cities=all` (measurement) | same | PK `[city_slug, id]`, 0 NULL city (migrate summary); `L` = `needsRepair` minus G1 |
| R3 | `graph-city-key-repair` preview on `L` | same | before-verdicts match `sim.json` (differences explained by S3 content added since 2026-10-04); verdicts `pass` except listed G5c/G6 and `refused-unknown` cities, each reviewed |
| R4 | `graph-city-key-repair` apply on `L` | same | every city in exactly one list: `committed`, expected-refused (listed at R3), errored. Any unexpected refusal or error stops the run; a retry gets a fresh preview on the remaining cities only (committed cities are now `noop`) |
| R5 | on `committed` only: `document-date-recovery` apply, `recovery_heal=false`; any city aborted after its S3 write (PG refused) gets the city-targeted `projection` job, then a repair preview on it must be `noop`; then `mapper` with `project_cities` = `committed` (purge + rebuild); snapshot by its CronJob (prod) or the `snapshot` job | same | 0 HALT; aborts closed by `projection`; jobs Complete |
| R6 | `graph-city-key-repair` preview `recovery_cities=all` (acceptance §9); `refresh-resume`; unfreeze main | same | §9 criteria; `spec.suspend=false` read back |

Prod starts only after R6 passes in preprod.

## 8. Date-recovery re-run

`recover-document-dates.ts` keeps its logic (only the #820 reporting is removed and a termination
summary added): it compares `latest.json` ids with `subgraphForCity(db, city)` ids and projects
through `upsertGraphAtomic`. After R4 the id sets of committed cities are equal, so R5 writes dates
(archiving `latest.json` first, as today) and re-projects. `--heal` stays forbidden on these cities
(dossier §6.1 point 3). Known gap (A-R5-4): when the S3 write succeeds and the PG projection is
refused, a later recovery run sees no date to add and skips the projection; R5 therefore closes every
such abort with the city-targeted `projection` job (whose undated PG refs are `clean` under K11: same
docSha, no foreign anchor) and checks it with a repair preview (`noop`).

## 9. Acceptance measurement

The measurement is `graph-city-key-repair` preview over every city (K14), keyed by `(city, id)`, with
the content check run for **every** city (the dossier script returned early at line 70 when id sets
agreed), node classes from the classifier, id, edge and edge-content drift against
`prepareCityProjection`, before and repair verdicts. Refresh outcomes are read from the next refresh
pass (S3 receipts / `refresh_document_outcomes`).

Acceptance after R6, per environment:

| Measure | Target |
|---|---|
| nodes `foreign` | **0**, except in the listed refused cities (G5c, G6, `refused-unknown`), which stay untouched until D6, D7 or review |
| nodes `unknown` | 0, or each listed and accepted by the owner (its city stays refused and counts as a residual collision city) |
| `idsMissingInPg`, `idsNotInS3`, `nodesContentDiff`, `edgesMissingInPg`, `edgesNotInS3`, `edgesContentDiff` on committed cities | **0** (`noop: true`) |
| cities of `G2G4-collision-refused`, `G3-S3-collision-only` | **0**, except the listed refused cities |
| groups `G5c`, `G6`, `G5ab`, `G1` | only cities listed under D1/D4–D7 |
| NULL city | 0 |
| first refresh pass after resume | 0 `postgres-regression-refused` for committed cities |

## 10. Tests

`make test ENV=test-fix-graph-city-key`, `make typecheck` / `make lint` on a dedicated ENV, never
`ENV=dev`. `make test-e2e` is a placeholder in this repository (`Makefile:201-203`): no browser e2e
exists; the UI change is covered by unit tests (status `not covered` for a browser run).

Reproduction first: `two cities with the same node id keep two rows` fails on `origin/main`
`782d20c9` (only gore's row; the #820 guard skips barkmere's node) and passes on the branch.

Unit (`city-key-repair.test.ts`, `repair-graph-city-key.test.ts`, `graph-client-mrc.test.ts`,
`routes/graph.test.ts`): classifier clean / foreign / unknown — whole foreign row anchored on a
docSha foreign to the city's file; other city's ref enriched since (recovered date) still `foreign`;
docSha also cited elsewhere in the city's file is not an anchor; legacy merge with a lost local ref
→ `unknown`; foreign docSha no other city carries → `unknown`; changed property under foreign
evidence → `unknown`; ref-less whole-row contamination and foreign `sourceRef` only → `foreign`;
own evolution (label edit, partial coincidence) → `clean`; citation changed under an unchanged
docSha is a lost element; CLI argument contract and report summary; MRC route returns both
`(A, x)` and `(B, x)` with `citySlug` on every edge and drops an edge whose dst is absent from its
city; UI node key `(citySlug, id)` without duplicates, edges resolved in their city.

Integration (Postgres test stack, `tests/integration/graph-city-key*.spec.ts`): migration 0013 on a
scratch database migrated to 0012 and seeded with a drifted PK name, NULL-city nodes with edges on
one side, an edge without any existing endpoint, a cross-city edge and geo rows (PK, deletions,
placements, NOTICE counts, NOT NULL, same id and same triple accepted in two cities afterwards, geo
key widened); a held `ACCESS SHARE` lock makes the migration fail on `lock_timeout` with the schema
left at 0012; replaying the 0013 statements is a no-op. Store: two cities same id (atomic and legacy
writers); the gore case no longer refused; same edge triple in two cities; stale-edge and orphan
deletions and the dangling purge stay in the city; an edge whose src is absent is never served and
is deleted by the next projection; `queryNeighbors` and `subgraphForMrc` bind the city; a projection
waits for the per-city lock; `insertResolution` keeps one row per city. Repair: plain projection of
the seeded gore refused; preview predicts `pass` and writes nothing; apply re-aligns, second run
`noop`; barkmere receives its missing node; overwritten edge evidence detected (`edgesContentDiff`)
and re-aligned; a city with an `unknown` row refused before any mutation; a G5c-like local loss
refused by the unchanged completeness guard and rolled back. `migrate-idempotence.spec.ts` (drift
replay of 0013), `refresh-018.spec.ts` and the rest of the suite green.

Added after the PR #825 review: a local guarded value coinciding with another city's row is refused
by both the plain projection and the repair; node content drift of a `clean` row is measured and
re-aligned; CLI outcomes for a missing, unreadable or access-denied target and for a failed report
upload (exit 1, termination summary); `mapper` `RESET=1` purges a requested city without current
geometry, leaves other cities untouched and refuses to run without `CITIES` (script run as the Job).

Not covered by automated tests (`not covered`): `recover-document-dates --apply` after a repair, the
`run-job.yaml` branches (exercised by the preprod run), a real S3 listing for phase 2 (exercised by
the preprod R2 measurement).

CI: `make k8s-validate ENV=ci`; object-storage binding check.

## 11. Rollback

Forward-fix only (owner Q5, K13). No down-migration and no rollback job are built. The CD image
auto-rollback is disarmed for this release. The only DB safety net is the existing one: the CD
pre-release backup and the daily backup (02:23 UTC), operated by the immo tenant; no new tool. S3
`latest.json` is never written by the repair (only its run reports go to S3); R5 archives `latest.json` exactly as the recovery does today.

Operator branches (A-R5-7): a migrate Job that fails is rolled back whole (one drizzle transaction;
summary `status: failed-rolled-back`): the CD stops before set-image and the release is re-run
after the cause (e.g. a lock timeout) is cleared. An R4 city that errors or is refused unexpectedly
is untouched (its transaction rolled back): the run stops, the cause is analysed, and a retry runs a
fresh preview on the remaining cities only. Committed cities are never rolled back (forward-fix);
re-projecting a city from its `latest.json` remains possible at any time.

## 12. Risks

| Risk | Mitigation |
|---|---|
| CD migrate or CronJob update disarmed | R1 gate on five variables (K6). |
| Lock queue during the migration | `lock_timeout` (K5). |
| Old image after the first graph write | both auto-rollback variables `false` (preprod and prod); forward-fix (K13). |
| Misclassification of foreign content | per-node, same-id rule on full ref objects and property values, anchored on a docSha foreign to the city's file or on the whole other-city row; `unknown` refuses the city before any mutation; `clean` rows keep the three unchanged guards; one all-or-nothing transaction per city; before/repair verdicts; preprod rehearsal. |
| Edge evidence overwritten by another city (shared triple) | `edgesContentDiff` in the measurement puts the city in `L`; the projection rewrites edge props from `latest.json` (A-R5-1). |
| Recovery S3 write succeeded, PG projection refused | R5 closes it with the city-targeted `projection` job, checked by a repair preview (A-R5-4, §8). |
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
| A-R2-1 | A · 2 | blocker | Pass 1 deleted whole rows; a pass-2 rollback could drop a local part. | Superseded by A-R3-1: no separate pass 1, one all-or-nothing transaction. |
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

### 14.2 Round 3 (simplified revision `a36e28a1`)

Peer A: **reject**; A-R2-3 and A-R2-5 resolved, A-R2-1 and A-R2-4/A7 partial. All findings accepted
in revision 4:

| # | Severity | Finding | Resolution |
|---|---|---|---|
| A-R3-1 | blocker | Pass 1 could remove a local proof: a docSha protects neither citation nor rawRef (`graph-store.ts:585`, `:721`, `:764`). | K11 compares full ref objects and property values; K10 single all-or-nothing projection with a baseline minus proven-foreign rows, local completeness counted on that baseline; any unexplained local loss refuses the city. |
| A-R3-2 | major | Prod rollback uses `ROLLBACK_ON_FAILURE_PROD_ENABLED` (`build-push-images.yml:1543`). | K6/K13: both variables recorded `false`. |
| A-R3-3 | major | NULL-city edge deletion required both endpoints NULL. | §5 step 1: every incident edge (OR), before the nodes; postcheck on remaining edges. |
| A-R3-4 | major | Geo rebuild incomplete (`resolve-refs.ts:111`, `:129`). | `mapper` reset mode purges both geo tables per city after the date recovery, then resolves (§7.3, R5). |
| A-R3-5 | minor | "No S3 write" vs S3 report. | §7.2: only run reports are written to S3, never PG data. |

### 14.3 Round 4 (revision `31c03710`)

Peer A: **reject**; A-R3-2, A-R3-3, A-R3-4 resolved, A-R3-1 and A-R3-5 partial. All findings
accepted in revision 5 (this one), which has **not** been re-reviewed:

| # | Severity | Finding | Resolution |
|---|---|---|---|
| A-R4-1 | blocker | Keeping `unknown` rows in the baseline does not guarantee refusal: the guards check key presence, docShas and a count (`graph-store.ts:585`, `:721`, `:807`). | K11 / §7.2: a city with any `unknown` node is refused explicitly before any mutation. |
| A-R4-2 | major | Foreign `sourceRef` / root props could stay `clean` (`graph-store.ts:199-203`, `graph-signals.ts:253`). | K11 diff covers every projected field: `label`, `type`, `source_ref`, root `props` keys, refs, properties; used by the classifier and the measurement. |
| A-R4-3 | minor | Postcheck promised both endpoints resolved. | §5 step 6: at least one endpoint; edges with an absent endpoint reconciled per city by the projection; test added. |
| A-R3-5 (rest) | minor | §11 still said "S3 is never written by the repair". | §11 aligned: only run reports. |

### 14.4 Round 5 (revision `e1f5085b`, peer A = Codex `gpt-6-astra`, effort max, blind)

Peer A: **reject**; A-R4-1, A-R4-2, A-R4-3 and A-R3-5 **resolved**. No question needs an owner
decision. All findings accepted in revision 6 (this one) and implemented on `fix/graph-city-key`:

| # | Severity | Finding | Resolution |
|---|---|---|---|
| A-R5-1 | major | Edge content overwritten on a shared triple is invisible to key-presence drift. | K14 / §7.2 `edgesContentDiff` (same key, different props) puts the city in `L`; §9 target 0; integration test with a guarded node and an overwritten edge. |
| A-R5-2 | major | City-filtered edge reads drop the implicit src-existence check. | K8, §6.2: both endpoints required in `subgraphForCity`, `subgraphForMrc`, `loadDbSnapshot`; test with an absent src right after migration. |
| A-R5-3 | major | NOTICE counts have no collection path. | K12: `db/migrate.ts` logs NOTICEs and writes a termination summary (`committed` / `failed-rolled-back`); both CD migrate steps print it. |
| A-R5-4 | major | Recovery retry skips the PG projection after an S3-success/PG-refusal. | §8, R5: city-targeted `projection` job, checked by a repair preview (`noop`). |
| A-R5-5 | major | Jobs cannot supply the promised preprod reports. | K12: termination summaries in the repair, projection and recovery scripts; the workflow prints them. |
| A-R5-6 | major | Removing #820 needs more than the WHERE clause. | K7, §6: lookup, types, result fields, consumers, log grep and tests deleted. |
| A-R5-7 | minor | Mixed repair outcomes and retries need a runbook branch. | §7.4 R4/R5 (`committed` / expected-refused / errored, fresh preview on retry, R5 on `committed` only), §9 residual cities, §11 operator branches. |
| stale | — | #820 merged: `target` input, preprod projection twin, busy check, line numbers. | §1, K12, §6 intro, §7.3 reuse #820 as is. |

### 14.5 PR #825 review, round 1 (implementation `c5d68099`, two blind Codex legs)

Astra (`gpt-6-astra`, xhigh, correctness and migration): **NO-GO**; Sol (`gpt-6.1-sol`, xhigh,
reproduction and API/UI): **NO-GO**. Both confirmed the migration (Astra rehearsed it on a
prod-shaped database: 44 735 nodes / 49 148 edges kept, replay no-op, 4.4 s locally) and the
city-scoped store and readers; the blockers were in the repair and mapper paths. All accepted:

| # | Severity | Finding | Resolution |
|---|---|---|---|
| A825-01 | blocking | Whole-row equality without docSha anchor let a city's own guarded value be classified `foreign` and dropped. | K11: only a foreign docSha anchors; regression tests (unit + integration: plain projection and repair both refuse). |
| A825-02 / SOL-825-04 | blocking / non-blocking | `noop` ignored node content drift of `clean` rows. | `nodesContentDiff` in the drift, `noop`, `needsRepair` and §9; test preview → apply → no-op. |
| A825-03 / SOL-825-01 | blocking | An unreadable requested city vanished from the result with exit 0. | Per-city `unavailable` outcome (`not-found` / `read-failed` / `unreadable`), counted as errors, in the termination summary; CLI tests. |
| SOL-825-02 | blocking | A failed report upload still gave exit 0. | `reportUploaded` / `reportError` in the termination summary, exit 1; the summary carries the bounded city lists; CLI test. |
| SOL-825-03 | blocking | `RESET=1` skipped requested cities without current geometry. | RESET iterates the requested cities; integration test (purge without geometry, other cities untouched, refusal without `CITIES`). |

## 15. Revision 6 — deviations from revision 5 and open owner decisions

Implementation branch `fix/graph-city-key` (worktree `.worktrees/fix-812-city-scoped-pk`).

| # | Deviation | Why |
|---|---|---|
| R6-1 | K11 revised: `foreign` needs an anchor (a lost ref whose docSha is absent from the city's whole file; the whole-row-equality anchor of the first implementation was removed after PR #825 review A825-01); unexplained differences without anchor are `clean` and stay under the three unchanged guards; `unknown` = anchored but not fully explained by one city. Lost refs are matched by containment in the other city's refs. | With the round-4 rule every city whose own `latest.json` evolved after its last PG projection was `unknown` and refused: label or description edits, refs re-dated by the 2026-10-03 recovery (most G2/G4 cities). Containment keeps `foreign` detection after the other city's refs gained a date. JUDGEMENT, unit-tested case by case (§10). |
| R6-2 | No `measure-graph-drift.ts` / `graph-drift-measure` job: the repair preview over every city is the measurement. | One script, one job (owner: keep it simple); the measurement and the repair share the exact same classifier and projection. |
| R6-3 | Repair, projection, recovery and migrate write termination summaries; the workflow prints them. | Preprod has no `pods/log` (A-R5-3, A-R5-5). |
| R6-4 | `run-job.yaml` keeps 10 `workflow_dispatch` inputs: the repair reuses `recovery_mode` / `recovery_cities`, the mapper reuses `project_cities` (listed cities ⇒ purge + rebuild, no separate `mapper_reset` input). | The input limit of `workflow_dispatch` beyond 10 is `unverified` for this repository; an invalid workflow file would break every run-job dispatch, prod projection included. |
| R6-5 | The mapper manifest now pins `__IMAGE__` (served image or input) instead of `:latest`, and joins the busy pre-check. | The geo rebuild must run the image that writes the widened `geo_resolutions` key. |
| R6-6 | No preprod snapshot twin; no post-rollout graph probe in `build-push-images.yml`. | Snapshots are rebuilt by the existing CronJob; K13 disarms the auto-rollback for this release and the served-sha gates prove the rollout. |
| R6-7 | `refresh-suspend` / `refresh-resume` implemented as `run-job.yaml` options (patch of `radar-refresh-pv` read back). | Owner Q2; the per-city lock (K9) already serializes a refresh projection with the repair of the same city. |

Open owner decisions:

| # | Question | Options | Default if no answer |
|---|---|---|---|
| OD-1 | A G1 city (legacy lowercase nodes, D1) found with `foreign` / `unknown` rows or edge drift in the R2 measurement. | (a) keep it out of `L` until D1 (Q3 as written: it keeps serving another city's evidence); (b) include it: its repair deletes its legacy PG-only nodes exactly like the D1 `projection`. | (a) |
| OD-2 | Cities refused at R4 (`refused-unknown`, G5c, G6). | Accept them as listed residuals at R6 (§9) until review / D6 / D7, or block prod on them. | listed residuals |

Factual check before R4 (not a decision): `lascension` vs `lascension-de-notre-seigneur` are two
municipalities (`municipalities.qc.json:6126`, `:10897`); the R3 preview shows whether their
graphs explain each other's rows.

## 16. Dry-run of the repair (2026-10-05)

The repair's own dry-run is its preview mode; on prod it can only run after migration 0013 (R2/R3,
precondition PK `(city_slug, id)`). Before that, two checks were made without any prod write:

**Read-only prod counts (2026-10-06 01:21 UTC, `default_transaction_read_only=on`)** — expected
migration NOTICE and size:

| Measure | Value |
|---|---|
| `graph_nodes` / NULL-city nodes / cities | 44 735 / **0** / 1 010 |
| `graph_edges` / incident to a NULL-city node / without any endpoint | 49 148 / **0** / **0** |
| edges with exactly one endpoint present (placed by the existing one) | 26 |
| edges whose endpoints belong to two cities (placed at the src city) | 467 |
| nodes carrying a `proces-verbaux-<other city>` rawRef (path rule) | 170 nodes / 109 cities (164 / 109 on 2026-10-04) |
| table sizes | nodes 76 MB, edges 43 MB, geo_resolutions 312 kB |
| PK / journal | `graph_nodes_pkey (id)`, 12 journal rows |

Expected 0013 NOTICE in prod: 0 node and 0 edge deleted; the migration rewrites two tables of
tens of MB (seconds, inside the 600 s CD poll).

**Offline simulation of the classifier and guards** (bundled from the branch code, run locally on the
read-only snapshot of 2026-10-04 used by the dossier: 226 cities, S3 nodes + PG rows; no network).
Limits (`partial`): the snapshot's S3 nodes carry `id, label, type, refs, properties, status,
description` and its PG rows no `label` / `source_ref`, so the comparison is restricted to refs,
properties, status and description; candidate cities are limited to the 226; edges are not in the
snapshot (edge drift not simulated).

| Group | Cities | Plain projection refused today | Repair `pass` | Refused (expected) | `foreign` nodes | Missing ids inserted |
|---|---|---|---|---|---|---|
| G2 | 81 | 81 | 79 | 2 `refused-unknown` (rawdon `zone-rd-9`, saint-joseph-de-beauce `constraint-cptaq-lots`) | 121 | 1 834 |
| G3 | 49 | 0 | 49 | 0 | 0 | 159 |
| G4 | 18 | 18 | 18 | 0 | 26 | 16 |
| G5a | 3 | 3 | 0 | 3 `refused-guard` (completeness) | 0 | — |
| G5b | 1 | 1 | 0 | 1 `refused-guard` (completeness) | 0 | — |
| G5c | 2 | 2 | 0 | 2 `refused-unknown` (32 rows: local ref loss) | 5 | — |
| G6 | 1 | 1 | 0 | 1 `refused-unknown` | 0 | — |
| G1 | 71 | 0 | 71 (excluded, Q3) | — | 0 | — |

Cross-checks with the dossier: gore `bylaw-242` ← barkmere and fortierville `zone-m-04` ←
parisville are classified `foreign` exactly as diagnosed; the 1 834 (G2) and 159 (G3) missing ids
match the dossier counts. Total: 152 `foreign` nodes in 101 of the 226 cities; the remaining
contaminated cities of the path rule (109) are outside the snapshot and appear in the R2 measurement.

Expected list `L` at R2 (146 cities = G2 pass + G3 + G4; the R2 measurement on live data replaces
it): ayers-cliff barkmere beauceville berthier-sur-mer boischatel bolton-ouest bouchette campbells-bay champlain chartierville cheneville chute-saint-philippe clarenceville cleveland compton danville daveluyville denholm deschaillons-sur-saint-laurent donnacona eastman esterel farnham ferme-neuve fortierville gore ham-nord ham-sud hampstead havelock herouxville hinchinbrooke hudson huntingdon kingsey-falls la-minerve lac-du-cerf lac-edouard lac-superieur lac-tremblant-nord lambton lascension lepiphanie lisle-aux-coudres low melbourne mont-laurier montcerf-lytton neuville notre-dame-de-ham notre-dame-de-lourdes--joliette notre-dame-des-bois notre-dame-des-prairies notre-dame-du-sacre-coeur-dissoudun ogden parisville petite-riviere-saint-francois piedmont plessisville portneuf prevost riviere-beaudette rougemont saint-agapit saint-aime saint-albert saint-alexis saint-alexis-des-monts saint-andre-dargenteuil saint-anicet saint-antoine-de-lisle-aux-grues saint-augustin-de-desmaures saint-barnabe-sud saint-boniface saint-casimir saint-christophe-darthabaska saint-claude saint-colomban saint-come-liniere saint-denis-de-brompton saint-esprit saint-francois-xavier-de-brompton saint-gabriel-de-brandon saint-gabriel-de-valcartier saint-gilbert saint-guillaume saint-hyacinthe saint-jacques-de-leeds saint-jerome saint-leonard-daston saint-louis saint-lucien saint-ludger saint-mathieu-du-parc saint-norbert saint-patrice-de-beaurivage saint-paul-de-lile-aux-noix saint-pie saint-polycarpe saint-raymond saint-roch-de-richelieu saint-roch-ouest saint-rosaire saint-severin--mekinac saint-stanislas-de-kostka saint-tite-des-caps saint-valere saint-valerien-de-milton saint-zotique sainte-anne-de-la-perade sainte-anne-des-lacs sainte-brigide-diberville sainte-catherine-de-hatley sainte-catherine-de-la-jacques-cartier sainte-cecile-de-milton sainte-clotilde-de-horton sainte-croix sainte-emelie-de-lenergie sainte-felicite--lislet sainte-justine-de-newton sainte-marguerite-du-lac-masson sainte-marie sainte-petronille sainte-seraphine sainte-sophie-dhalifax sainte-therese-de-la-gatineau saints-anges salaberry-de-valleyfield scott shannon stoke stoneham-et-tewkesbury stratford terrasse-vaudreuil upton val-alain val-david val-joli val-racine vercheres waterville wentworth wentworth-nord westbury westmount windsor
