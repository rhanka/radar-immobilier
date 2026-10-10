status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/graph-city-key@c4b32d24fcb5a50962940c89a006cf9193456708
lens: reproduction-and-api-ui-regression-since-round-2

## Reasoning

Reviewed both mandatory targets at HEAD `c4b32d24fcb5a50962940c89a006cf9193456708`, branch `fix/graph-city-key`:

- `git diff 143555c433153153f073dd3582218fb8224e62f1..c4b32d24fcb5a50962940c89a006cf9193456708`, including all four code/test files changed by `872ffe2b`.
- `git diff origin/main...c4b32d24fcb5a50962940c89a006cf9193456708`. During this review `origin/main` resolved to `592b0dcbd3bca243302fda00b776ecb21a0d6724`; its merge base with the target is `782d20c96c54e7035438aa6fdccdc4ccba82acf4`.

Read AGENTS.md instructions, `rules/MASTER.md`, workflow/testing rules, harness review/test guidance, the design `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md`, and the permitted earlier-round reports. This leg is independent: no other round-3 leg was consulted and no peer was launched. No cluster or bucket was accessed. Execution used Make and the isolated local stack `review3-sol-825`. Only this leg file was edited outside `.review-tmp`; existing staged review-file renames were preserved. No commit or push was made.

The final comparison change addresses the demonstrated round-2 defect. `sameProjectedContent` compares type, label, nullable sourceRef and the complete projected props (`api/src/services/graph/city-key-repair.ts:145`). Its recursive JSON comparison ignores object-key order and undefined object keys while preserving array order (`:87`). `nodesContentDiff` uses this equality (`:332`), independently of the classifier's loss/containment rules. The drift contributes to `noop` (`:361`) and therefore to the summary's `needsRepair` (`api/src/scripts/repair-graph-city-key.ts:121`).

The new integration regression fails against a throwaway copy of the actual round-2 implementation and passes at the requested commit. A separate real-Postgres/real-route probe also confirms the consumer effect: preview preserves the first citation/PDF, apply changes both to the candidate's first ref, and the second preview reaches zero drift/no-op. Additional probes show that null/absent and empty-container differences converge after apply, and that correctly projected rows reach no-op after JSONB storage, duplicate collapse, label/type defaults, lifecycle-derived `regulatoryStatus`, and source materialization adding `linkSource`, refs and sourceRef. The prepared projection and writer share `prepareCityProjection` (`graph-store.ts:854`) and `projectCityInTransaction` (`:1106`); the latter stores node props verbatim (`:1159`). Created timestamps, generated edge UUIDs and city identity are outside the node-content comparison. No never-no-op regression was demonstrated for the tested JSON inputs.

The whole-PR checks also support the city-scoping change:

