status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/graph-city-key@c4b32d24fcb5a50962940c89a006cf9193456708
lens: residual-fix-and-migration-replay

## Reasoning

Reviewed both requested targets at HEAD `c4b32d24fcb5a50962940c89a006cf9193456708`, branch `fix/graph-city-key`:

```sh
rtk git diff 143555c433153153f073dd3582218fb8224e62f1..c4b32d24fcb5a50962940c89a006cf9193456708 -- api deploy
rtk proxy git diff origin/main...c4b32d24fcb5a50962940c89a006cf9193456708
```

The whole-PR merge base is `782d20c96c54e7035438aa6fdccdc4ccba82acf4`; the local `origin/main` ref is `592b0dcbd3bca243302fda00b776ecb21a0d6724`. Read `rules/MASTER.md`, the applicable workflow/testing rules, `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md`, and the round-1/round-2 reports. No other round-3 review was read. All file:line references below refer to the requested HEAD. The existing staged review-file renames were left untouched.

The round-2 residual is fixed. The migration and repair passed the exercised database checks, including an independent rehearsal matching the supplied production counts. One non-blocking compatibility gap remains in offline snapshot comparison scripts, described in Findings. No blocking defect was demonstrated in the projection comparison, migration replay, or runtime city-scoped storage paths.

### Projected-content equality and convergence

- `api/src/services/graph/city-key-repair.ts:145` compares `type`, `label`, normalized `sourceRef`, and the entire `props` value using `jsonEqual`. `jsonEqual` at `:82` ignores object-key order, preserves array order, distinguishes null from absent and numbers from strings, and ignores undefined object members recursively. The comparison at `:332` is independent of the loss classifier. Its result enters `noop` at `:361`; `api/src/scripts/repair-graph-city-key.ts:121` derives `needsRepair` from non-noop reports.
- The comparison is against the prepared projection, not raw S3 nodes. `api/src/services/graph/graph-store.ts:854` parses the graph, builds rows, merges duplicate nodes/edges, and materializes severed sources before returning that projection. Schema parsing supplies the label default; `buildNodeRow` at `:174` supplies type/source defaults and derives `regulatoryStatus` at `:193`; source materialization adds refs and `sourceRef` at `:423`. These additions therefore occur on the comparison's expected side too.
- `projectCityInTransaction` writes those exact prepared fields at `graph-store.ts:1143`, replacing `props` and `source_ref` on conflict at `:1155`. It does not add another content key after preparation. PG's `created_at` default is outside the compared fields; the repair explicitly selects the compared fields at `city-key-repair.ts:311`. City and ID are established by the city predicate and ID map. The legacy writer's ref union is a different write mode; any resulting difference from the canonical projection is real drift, not an unavoidable representation difference in the repair writer.
- The added integration regression at `api/tests/integration/graph-city-key-repair.spec.ts:244` passed: `[A,B]` versus `[B,A]` gives `nodesContentDiff=1`, preview leaves `refs[0]` as A, apply changes it to B, and the next preview is a no-op. This matters at the serving boundary: `api/src/routes/graph-signals.ts:738` selects `refs[0]`, then uses its raw document reference at `:757` and citation/excerpt at `:774`.
- An independent real-PG probe passed for JSONB object-key normalization, nested null/empty containers, numbers versus numeric strings, finite large/small numbers, negative zero, Unicode, omitted optional fields, explicit undefined object members, derived regulatory status, materialized source refs, and duplicate collapse. All eight prepared nodes compared equal after their first write. Three deliberate content differences were then measured, preview preserved the original stored rows, apply aligned them, and the second preview returned `nodesContentDiff=0`, `noop=true`. No representation-induced repair loop was demonstrated for these inputs. Non-JSON programmatic values are not covered; the repair CLI reads JSON files.

### Runtime identity, guards and operational paths

The requested unfiltered inventory was run and retained in `.review-tmp/review3-astra-id-inventory.log`:

```sh
rtk proxy rg -n 'graph_nodes|graphNodes|graph_edges|graphEdges|node_id' api/ ui/ packages/ scripts/ deploy/ > .review-tmp/review3-astra-id-inventory.log
rtk proxy rg -n 'SAME_CITY_CONFLICT_GUARD|idsSkippedByCityGuard|resolveCrossCityCollisions|CrossCityIdCollision|crossCityCollisions|cross-city-id-collision' api ui packages scripts deploy .github
```

The second command returned no matches, exit 1. Inspection of ID lookups, joins, writers and consumers found:

| Path | Evidence at the target |
| --- | --- |
| Node and edge writes | Both node conflict targets bind `(citySlug,id)` at `graph-store.ts:988` and `:1155`; the shared edge writer binds `(citySlug,srcId,dstId,kind)` at `:1045`. Orphan-node, dangling-edge and stale-edge deletions bind the city at `:1173`, `:1182`, `:1191`, and `:1208`. |
| Per-city serialization and guards | `lockCityGraph` at `graph-store.ts:836` is used by legacy upsert (`:973`), projection (`:1123`) and repair (`city-key-repair.ts:308`). Projection reads its baseline after the lock (`graph-store.ts:1126`), checks row guards before writing (`:1135`), and throws on post-write completeness loss (`:1225`). Unknown repair rows are refused before projection (`city-key-repair.ts:365`). Preview throws after the real projection and rolls back (`:384`). The integration suite exercised lock waiting, local-loss refusal, unknown refusal and rollback. |
| Graph readers | Neighbors bind city for outgoing edges, incoming edges and node resolution (`graph-store.ts:1328`, `:1334`, `:1348`). City and MRC subgraphs select city-owned edges and check both endpoints in that city (`:1413`, `:1480`). Shared-ID tests passed for both cities, edge triples, deletions and MRC resolution. |
| Data quality / geo / proof report | `data-quality/summary.ts:125` and `:137` bind city and filter both endpoints. `geo/geo-features.ts:182` binds the graph lookup to the resolution's city. `geo/resolve-refs.ts:115` uses the widened geo conflict target. `scripts/report-opportunity-proof.ts:102` binds geo correlations, edge ownership and neighboring nodes to the source node's city. Mapper/populate/measurement node queries bind `city_slug`; consistency/source-coverage aggregates group by city. |
| API, UI and MCP | The graph routes remain city/MRC scoped. `graph-store.ts:2207` binds signal-node reads to city. MRC UI node keys, maps, edge resolution and hover use city-qualified keys (`MrcGraphView.svelte:165`, `:173`, `:357`, `:390`; `graph-client.ts:51`). Single-city UI maps remain within their city's response. MCP `searchSignals` calls the city URL (`packages/immo-mcp/src/data-source.ts:298`) and retains city in the result. UI/browser execution is not covered by this leg. |
| Offline exports and comparison tools | The export retains city, and cohort aggregation groups rows by city. `prove-refresh-signals.ts:52` selects all matching IDs and returns each matching row with its city; it does not overwrite colliding rows. However, `scripts/recette/diff-snap.py:26` and `dump-parity.py:32` overwrite them in ID-only dictionaries. Thus the assertion that every repository ID lookup carries city is **not** established; see ASTRA-825-R3-01. |

The whole-PR workflow/manifest changes were inspected: target-specific repair/mapper manifests, served/pinned image selection, apply-all refusal, expanded busy-job check, mapper RESET rendering, and termination-message collection (`.github/workflows/run-job.yaml:343`, `:367`, `:405`, `:438`, `:534`, `:547`). Both release migration paths print the termination summary before continuing or failing (`build-push-images.yml:759`, `:1358`). `api/src/db/migrate.ts:18` collects NOTICE messages and distinguishes committed from failed/rolled-back execution. Refresh suspension and disabling image rollback remain operational steps in the design; their live state is unverified. No cluster, remote bucket, live rollout or current CI run was queried.

Commands and observed test results, all on the isolated local environment:

```sh
rtk make test-api SCOPE="tests/integration/graph-city-key" ENV=review3-astra-825
```

