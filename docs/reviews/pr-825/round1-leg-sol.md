status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/graph-city-key@c5d6809929a69b0ec9fb1269704e521903f6cf39
lens: reproduction-and-api-ui-regression

## Reasoning

Reviewed `git diff origin/main...c5d6809929a69b0ec9fb1269704e521903f6cf39` with HEAD fixed at that commit. `origin/main` resolved to `782d20c96c54e7035438aa6fdccdc4ccba82acf4`. Read the repository rules and revision 6 of `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md`, including its deviations and dry-run limits. This is an independent leg; no other review leg was read. The production counts in the assignment were treated as supplied facts, not independently measured. All runtime checks used the disposable `review-sol-825` Compose stack; no live cluster or remote object store was contacted.

The city-key change reproduces and fixes the reported collision. The recorded red run fails on the missing barkmere row, rather than an import, migration, or infrastructure error. I also executed the old store and old schema from `origin/main` against a scratch database migrated only through 0012: gore retained the only shared-id row, barkmere served zero nodes, and the shared edge carried barkmere's evidence. The branch's 23 targeted integration tests passed. Specifically:

- `api/tests/integration/graph-city-key.spec.ts:78` asserts two rows, each city's own label and evidence, and the second city's served node. `:94` checks the first city's subsequent projection, `:102` covers the legacy writer, and `:110` asserts separate edge rows and city-specific evidence. The test named “the gore case” uses two real cities of the same MRC; the repair suite supplies the actual gore/barkmere contamination shape.
- `api/tests/integration/graph-city-key-repair.spec.ts:120` first demonstrates that a plain projection still refuses an already contaminated row. That refusal is intentional: changing the PK alone cannot repair old content. `:127` checks preview classification and rollback, `:140` checks apply, restored gore content, a second no-op, and a subsequent regular projection; `:158` checks barkmere receives its missing node and edge. `:195` detects overwritten edge evidence and verifies re-alignment. Unknown and local-loss cases are refused without retaining writes (`:170`, `:183`).
- The four migration tests passed, including lock-timeout rollback, the drifted PK name, endpoint placement/deletion, accepting the same id/triple in two cities, and replay. No down-migration or archive is introduced.

I did not run the new repair test file unchanged on main: main has no repair module or its new exports. Such a run would fail during collection and would not establish the bug. The recorded failing test and my old-store/0012 scratch execution establish the relevant red behavior; the branch integration tests establish the green behavior.

The inspected HTTP and MCP contracts retain their paths and existing fields. I found no demonstrated regression in the graph/API/UI city identity changes:

| Surface | Code evidence and assessment |
|---|---|
| City graph | `api/src/routes/graph.ts:83` retains `/api/graph/:city` and its response envelope. `graph-store.ts:1382` selects the same node fields as before; edges gain `citySlug` at `:1406`. The edge filter requires both endpoints in the city's node set (`:1415`). |
| MRC graph | `/api/graph/mrcs` and `/api/graph/mrc/:mrc` remain at `graph.ts:35`, `:52`. `graph-store.ts:1475` uses `(citySlug,id)` endpoint keys; edges are fetched by their city at `:1480`. The new route test and the integration test retain both shared-id nodes and their separate edges. |
| Graph signals | `/api/graph-signals/by-city` and `/:city` remain at `graph-signals.ts:888`, `:911`; `getSignalNodesForCity` binds `citySlug` at `graph-store.ts:2204`. The response still includes node identity and city. Signal date-parity and both signal route suites passed. |
| Source coverage | `source-coverage.ts:702` and `:747` aggregate by city, with `GROUP BY city_slug` at `:718`, `:783`; they do not join graph rows on id alone. The route's 40 tests passed. |
| Data quality | `services/data-quality/summary.ts:119` loads city-scoped nodes; `:137` selects city-scoped edges and `:138` checks both endpoints. Its HTTP shape is unchanged; the three route tests passed. |
| Geo features | `services/geo/geo-features.ts:162` filters resolutions by city and `:182` also filters graph nodes by city when resolving ids. Geo routes and regulatory-status integration tests passed. The RESET omission is separately reported as SOL-825-03. |
| MCP | `packages/immo-mcp/src/data-source.ts:298` calls the same city-scoped graph-signals route and maps its nodes at `:321`. No graph-id-only lookup or changed tool signature was found. Its four suites / 64 tests and typecheck passed. |