- Migration 0013 deletes incident NULL-city edges before their nodes (`api/drizzle/0013_graph_city_key.sql:53`), places remaining edges from src then dst while ids are unique (`:64`, `:67`), widens edge/geo keys and replaces the actual node PK (`:92`). The executed migration tests cover a drifted constraint name, lock timeout/rollback, counts/placement and replay. `migrate-idempotence.spec.ts` also passed. Schema declarations agree with the new keys (`api/src/db/schema.ts:300`, `:331`, `:654`). No production migration timing was measured in this leg.
- Both graph writers bind their conflict targets to the city (`graph-store.ts:988`, `:1045`, `:1155`) and acquire the per-city lock before baseline reads. Orphan, dangling and stale deletions bind the city (`:1173`, `:1182`, `:1191`, `:1208`). The integration assertions verify two own-content rows, two own-evidence edge triples, city-local deletion, and successful subsequent projection of the first city.
- HTTP paths and response envelopes remain in `api/src/routes/graph.ts:35`, `:52`, `:83`; nodes retain their existing ids, citySlug, type, label, props and sourceRef. Returned edges add citySlug. City/MRC reads require both endpoints in the edge's city (`graph-store.ts:1415`, `:1484`). `graph-signals.ts:915` still obtains city-filtered nodes through `getSignalNodesForCity` (`graph-store.ts:2197`); its evidence uses `refs[0]` (`graph-signals.ts:738`). Graph route, graph-signals and source-coverage tests passed.
- Source-coverage aggregates remain grouped by city (`api/src/routes/source-coverage.ts:718`, `:783`). Data-quality now reads city edges and checks both endpoints (`api/src/services/data-quality/summary.ts:137`, `:138`). Geo node enrichment binds both city and ids (`api/src/services/geo/geo-features.ts:182`); the geo integration test passed. The proof-report graph joins and resolution correlations bind the city (`api/src/scripts/report-opportunity-proof.ts:102`). Data-quality and the proof-report SQL were inspected statically; their changed paths were not separately exercised by a dedicated test in this leg.
- MCP remains on `/api/graph-signals/<city>` (`packages/immo-mcp/src/data-source.ts:298`). Normalization preserves the graph id and exposes the API city as the existing MCP field `city` (`:215`, `:216`). No MCP implementation change is present in the PR; MCP typecheck passed. A separate MCP runtime campaign was not run.
- MRC node lookup, keyed rendering and focus/hover use `(citySlug,id)` (`MrcGraphView.svelte:165`, `:173`, `:390`, `:392`), and edge endpoints use the edge's city (`:358`, `:359`). An actual component-render probe passed with four nodes sharing two ids across Gore and Barkmere, two distinct city-specific lines and isolated focus. CityGraphView's id-only keys (`CityGraphView.svelte:149`, `:309`) remain within one city returned by the city-scoped API. Graph-client types include edge citySlug (`ui/src/lib/graph/graph-client.ts:38`). Existing graph UI tests passed.
- The repair CLI's requested-city outcomes, upload failures, exit codes and bounded termination summary are covered by its unit suite and an additional real-DB/mock-store run. Projection/recovery remove the old collision-result consumers, report stale-edge deletion where applicable, and write termination summaries (`project-graph-from-s3.ts:179`, `recover-document-dates.ts:184`). Migrate logs NOTICEs and writes its summary (`api/src/db/migrate.ts:20`, `:32`). The CD prints both migrate summaries (`build-push-images.yml:763`, `:1362`). Real release variables, credentials and termination-message collection remain **unverified**.

## Previous findings

All evidence below is against `c4b32d24fcb5a50962940c89a006cf9193456708`; the seven rows distinguish the original content-drift finding from its round-2 residual.