```text
graph-city-key-repair.spec.ts       11 passed
graph-city-key.spec.ts              11 passed
graph-city-key-migration.spec.ts     4 passed
Test Files 3 passed; Tests 26 passed; exit 0
```

Additional tests used disposable Make targets in `.review-tmp/Makefile.astra`, running `npm run test --workspace=api` inside the existing test Compose container with its installed dependency volumes:

```sh
rtk make -f Makefile -f .review-tmp/Makefile.astra review3-astra-regressions ENV=review3-astra-825
rtk make -f Makefile -f .review-tmp/Makefile.astra review3-astra-probes ENV=review3-astra-825
rtk make object-storage-bindings-test ENV=review3-astra-825
```

```text
city-key-repair.test.ts             21 passed
repair-graph-city-key.test.ts       11 passed
migrate-idempotence.spec.ts          1 passed
geo-mapper-reset.spec.ts             2 passed
Regression total: 4 files, 35 tests passed; exit 0
Independent probes: 1 file, 6 tests passed; exit 0
docs zero-writer bindings: PASS=5 FAIL=0
ok: accepts the untouched fixture
storage binding suite: PASS=43 FAIL=0
hermetic storage migration suite: PASS=96 FAIL=0
binding target exit 0
```

Logs are `.review-tmp/review3-astra-regressions.log`, `review3-astra-probes.log`, and `review3-astra-bindings.log`. The independent source/config are `.review-tmp/review3-astra.spec.ts` and `review3-astra.config.ts`. The storage suite uses local fake storage commands; the repair report-upload probe mocks the store boundary. No Python command was executed. The prescribed API test run and these additional runs total **67 passing API/probe tests**. `git diff --check origin/main...c4b32d24fcb5a50962940c89a006cf9193456708` returned no output, exit 0.

## Previous findings

All seven rows were checked separately against the target code and the executed tests above.

| Previous finding | Status | Evidence at `c4b32d24fcb5a50962940c89a006cf9193456708` |
| --- | --- | --- |
| **A825-01** — generic whole-row equality accepted as a foreign anchor | **fixed** | `classifyNode` at `city-key-repair.ts:193` anchors only a lost ref whose docSha is absent from the city's whole node/edge-ref set. Other-city explanations alone do not suffice; unanchored rows return clean at `:216` and remain under the guards. The unit cases at `city-key-repair.test.ts:106`, `:136`, `:142`, and the real-PG coincident-local-property regression at `graph-city-key-repair.spec.ts:214` passed: no foreign exemption, guard refusal, local property retained. |
| **A825-02 / SOL-825-04** — clean-row content drift omitted from no-op/needsRepair | **fixed** | `city-key-repair.ts:332` measures exact content independently of class; `:361` includes it in no-op; `repair-graph-city-key.ts:121` selects non-noop cities. The label-only clean-row regression at `graph-city-key-repair.spec.ts:229` passed through preview, apply and second-preview no-op. The independent null/empty/type-drift probe also passed. |
| **A825-03 / SOL-825-01** — unreadable requested city vanished with exit 0 | **fixed** | `repair-graph-city-key.ts:98` distinguishes not-found/read-failed; `:107` reports malformed/schema-invalid input as unreadable. Both target read phases retain unavailable outcomes (`:190`, `:221`), report and termination output include them (`:129`, `:150`, `:227`), and `:244` counts them toward exit 1. Executed tests at `repair-graph-city-key.test.ts:84`, `:93`, `:101` passed for missing object, AccessDenied and invalid JSON. |
| **SOL-825-02** — failed report upload still exited 0 | **fixed** | `repair-graph-city-key.ts:237` records `reportUploaded=false` and `reportError`; `:242` emits them with bounded city lists; `:245` returns 1. Upload-failure and bounded-summary unit tests passed. The independent real-PG probe additionally committed a city, injected report PUT failure, and asserted exit 1, the persisted node, and `committed:["review3-astra-report"]` plus `reportUploaded:false` in the termination summary. |
| **SOL-825-03** — geo RESET skipped requested cities without current geometry | **fixed** | `geo/run-geo-mapper.ts:71` uses the explicit deduplicated city list for RESET independently of current geometry. Missing CITIES exits 2 at `:50`; zero-signal purge at `:117` and purge/rebuild at `:146` both use city-scoped transactions. Both integration cases at `geo-mapper-reset.spec.ts:55` and `:67` passed: no-geometry city purged, other city retained, missing-CITIES invocation refused. |
| **A825-02 residual, round 2** — refs order / null / empty containers invisible to measurement | **fixed** | `sameProjectedContent` at `city-key-repair.ts:145` uses the full JSON comparator, not `lostElements`. Unit regressions at `city-key-repair.test.ts:187` passed for reordered refs, null versus absent, empty containers and object-key order. The real-PG refs-order regression at `graph-city-key-repair.spec.ts:244` passed with drift 1, unchanged preview, aligned first ref after apply, and second no-op. Independent JSONB normalization/convergence probes passed as detailed above. |
| **SOL-825-05**, round 2 — invalid storage fixture made negative cases pass vacuously | **fixed** | `deploy/ci/check-object-storage-bindings.test.sh:29` copies the new repair manifest. `:51` asserts that the untouched fixture passes before mutations. Executed output explicitly says `ok: accepts the untouched fixture`; the suite ends `PASS=43 FAIL=0`, target exit 0. |