`subgraphForCity` now builds a single `WHERE graph_edges.city_slug = $city` predicate (`graph-store.ts:1413`) instead of an OR predicate with one term per node. The new edge indexes lead with `city_slug` (`api/drizzle/0013_graph_city_key.sql:83`), so that predicate has an applicable index. It still uses two DB reads for a non-empty graph and an in-memory endpoint membership filter. This removes SQL construction and parameter growth with node count; I did not measure production latency or claim a throughput result.

For UI identity, `graph-client.ts:46` constructs a city/id key separated by a NUL. `MrcGraphView.svelte:165` stores that key, `:173` indexes by it, `:358` resolves each edge in its city, and `:390` keys the rendered nodes by it. Hover/focus identity uses the same key. Edge ids remain globally unique UUIDs; the fallback includes the city (`:357`). `CityGraphView.svelte:149`, `:275`, `:309` remains id-keyed within a single city, which is valid with the server's city scope. The 59 UI/client tests passed and Svelte typechecking found zero errors. These UI tests exercise helpers/client behavior, not mounted Svelte components or a browser; no browser execution is claimed.

A repository search traced `upsertGraphAtomic` callers in refresh, projection, date recovery, enrichment, auto-linking and purge; all pass a city string. The legacy exploitation caller passes a city to `upsertGraph`. `queryNeighbors` has no production caller; its callers/tests use the new city argument. The removed collision-result fields have no remaining production consumer. `buildNodeRow` itself retains its optional city argument; the two writers and `prepareCityProjection` supply their city. Workspace typechecking passed for API, UI, MCP and domain/source/scoring packages.

Operationally, offline execution of the workflow's actual Apply script with a local `kubectl` function verified both repair manifests, both mapper paths, suspend/resume read-back, refusal of apply/all and empty repair inputs, and refusal of an active mapper/repair before delete/apply. Rendered YAML had the expected target namespace, served image and arguments, with no new placeholder remaining. Listed mapper cities render `RESET=1`; empty mapper cities render an empty RESET. The runner refuses RESET without CITIES with exit 2, and its purge/rebuild calls use the same Drizzle transaction (`run-geo-mapper.ts:140`). That transaction is only reached for the selected `cityList`, which causes SOL-825-03.

Both workflows parse as YAML; all Bash run blocks pass `bash -n`. `workflow_dispatch` has exactly 10 inputs. Repair, projection, recovery and migration write bounded termination summaries; the workflow reads those summaries without requiring pod logs (`run-job.yaml:535`, `:547`, `build-push-images.yml:763`, `:1362`). The repair's summary/report handling has demonstrated failure paths described below. Apply relies on the operator performing the documented suspend/freeze sequence; the Apply branch itself has no CronJob-suspended assertion. No live RBAC, rollout or scheduled-job behavior was tested.

## Reproduction log

Commands below were run through RTK. Runtime commands went through Make with ENV last. Installation/provisioning noise is omitted from the excerpts. Temporary probe files and their full logs are under the ignored `tmp/review-sol-825/`; no tracked implementation or test file was changed.

**Target and recorded red evidence**

```text
rtk git branch --show-current
fix/graph-city-key

rtk git rev-parse HEAD
c5d6809929a69b0ec9fb1269704e521903f6cf39

rtk git rev-parse origin/main
782d20c96c54e7035438aa6fdccdc4ccba82acf4

rtk proxy rg -n 'expected|Received|cross-city-id-collision|exit=|Test Files|Tests ' docs/reviews/pr-825/repro-red-782d20c9.log
298:{"event":"graph-store:cross-city-id-collision","city":"barkmere","count":1,"collisions":[{"id":"__812_bylaw-242","ownerCitySlug":"gore"}]}
307:AssertionError: expected [ 'gore:242 (gore)' ] to deeply equal [ 'barkmere:242 (barkmere)', …(1) ]
328: Test Files  1 failed (1)
329:      Tests  1 failed (1)
342:exit=2
```