| Finding | Status | Evidence at the final commit |
| --- | --- | --- |
| A825-01 — generic whole-row equality could erase a local guarded value | **fixed** | `city-key-repair.ts:193` requires a lost ref whose docSha is absent from the city's whole file; `:200` gates foreign classification on that anchor. The unanchored branch stays clean under ordinary guards (`:212`). Unit regressions at `city-key-repair.test.ts:106`, `:136`, `:142` and integration regression at `graph-city-key-repair.spec.ts:214` passed: coincident `nb_unites_max=4` is not foreign, repair is refused, and the property remains. |
| A825-02 / SOL-825-04 — clean-row content drift omitted from no-op/needsRepair | **fixed** | Exact content drift is counted at `city-key-repair.ts:332`, included in `noop` at `:362`, and surfaced in `repair-graph-city-key.ts:121`. The label-drift preview/apply/second-no-op regression at `graph-city-key-repair.spec.ts:229` passed. The additional route probe explicitly asserted inclusion in `needsRepair` for the reordered-ref case. |
| A825-03 / SOL-825-01 — unreadable requested city disappeared with exit 0 | **fixed** | `repair-graph-city-key.ts:102` distinguishes not-found/read-failed; `:107` records unreadable graph content. Both target read phases retain unavailable cities (`:191`, `:221`); reports and termination output include them (`:129`, `:150`), and `:244` counts them toward exit 1. CLI tests at `repair-graph-city-key.test.ts:84`, `:93`, `:101` passed for missing object, access denial and malformed JSON. |
| SOL-825-02 — report upload failure returned exit 0 | **fixed** | `repair-graph-city-key.ts:237` records failed upload; `:242` writes upload status/error in the termination summary; `:245` returns 1. Tests at `repair-graph-city-key.test.ts:108`, `:125` passed. The additional real-DB probe also verified exit 1 with `reportUploaded=false` while preserving the committed-city list after a completed apply. |
| SOL-825-03 — geo RESET skipped requested cities without current geometry | **fixed** | `run-geo-mapper.ts:71` derives RESET targets from deduplicated requested cities, independently of geometry. City-scoped purge happens for zero-signal cities (`:117`) and within the rebuild transaction (`:146`). Missing CITIES is refused with exit 2 (`:50`). Both script-level integration tests at `geo-mapper-reset.spec.ts:55`, `:67` passed: requested no-geometry city purged, other city retained, missing-CITIES refusal preserved data. |
| A825-02 residual, round 2 — unordered refs and null/absent/empty containers invisible to measurement | **fixed** | `sameProjectedContent` at `city-key-repair.ts:145` replaces classifier-loss comparison for drift. New unit tests at `city-key-repair.test.ts:189`, `:193` and integration test at `graph-city-key-repair.spec.ts:244` passed. That same integration regression, using only the round-2 repair module in `.review-tmp`, failed with `expected +0 to be 1`. Real-route probe: old drift=0/noop=true, final drift=1/noop=false; preview unchanged; apply serves citation B and PDF B; second preview noop=true. Null/absent, properties={} and refs=[] probes likewise converge after apply. |
| SOL-825-05 — storage-binding negative cases passed from an invalid fixture | **fixed** | The repair manifest is in FILES (`deploy/ci/check-object-storage-bindings.test.sh:29`); an untouched copied fixture is asserted to pass (`:51`). Executed suite: `PASS=43 FAIL=0`, including untouched fixture acceptance. A separate probe copied exactly FILES, observed baseline exit 0, removed only the repair manifest's SCRAPE_S3_BUCKET binding and observed a nonzero result with exactly its missing-bucket diagnostic. |

## Reproduction log

Commands below were run through `rtk`; ENV was always last in Make invocations. Output excerpts omit dependency installation and repetitive fixture logs. Throwaway sources/configs/Make targets and logs are under `.review-tmp/sol-*`.

**Original red evidence (read, not re-executed):** `docs/reviews/pr-825/repro-red-782d20c9.log` records the baseline reproduction at the whole-PR merge base:

```text
graph-store:cross-city-id-collision ... city=barkmere ... ownerCitySlug=gore
expected [ 'gore:242 (gore)' ] to deeply equal [ 'barkmere:242 (barkmere)', ... ]
Test Files  1 failed (1)
Tests       1 failed (1)
exit=2
```

**Required integration campaign at the final commit:**

```sh
rtk make test-api SCOPE="tests/integration/graph-city-key" ENV=review3-sol-825
```

```text
graph-city-key-repair.spec.ts     11 passed
graph-city-key.spec.ts            11 passed
graph-city-key-migration.spec.ts   4 passed
Test Files  3 passed (3)
Tests       26 passed (26)
exit 0
```

The assertions are substantive: `graph-city-key.spec.ts:78` requires two rows and each city's own label/refs; `:109` requires the first city's next projection not to be refused; `graph-city-key-repair.spec.ts:158` requires Barkmere's missing node to be inserted; `:195` detects/re-aligns overwritten edge evidence; `:244` measures reordered refs, checks preview rollback, checks refs[0] after apply and checks second-run no-op.

**Classifier/store/CLI, API contracts, geo RESET and migrator replay:**

```sh
rtk make test-api SCOPE="src/services/graph/city-key-repair.test.ts src/services/graph/graph-store.test.ts src/scripts/repair-graph-city-key.test.ts src/scripts/purge-avis-bylaws src/routes/graph.test.ts src/routes/graph-signals src/routes/source-coverage.test.ts src/services/geo/regulatory-status-zone.integration.test.ts tests/integration/geo-mapper-reset.spec.ts tests/integration/migrate-idempotence.spec.ts" ENV=review3-sol-825
```