## Migration replay and deletion audit

### Ordering, locks, schema and replay

`api/drizzle/0013_graph_city_key.sql:17` sets `SET LOCAL lock_timeout = '10s'`. The block discovers the actual PK name and ordered columns from `pg_constraint` at `:31`. It recognizes the already-migrated key at `:39`; otherwise it locks both graph tables at `:45`. NULL-node incident edges are removed before those nodes (`:53`, `:57`). Edge placement uses source first, then destination (`:64`, `:67`), while the old ID-only node key still exists. The PK is replaced at `:92`, using the discovered constraint name quoted through `%I`. There is no inner COMMIT or concurrent-index operation.

The real Drizzle migrator is used by both the repository integration tests and the independent probes. Its all-pending-migrations transaction behavior was demonstrated by rolling back newly applied 0012 together with failing 0013, below. The existing held-lock integration case passed in 10,022 ms and left the renamed old PK intact. The existing statement replay test and `migrate-idempotence.spec.ts` both passed.

The index names and column order were queried after migration and asserted against `schema.ts:300`, `:331`, `:654`:

| Index / constraint | Columns |
| --- | --- |
| `graph_nodes_pkey` | `(city_slug, id)` |
| `graph_edges_city_natural_key_idx` | `(city_slug, src_id, dst_id, kind)` |
| `graph_edges_city_src_idx` | `(city_slug, src_id)` |
| `graph_edges_city_dst_idx` | `(city_slug, dst_id)` |
| `geo_resolutions_city_natural_key_idx` | `(city_slug, node_id, relation_type, target_id)` |

The redundant/old node-city, edge-natural/src/dst, and geo-natural indexes were asserted absent. The existing integration suite also inserted the same node ID, edge triple and geo resolution in two cities and rejected a duplicate edge within one city.

### Production-shaped preservation probe

Command: `rtk make -f Makefile -f .review-tmp/Makefile.astra review3-astra-probes ENV=review3-astra-825`.

The first probe created a scratch DB through migration 0012, renamed the PK to `review_drifted_pk`, dropped `graph_nodes.created_at`, and seeded 44,735 synthetic nodes across 1,010 cities plus 49,148 edges. It used exactly 26 one-endpoint edges (both missing-source and missing-destination directions), 467 cross-city edges, zero NULL-city nodes, and zero zero-endpoint edges. Every node and edge carried a distinguishable payload. Copies of the complete pre-migration rows were retained inside this disposable DB for SQL `EXCEPT` checks.

It then deleted the **0012 journal row only**, leaving 11 entries and the 0012 schema present, so the actual migrator had to replay 0012 and apply 0013 together. Output:

```json
{
  "before": {"nodes":44735,"edges":49148,"journal":12},
  "shape": {"edges":49148,"one_endpoint":26,"no_endpoint":0,"cross_city":467},
  "after": {"nodes":44735,"edges":49148,"journal":13},
  "audit": {"lost_or_changed_nodes":0,"lost_or_changed_edges":0,"placement_mismatches":0,"null_nodes":0},
  "elapsedMs":3882
}
```

```text
graph-city-key: nodes 44735 -> 44735 (deleted NULL-city nodes: 0); edges 49148 -> 49148 (deleted edges incident to a NULL-city node: 0, deleted edges without any existing endpoint: 0)
```

Every original node column and every original edge column/payload was preserved. The new edge-city column equaled `coalesce(source.city_slug,destination.city_slug)` for every edge. Cross-city and one-endpoint edges remained stored. Placement does not establish provenance; city readers require both endpoints and repair reconciles the assigned city's edges with its snapshot.

After migration, the probe inserted `n-1` in two additional cities, removed the **0013 journal row**, and reran the migrator. Result: `nodes=44737, edges=49148, journal=13`, with all three city-qualified copies of `n-1` still present and the already-composite-PK NOTICE. The pre-migration PK cannot hold several cities' copies of one ID; the S3-side small fixture below contains such a collision, and this post-migration insertion/replay tests the widened stored identity directly. Migration itself does not reconstruct previously overwritten/skipped nodes; that remains the repair projection's job.

This is a local structural/data-preservation rehearsal. Actual production payloads, S3 recoverability and production runtime are unverified; 3,882 ms is not a deployment timing estimate.

### What can be deleted, including PG-only data

The separate small fixture contained two city graphs sharing `bylaw-242` in its synthetic S3 map, three city-owned PG nodes, two NULL-city PG nodes, and seven PG edges. NULL-city nodes and the four deletion-class edges carried explicit `onlyInPg` payloads absent from that synthetic S3 map. This deliberately tests beyond the supplied production facts, which have zero such deletion candidates.

| Class | Before | After | Effect |
| --- | ---: | ---: | --- |
| City-owned nodes | 3 | 3 | Original data retained, including PG-only payloads. |
| NULL-city nodes | 2 | 0 | Deleted by `0013:57`, including their PG-only payloads. |
| Ordinary intra-city edge | 1 | 1 | Placed at Gore; original payload retained. |
| Cross-city edge | 1 | 1 | Placed at the source's city, Gore; original payload retained. |
| One-endpoint edge | 1 | 1 | Placed at its existing destination's city, Gore; original payload retained. |
| Edges incident to a NULL-city node | 3 | 0 | Deleted by `0013:53`, including PG-only payloads; the edge with two NULL-city endpoints is counted once. |
| Edge with neither endpoint present | 1 | 0 | Deleted by `0013:72`, including its PG-only payload. |
| Total nodes / edges | 5 / 7 | 3 / 3 | Journal 12 → 13. |

Observed NOTICE:

```text
graph-city-key: nodes 5 -> 3 (deleted NULL-city nodes: 2); edges 7 -> 3 (deleted edges incident to a NULL-city node: 3, deleted edges without any existing endpoint: 1)
```

Thus **a universal “0013 deletes no data” claim is false**. Its allowed deletion predicates can remove data absent from S3; the migration never consults S3 or archives those rows. This is the explicit Q1/K2 and Q4/K4 design, not a new implementation finding. Conversely, the supplied production shape has none of these deletion candidates, and the independent matching fixture lost zero rows or original payloads. Recovery of any actual deleted PG-only values from S3 is unknown without inspecting that data; it must not be inferred from the count postchecks.

### Unexpected-loss arithmetic and transaction rollback

Two independent fault injections started at **0011**, so both 0012 and 0013 were pending. An `AFTER UPDATE` trigger on `graph_edges` removed either one additional city-owned node or one additional ordinary edge during backfill. These trigger losses were outside the deletion counters. The migration produced:

```text
graph-city-key postcheck: graph_nodes 2 <> 5 - 2
graph-city-key postcheck: graph_edges 2 <> 7 - 3 - 1
```

For **both** probes, before and after were `nodes=5, edges=7, journal=11`; complete JSON snapshots of all original node and edge rows were equal. The renamed old PK remained `(id)`, `graph_edges.city_slug` remained absent, and the 0012 `refresh_document_outcomes` table and `refresh_outcome_status` type remained absent. This demonstrates the postcheck exception rolling back data, DDL and journal entries across both pending migrations.

The arithmetic at `0013:99` and `:102` therefore catches unexpected **net row loss** in these cases. It does not prove S3 recoverability, detect a same-count payload rewrite, or prohibit the explicitly counted deletions. Those are distinct properties.

Cleanup completed, exit 0 for each command:

```sh
rtk make clean ENV=review3-astra-825
rtk make clean COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review3-astra-825
rtk make ps COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review3-astra-825
```

Postgres/MinIO containers, the Postgres volume, both test dependency volumes and the project network were removed. The final `ps` displayed only its column header. Scratch databases and migration-folder copies were also removed by the probes. No application implementation was modified, committed or pushed; this report is the only review-owned tracked-path edit, and disposable review material is under `.review-tmp`.

## Findings

### ASTRA-825-R3-01 — Offline snapshot comparators still collapse different cities' nodes by ID

- **Severity:** non-blocking.
- **File:line:** `scripts/recette/diff-snap.py:26`; same issue at `scripts/recette/dump-parity.py:32`. The newly permitted stored identity comes from `api/drizzle/0013_graph_city_key.sql:92`.
- **Evidence:** Both loaders assign rows into a dictionary keyed by `id` alone: `out[obj["id"]] = obj` / `out[o["id"]] = o`. A later city's same-ID row replaces the earlier city's row before any comparison. The membership snapshot producer retains every input row and writes its city as `c` (`api/src/services/graph/recette-membership-snapshot.prod.test.ts:103`); it does not prevent this input. `diff-snap.py:38` compares only the retained dictionary values. `gate-candidate.sh:53` consumes its outgoing count and at `:56` fails only when that count is nonzero. Filtering the baseline to the candidate's set of cities at `:32` does not fix collisions when both cities are present.

  Concrete code-path counterexample, in file order:

  ```text
  old snapshot                         new snapshot
  {"id":"shared","c":"gore","f":16}   {"id":"shared","c":"gore","f":0}
  {"id":"shared","c":"barkmere","f":16} {"id":"shared","c":"barkmere","f":16}
  ```

  Each loader retains only Barkmere with `f=16`; the `bprime` comparison therefore has no outgoing row even though Gore left B′. The same last-row overwrite lets `dump-parity.py:62` conclude parity when only the earlier city's classification fields differ. This evidence is a deterministic source-path demonstration; the Python scripts were **not executed**, in accordance with the review constraint. The shell gate was also not executed.
- **Impact and scope:** This is a remaining compatibility gap for multi-city PG exports now allowed by the composite key, not a regression introduced by `872ffe2b`. It can conceal differences in the offline review tools. It does not affect the repair CLI's city-scoped drift measurement or the migration's tested preservation, so it does not block the requested repair rollout on this evidence. The blanket repository-wide claim that all ID lookups are city-qualified needs this exception.
- **Fix:** Key membership snapshots by `(c,id)` and projection dumps by `(citySlug,id)`, updating comparison/report iteration accordingly. Add fixtures with the same ID in two cities and a change only in the first city; require one named outgoing membership and a nonzero parity result respectively. No implementation change was made in this review.

## Verdict

**GO-with-nits.** All seven previous finding rows are fixed at the reviewed commit. The exact-content correction converged after real JSONB round trips; migration 0013 preserved the production-shaped fixture, replayed after journal drift, and rolled back all pending work when either loss postcheck failed. ASTRA-825-R3-01 is the one demonstrated non-blocking remainder in offline comparison tooling. Live deployment state, actual S3 recovery and production execution remain unverified.