This existing log was read, not generated by this leg. Its assertion is the row/content bug, and corresponds to the current `toHaveLength(2)` plus per-city content assertions.

**Requested integration run**

```text
rtk make test-api SCOPE="tests/integration/graph-city-key" ENV=review-sol-825

✓ tests/integration/graph-city-key-repair.spec.ts (8 tests)
✓ tests/integration/graph-city-key.spec.ts (11 tests)
✓ tests/integration/graph-city-key-migration.spec.ts (4 tests)
  ✓ fails fast on a held lock (lock_timeout) and leaves the schema at 0012
Test Files  3 passed (3)
     Tests  23 passed (23)
Duration  15.12s
exit=0
```

**Type and UI checks**

```text
rtk make typecheck COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review-sol-825

API tsc, UI svelte-check, MCP tsc, domain/scoring/sources tsc completed
svelte-check found 0 errors and 7 warnings in 1 file
exit=0

rtk make test-ui SCOPE="src/lib/graph src/lib/components/reconciliation/CityGraphView.test.ts" COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review-sol-825

✓ src/lib/graph/graph-client.test.ts (12 tests)
✓ src/lib/components/reconciliation/CityGraphView.test.ts (17 tests)
✓ src/lib/graph/graph-client-mrc.test.ts (30 tests)
Test Files  3 passed (3)
     Tests  59 passed (59)
exit=0
```

The seven Svelte warnings refer to an unused exported property and CSS selectors in `SignauxSelPanel.svelte`; no error was reported in the reviewed graph components.

**Broader API/MCP regression run**

```text
rtk make -f Makefile -f tmp/review-sol-825/Makefile review-sol-825-regression ENV=review-sol-825

✓ src/services/graph/graph-store.test.ts (141 tests)
✓ src/services/graph/city-key-repair.test.ts (19 tests)
✓ src/scripts/repair-graph-city-key.test.ts (5 tests)
✓ src/routes/graph.test.ts (9 tests)
✓ src/routes/graph-signals.test.ts (20 tests)
✓ src/routes/graph-signals.sainte-martine-508.test.ts (1 test)
✓ src/routes/source-coverage.test.ts (40 tests)
✓ src/routes/data-quality.test.ts (3 tests)
✓ src/routes/geo-features.test.ts (7 tests)
✓ src/services/geo/regulatory-status-zone.integration.test.ts (2 tests)
✓ tests/integration/graph-signals-date-parity.spec.ts (5 tests)
Test Files  11 passed (11)
     Tests  252 passed (252)

✓ src/data-source.test.ts (14 tests)
✓ src/raw-data.test.ts (33 tests)
✓ src/server.test.ts (11 tests)
✓ src/server-http.test.ts (6 tests)
Test Files  4 passed (4)
     Tests  64 passed (64)
exit=0
```

The temporary Make target runs `npm run test --workspace=api -- <the 11 files above>` and then `npm run test --workspace=packages/immo-mcp` through `$(DOCKER_COMPOSE) $(COMPOSE_FILES_TEST) run --rm --no-deps -T api`. It uses the already installed disposable test volumes and exposes no host ports.

**Independent baseline, CLI, RESET and workflow probes**