```text
city-key-repair.test.ts          21 passed
repair-graph-city-key.test.ts    11 passed
graph-store.test.ts             141 passed
geo-mapper-reset.spec.ts          2 passed
Test Files  12 passed (12)
Tests       264 passed (264)
exit 0
```

**Round-2 red regression, without changing tracked implementation files:**

```sh
rtk proxy git show 143555c433153153f073dd3582218fb8224e62f1:api/src/services/graph/city-key-repair.ts > .review-tmp/sol-round2.ts
rtk sed -i 's|"../../db/|"../api/src/db/|g; s|"./graph-store.js"|"../api/src/services/graph/graph-store.js"|g' .review-tmp/sol-round2.ts
rtk sed -e 's|"../../src/|"../api/src/|g' -e 's|"../api/src/services/graph/city-key-repair.js"|"./sol-round2.js"|g' api/tests/integration/graph-city-key-repair.spec.ts > .review-tmp/sol-regression-old.spec.ts
rtk make -f Makefile -f .review-tmp/sol.mk review3-old-regression COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review3-sol-825
```

Only import locations were changed in these throwaway copies. The Make target runs Vitest on that copy with `-t 'A825-02 round 2'`:

```text
FAIL ... A825-02 round 2: reordered local refs ... are measured and re-aligned
expected +0 to be 1 // Object.is equality
Test Files  1 failed (1)
Tests       1 failed | 10 skipped (11)
make exit 2 (expected red)
```

**Independent final-vs-round-2 API and projection round-trip probes:**

```sh
rtk make -f Makefile -f .review-tmp/sol.mk review3-api-probes COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review3-sol-825
```

```text
old-v-current-ref-order:
  old:     nodesContentDiff=0, noop=true
  current: nodesContentDiff=1, noop=false
  before: citation a, raw/proces-verbaux-review3-sol-probe/cas/<64 a>.pdf
  after:  citation b, raw/proces-verbaux-review3-sol-probe/cas/<64 b>.pdf
  secondPreviewNoop=true
{"probe":"json-roundtrip","rows":7,"materialized":1,"noop":true,"nodesContentDiff":0,"edgesContentDiff":0}
null-vs-absent, properties={}, refs=[]: old drift=0, current drift=1, apply -> noop
CLI apply=0, preview-noop=0, failed-upload=1; committed cities retained
Test Files  1 passed (1)
Tests       4 passed (4)
exit 0
```

These use real local PostgreSQL and the actual graph-signals route. All object-store calls are mocked; enrichment-read errors are intentional unavailable-object responses. The JSON round-trip fixture includes nested objects/arrays/nulls/empty containers, finite numbers, a numeric string, a JSON-omitted undefined key, missing node defaults, duplicate refs, lifecycle enrichment, and a raised Signal receiving materialized source fields.

**UI campaign and actual MRC component probe:**

```sh
rtk make test-ui SCOPE="src/lib/graph src/lib/components/reconciliation/CityGraphView.test.ts" COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review3-sol-825
rtk make -f Makefile -f .review-tmp/sol.mk review3-ui-probe COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review3-sol-825
```

```text
CityGraphView.test.ts      17 passed
graph-client.test.ts       12 passed
graph-client-mrc.test.ts   30 passed
Test Files  3 passed (3)
Tests       59 passed (59)
exit 0

MRC component: 4 nodes, 2 city-specific lines, shared-ID focus isolated
Test Files  1 passed (1)
Tests       1 passed (1)
exit 0
```

The initial throwaway component probe failed because it looked for an Argenteuil button; the actual picker is a select and auto-loads its first MRC. Correcting that probe assumption, without changing product code, produced the result above. Browser E2E is **not covered**.

**Workspace typecheck and lint:**

```sh
rtk make typecheck COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review3-sol-825
rtk make -f Makefile -f .review-tmp/sol.mk review3-lint COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review3-sol-825
```