```text
rtk proxy git show origin/main:api/src/services/graph/graph-store.ts | rtk sed -e 's|"../../db/schema.js"|"./baseline-schema.js"|g' -e 's|"../../db/client.js"|"../../api/src/db/client.js"|g' -e 's|"./vivier-v2.js"|"../../api/src/services/graph/vivier-v2.js"|g' > tmp/review-sol-825/baseline-graph-store.ts
rtk proxy git show origin/main:api/src/db/schema.ts > tmp/review-sol-825/baseline-schema.ts
rtk make -f Makefile -f tmp/review-sol-825/Makefile review-sol-825-probes ENV=review-sol-825

BASELINE 782d20c9 {"goreAborted":false,"barkAborted":false,"expectedRows":2,"actualRows":[{"city_slug":"gore","label":"242 (gore)"}],"barkNodes":0,"crossCityCollisions":[{"id":"__812_bylaw-242","ownerCitySlug":"gore"},{"id":"__812_zone","ownerCitySlug":"gore"}],"actualEdgeProps":{"refs":[{"docSha":"barkmere"}]}}

CLI missing snapshot: exit=0
{"event":"repair-graph-city-key:report","mode":"apply","runId":"review-sol-missing","missingLatestJson":["review-sol-missing"],"cities":0,"noop":0,"needsRepair":[],"committed":[],"pass":0,"refusedUnknown":[],"refusedGuard":[],"errors":[],"beforeRefused":[],"foreignNodes":0,"unknownNodes":0,"citiesWithForeign":0,"reportKey":"reports/graph-city-key/review-sol-missing/repair.json"}

CLI snapshot GET denied: exit=0
{"event":"repair-graph-city-key:report","mode":"apply","runId":"review-sol-get-denied","missingLatestJson":["review-sol-clean"],"cities":0,"noop":0,"needsRepair":[],"committed":[],"pass":0,"refusedUnknown":[],"refusedGuard":[],"errors":[],"beforeRefused":[],"foreignNodes":0,"unknownNodes":0,"citiesWithForeign":0,"reportKey":"reports/graph-city-key/review-sol-get-denied/repair.json"}

CLI report PUT denied: exit=0
{"event":"repair-graph-city-key:report","mode":"apply","runId":"review-sol-report-denied","missingLatestJson":[],"cities":1,"noop":1,"needsRepair":[],"committed":["review-sol-clean"],"pass":1,"refusedUnknown":[],"refusedGuard":[],"errors":[],"beforeRefused":[],"foreignNodes":0,"unknownNodes":0,"citiesWithForeign":0,"reportKey":"reports/graph-city-key/review-sol-report-denied/repair.json"}
logger: "err":"Error: AccessDenied: review injected report PUT failure", "msg":"repair-graph-city-key: report upload failed"

NODE CONTENT {"previewNoop":true,"previewVerdict":"pass","needsRepair":[],"applyNoop":true,"applyCommitted":true,"labelAfter":"new local label"}

MAPPER explicit city without current geometry: exit=0
MODE RESET — purge geo_resolutions + geo_unresolved par ville (1 villes)
Villes cibles :
Total : 0 villes
geo_resolutions (total DB) : 1
geo_unresolved  (total DB) : 1
MAPPER remaining {"resolutions":1,"unresolved":1}

MAPPER RESET without CITIES: exit=2; stderr=RESET=1 exige CITIES (jamais une purge de toutes les villes)
CLI wrong PK: exit=2; stderr=repair-graph-city-key: precondition failed — graph_nodes primary key is (id), expected (city_slug, id); run migration 0013 first

WORKFLOW inputs=10: job, target, backup_id, scrape_cities, scrape_chunk_size, project_cities, recovery_mode, recovery_heal, recovery_cities, recovery_image
WORKFLOW .github/workflows/run-job.yaml: YAML parsed; bash -n passed for 7 run blocks
WORKFLOW mock graph-city-key-repair/prod, mode=preview, cities=all, busy=false: exit=0
WORKFLOW mock graph-city-key-repair/preprod, mode=apply, cities=gore barkmere, busy=false: exit=0
WORKFLOW mock mapper/prod, mode=preview, cities=<empty>, busy=false: exit=0
WORKFLOW mock mapper/preprod, mode=preview, cities=gore barkmere, busy=false: exit=0
WORKFLOW mock refresh-suspend/preprod, mode=preview, cities=<empty>, busy=false: exit=0
WORKFLOW mock refresh-resume/prod, mode=preview, cities=<empty>, busy=false: exit=0
WORKFLOW mock graph-city-key-repair/prod, mode=apply, cities=all, busy=false: exit=1
WORKFLOW mock graph-city-key-repair/preprod, mode=preview, cities=<empty>, busy=false: exit=1
WORKFLOW mock graph-city-key-repair/prod, mode=apply, cities=gore, busy=true: exit=1
WORKFLOW mock mapper/preprod, mode=preview, cities=gore, busy=true: exit=1
WORKFLOW .github/workflows/build-push-images.yml: YAML parsed; bash -n passed for 48 run blocks
exit=0
```

Probe setup and limits:

- The probe target runs `node --import tsx tmp/review-sol-825/probes.mts` inside the Make-managed test container. It imports the reviewed source files, not a copy of the new implementation. It asserts that PG is `postgres` and object storage is the local `minio` service before proceeding.
- The old store copy changes import locations only. The scratch database is migrated with the current journal minus the `0013_graph_city_key` entry; it therefore runs the pre-fix store with its matching pre-fix schema. The scratch DB is dropped in `finally`. The probe expects the baseline's bad result to establish the failure mechanism; its overall exit 0 does not mean the baseline satisfies the two-row assertion.
- CLI invocations are child processes of the container's Node runtime. The missing-city case is `--apply --run-id review-sol-missing review-sol-missing` against local storage. For the GET failure, the child replaces `S3ObjectStore.prototype.get` with a function throwing `AccessDenied: review injected GET failure`; for the report failure, it replaces `prototype.put` with a function throwing `AccessDenied: review injected report PUT failure`. It then sets argv to the real repair script and imports it, invoking its actual `main`/exit path. No real permission change is performed.
- The node-content case starts with one local Bylaw node (`id=bylaw-242`, `type=Bylaw`, label `old local label`, no refs), previews/applies a prepared projection with label `new local label`, and reads the persisted label. The foreign index is empty, so this tests ordinary local evolution.
- The mapper case seeds one resolution and one unresolved audit row for `review-sol-no-geo`, with no active zone/lot versions, then runs the real mapper with `RESET=1 CITIES=review-sol-no-geo`. Both rows survive. All seeded PG rows are deleted in `finally`.
- Workflow probes parse YAML and pass the actual Apply script to Bash with a local `kubectl` function returning a served image, supplied active-job table, and suspend read-back. No Kubernetes command reaches a cluster. Successful renders are parsed and checked for target namespace, image, repair args, CITIES, RESET and absence of new placeholders.

**Required cleanup**

```text
rtk make clean COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review-sol-825
Container radar-review-sol-825-postgres-1 Removed
Container radar-review-sol-825-minio-1 Removed
Volume radar-review-sol-825_postgres-data Removed
Volume radar-review-sol-825_radar-test-root-node-modules Removed
Volume radar-review-sol-825_radar-test-api-node-modules Removed
Network radar-review-sol-825_radar Removed
exit=0

rtk make ps COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review-sol-825
NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
```

The test Compose files were explicitly selected for cleanup so its test dependency volumes were removed too. Before writing this leg, `git diff --exit-code` returned 0; the reviewed tracked code remained unchanged.

## Findings

### SOL-825-01 — Requested cities can disappear from the repair result while the job succeeds

- **Severity:** blocking.
- **File:line:** `api/src/scripts/repair-graph-city-key.ts:88`; also `:150`, `:177`, `:199`.
- **Evidence:** `readProjection` converts every GET exception to `null`, including access/configuration failures. Phase 1 records that city in `missing`, and phase 3 skips it entirely. Missing cities do not produce a `CityRepairReport`; the final exit decision counts only refused/error reports. The actual CLI returned exit 0 for an explicit missing snapshot and for an injected GET AccessDenied, with `cities:0`, `committed:[]`, `errors:[]`. The bounded termination summary at `:194` omits `missingLatestJson`, so the preprod summary presents zero errors without even the skipped-city list. The workflow treats a zero exit as Job Complete. A requested repair can therefore be reported successful without being attempted.
- **Fix:** distinguish a missing object from a GET failure, preserving the existing S3 error distinction (`isMissingObjectError`). Give every requested city an explicit result, count unavailable snapshots/read failures as errors, and return nonzero. Include missing/read-error counts in the termination summary. Add CLI tests for an explicit missing city and an access failure, including mixed success/error city lists.