```text
svelte-check found 0 errors and 7 warnings in 1 file
API, MCP, domain, scoring, sources typechecks: exit 0
workspace ESLint: exit 0
```

The warnings concern unused exported property/CSS in `SignauxSelPanel.svelte`. The throwaway lint target runs the workspace's `npx eslint .` in the Make-managed container with only `.review-tmp/**` excluded, so review probe sources are not treated as product code.

**Storage bindings, mutation-specific rejection and offline operations:**

```sh
rtk make object-storage-bindings-test ENV=review3-sol-825
rtk make -f Makefile -f .review-tmp/sol.mk review3-bindings-probe ENV=review3-sol-825
rtk make -f Makefile -f .review-tmp/sol.mk review3-workflow ENV=review3-sol-825
rtk make k8s-validate K8S_VALIDATE_WITH_CLUSTER=0 ENV=review3-sol-825
rtk proxy git diff --check origin/main...c4b32d24fcb5a50962940c89a006cf9193456708
```

```text
docs zero-writer bindings: PASS=5 FAIL=0
ok: accepts the untouched fixture
PASS=43 FAIL=0
PASS=96 FAIL=0
exit 0

untouched copied fixture: exit 0
FAIL: deploy/k8s/42-graph-city-key-repair-job.yaml missing SCRAPE_S3_BUCKET
mutated fixture: nonzero exit, exactly its missing SCRAPE_S3_BUCKET diagnostic
probe exit 0

workflow Apply and Wait: bash -n exit 0
prod repair preview-all and apply-listed: PASS
preprod repair preview-all and apply-listed: PASS
repair apply-all refused before delete/apply: PASS
mapper listed cities renders RESET=1: PASS
active radar-graph-city-key-repair refused before delete/apply: PASS
active radar-run-geo-mapper refused before delete/apply: PASS
refresh suspend/resume mock patch and readback: PASS
Wait returns 0 on succeeded=1 and 1 on failed=1: PASS
exit 0

[k8s-validate] structural check (every doc has apiVersion + kind)…
[document-date-recovery] offline render ok (preprod + prod)
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
exit 0

git diff --check: no output, exit 0
```

`object-storage-bindings-test` runs the requested `bash deploy/ci/check-object-storage-bindings.test.sh` through the repository Make target. The separate mutation probe copies the suite's exact FILES list, first verifies its baseline, then removes only the repair bucket binding and requires exactly one matching failure. Workflow probes extract the current Apply/Wait shell blocks, replace kubectl with a local function and test rendered args/namespaces, pre-delete refusals and terminal status handling. No real kubectl operation is executed.

**Required cleanup:**

```sh
rtk make clean COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review3-sol-825
```

```text
postgres and minio containers removed
radar-review3-sol-825_postgres-data removed
radar-review3-sol-825_radar-test-root-node-modules removed
radar-review3-sol-825_radar-test-api-node-modules removed
radar-review3-sol-825_radar network removed
exit 0
```

Final `git diff --name-only HEAD -- api ui .github deploy` produced no output. Execution did not modify implementation files.

## Findings

No additional blocking or non-blocking defect was demonstrated in the assigned reproduction/API/UI/operational lens. All seven previous findings are fixed with the evidence above.

Verification is **partial** for runtime readers: data-quality and proof-report changes were inspected statically; MCP was inspected and typechecked. Real S3 listing/read/upload, post-repair date-recovery apply, browser E2E and deployed workflow execution are **not covered**. Production data repair, current CI status, release-variable values and deployed performance remain **unverified**.

## Verdict

**GO.** The final delta closes the reproduced round-2 content-comparison blocker and the storage-fixture nit. The whole-PR reproduction/isolation/migration campaign passed (26 tests), the API/store/CLI/geo/replay campaign passed (264 tests), four additional API/projection probes passed, and the UI campaign plus actual MRC component probe passed (60 tests). Workspace typecheck/lint, storage-binding checks and offline workflow probes passed; the isolated stack was cleaned. This is this independent leg's verdict at the specified commit, not a consensus or deployment acceptance result.