### SOL-825-02 — Failed publication of the only durable repair report still produces a successful job

- **Severity:** blocking.
- **File:line:** `api/src/scripts/repair-graph-city-key.ts:190`; also `:194`, `:199`.
- **Evidence:** after the per-city transactions, the report PUT failure is logged and discarded; it does not affect the exit code or short summary. Injecting an AccessDenied into the real report PUT produced `report upload failed`, followed by exit 0 and a report summary advertising the unwritten `reportKey`. The short termination message includes counts but omits the committed/refused/error city lists. In preprod, where pod logs are unavailable, the workflow only has that short message and a reference to the missing full report (`run-job.yaml:547`). The operator cannot obtain the required per-city outcome from the advertised report even though the job is green; earlier successful city transactions have already committed.
- **Fix:** track report publication as a run-level error, expose `reportUploaded:false` and its error in the termination summary, and return nonzero on upload failure. Preserve the committed-city outcome in a usable bounded failure summary and require successful report publication before accepting the run. This is a reporting fix; do not roll back already committed cities or add a down-migration. Add a CLI test where repairs pass but report PUT fails.

### SOL-825-03 — RESET skips explicitly requested cities without current geometry and retains their old geo rows

- **Severity:** blocking.
- **File:line:** `api/src/services/geo/run-geo-mapper.ts:68`; also `:106`, `:140`.
- **Evidence:** `cityList` is always derived from active `zone_versions`/`lot_versions`, then filtered by CITIES. An explicit RESET city without active geometry never enters the loop, so neither its zero-signal purge nor its purge/rebuild transaction runs. I seeded one resolution and one unresolved row for a listed city with no active geometry and ran `RESET=1 CITIES=review-sol-no-geo`: the runner printed “1 villes” in RESET mode, then “Total : 0 villes”, returned 0, and both rows remained. This leaves stale derived rows after the requested repair/rebuild step. The new manifest/workflow selects RESET precisely to remove resolutions calculated from the pre-repair graph, so silently omitting a requested city defeats that step.
- **Fix:** in RESET mode, iterate the explicit, deduplicated CITIES list rather than intersecting it with cities having current geometry. Purge both tables for each requested city; if signals remain, resolve them in the same transaction and record unresolved results when geometry is unavailable. Keep the existing geometry-based enumeration for an unrestricted append-only run. Add a local integration case with a requested city whose last geometry version is absent/closed and stale geo rows remain.

### SOL-825-04 — `noop` ignores local node-content changes

- **Severity:** non-blocking.
- **File:line:** `api/src/services/graph/city-key-repair.ts:356`; consumer `api/src/scripts/repair-graph-city-key.ts:100`.
- **Evidence:** `noop` tests node/edge key drift, edge props, and foreign/unknown classes, but never compares the projected fields of clean nodes. A label-only local change is classified clean and passes the guards. My probe returned `previewNoop:true`, `needsRepair:[]`, and `applyNoop:true`; apply nevertheless changed the persisted label from `old local label` to `new local label`. Thus “would change nothing” and the measurement's selection of `needsRepair` are inaccurate for ordinary node-content drift. This probe does not establish a missed foreign classification, so I do not gate the city-collision fix on it.
- **Fix:** include node projected-content differences in the drift/no-op calculation using the existing `comparable`/`jsonEqual` helpers. Keep the clean/foreign/unknown classification and guard behavior unchanged. Cover at least a local label change and a refs enrichment with stable ids.

## Verdict

**NO-GO.** The composite-key implementation reproduces and fixes the collision, and all executed API/UI/MCP/type/migration checks passed. SOL-825-01, SOL-825-02 and SOL-825-03 block accepting the operational repair/rebuild path: a green run can skip required cities, lose its required report, or retain stale derived geo rows. SOL-825-04 is non-blocking. This verdict covers the reviewed commit and this leg's evidence; it makes no claim about a live rollout or agreement with other reviewers.
