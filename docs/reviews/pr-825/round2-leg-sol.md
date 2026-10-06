status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/graph-city-key@143555c433153153f073dd3582218fb8224e62f1
lens: reproduction-and-api-ui-regression

## Reasoning

Reviewed `git diff origin/main...143555c433153153f073dd3582218fb8224e62f1` and explicitly inspected the round-2 API delta with `git diff c5d68099 143555c433153153f073dd3582218fb8224e62f1 -- api`. HEAD was the requested commit on `fix/graph-city-key`. Read the repository rules and revision 6 of `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md`, including the deviations and dry-run. This is one independent leg; no other round-2 review was read.

The production counts supplied in the assignment were treated as context, not independently remeasured. All executed database and object-store tests used the isolated local stack. No cluster or bucket was contacted. No implementation file was changed or committed. The temporary component probe was removed, and the test stack and its volumes were cleaned up.

The original defect is reproduced at the relevant boundary. The supplied red log fails an assertion about the two cities' persisted content after both projections ran, rather than failing installation, migration, or fixture setup. The current integration tests assert two rows, their own labels and evidence, the second city's served node, and a successful subsequent projection of the first city (`api/tests/integration/graph-city-key.spec.ts:78`, `:94`). The repair suite separately seeds the post-migration shape of the old contamination and proves ordinary projection refusal, preview rollback, repair commit, restoration of the missing city's node, and replacement of overwritten edge evidence (`api/tests/integration/graph-city-key-repair.spec.ts:120`, `:127`, `:140`, `:158`, `:195`). All 25 requested integration tests passed.

The API and reader changes preserve their public paths and existing fields:

- `/api/graph/mrcs`, `/api/graph/mrc/:mrc`, and `/api/graph/:city` retain the route envelopes and status behavior (`api/src/routes/graph.ts:35`, `:52`, `:83`). Edges additionally expose `citySlug`. The MRC route test at `api/src/routes/graph.test.ts:204` asserts both cities' shared node IDs and each city's edges.
- `subgraphForCity` binds the edge query to the city and checks both endpoints; `subgraphForMrc` checks endpoint identity as `(citySlug, id)` (`api/src/services/graph/graph-store.ts:1378`, `:1405`, `:1475`). The migration's edges with an absent source are excluded from serving. The new city-leading edge indexes support these queries (`api/drizzle/0013_graph_city_key.sql:81`). Compared with the former per-node OR predicate, the city query uses one city parameter and two database reads, followed by linear set membership checks. This is a code/query-shape assessment, not a production timing measurement.
- `graph-signals` continues to return each node's `id` and `citySlug` (`api/src/routes/graph-signals.ts:456`), through the city-bound `getSignalNodesForCity` (`api/src/services/graph/graph-store.ts:2197`). Source coverage continues to aggregate by city (`api/src/routes/source-coverage.ts:718`, `:783`). Data quality now reads city-owned edges and requires both endpoints (`api/src/services/data-quality/summary.ts:137`). Geo feature enrichment now binds the graph-node lookup to the resolution's city (`api/src/services/geo/geo-features.ts:182`). The opportunity proof script's edge, neighbor, and geo-resolution joins bind the city (`api/src/scripts/report-opportunity-proof.ts:102`).
- MCP `search_signals` still calls `/api/graph-signals/<city>` and normalizes `node.citySlug` into the existing `city` output field (`packages/immo-mcp/src/data-source.ts:216`, `:298`, `:321`). No new globally unique node ID assumption is introduced. MCP typecheck passed; a live MCP request was not run.

The UI change addresses the runtime collision. `MrcGraphView.svelte:173` uses the city-qualified node map, `:358` resolves endpoints with the edge's city, and `:390` keys rendered nodes by that composite identity. Edge UUIDs remain unique across cities. `CityGraphView.svelte:149`, `:275`, and `:309` remains valid with single-city responses. The graph client declares the edge city and shares the node-key helper (`ui/src/lib/graph/graph-client.ts:41`, `:51`). In addition to the existing 59 UI tests, a temporary test mounted the actual MRC component with Gore/Barkmere sharing both IDs: four node elements and two separate edges rendered, with different source and destination x-coordinates and no duplicate-key exception.

The changed store signatures have consistent callers. Production `queryNeighbors` callers were not found; its tests use the new city argument. `upsertGraph` receives a city from exploitation. Atomic callers in refresh, projection, date recovery, enrichment, auto-link, and purge pass explicit city strings. `buildNodeRow` remains a pure builder with its prior optional-city signature; both production writers supply the city and write it explicitly. Every `UpsertAtomicResult` path provides `deletedStaleEdges`, including guard refusals and rollback results. The old cross-city skip result fields and their consumers were removed. Workspace typecheck passed.

Operationally, the two repair manifests use the intended environment-specific storage identities and the served/pinned image. The workflow retains 10 dispatch inputs, validates and renders the new placeholders before deleting the prior Job, extends the busy check to repair/mapper, rejects repair apply-all, and maps listed mapper cities to RESET (`.github/workflows/run-job.yaml:367`, `:405`, `:438`, `:450`, `:458`). Refresh suspension/resumption patches and reads back the CronJob (`:310`). Repair summaries and projection/recovery summaries are read from pod termination messages even after a failed Job (`:519`, `:534`, `:541`); both release migration steps likewise print termination summaries (`.github/workflows/build-push-images.yml:759`, `:1358`). Offline shell, manifest, and mocked workflow branch checks passed. Deployment execution and production performance remain unmeasured in this leg.

## Previous findings

Each item below was checked against code and executed regression coverage, separately from the design's claim of resolution.

1. **A825-01 — fixed.** `classifyNode` only establishes an anchor from a lost reference with a document hash absent from the city's document-hash set (`api/src/services/graph/city-key-repair.ts:188`). Without that anchor it returns `clean` (`:211`); generic whole-row equality no longer creates a foreign class. Only classified foreign IDs enter `baselineExcludeIds` (`:364`), leaving a city's own guarded value under `evaluateRowGuards` (`api/src/services/graph/graph-store.ts:1137`). The classifier tests for ref-less equality and a coincident `nb_unites_max` passed. The integration regression at `api/tests/integration/graph-city-key-repair.spec.ts:214` passed: no foreign row, `refused-guard`, no apply, and the property remains persisted.

2. **A825-02 / SOL-825-04 — fixed.** Node content drift is computed for shared IDs using comparisons in both directions, independently of class (`api/src/services/graph/city-key-repair.ts:325`). It participates in `noop` (`:355`); `summarize` derives `needsRepair` from non-noop reports (`api/src/scripts/repair-graph-city-key.ts:120`). The integration regression at `api/tests/integration/graph-city-key-repair.spec.ts:229` passed: the old local label remains `clean`, `nodesContentDiff=1`, preview is not a no-op, apply restores the label, and the next preview is a no-op.

3. **A825-03 / SOL-825-01 — fixed.** Storage failures become `not-found` or `read-failed` via `isMissingObjectError`, while parse/schema failures become `unreadable` (`api/src/scripts/repair-graph-city-key.ts:98`, `:107`). An unavailable target is retained in the per-city outcome map, full report, console outcome, and termination summary (`:188`, `:227`, `:234`, `:150`). Its presence contributes to exit 1 (`:244`). The executable `runRepair` tests at `api/src/scripts/repair-graph-city-key.test.ts:84`, `:93`, and `:101` passed for NoSuchKey, AccessDenied, and invalid JSON. The phase-3 read uses the same unavailable result handling (`api/src/scripts/repair-graph-city-key.ts:221`).

4. **SOL-825-02 — fixed.** A failed report upload sets `reportUploaded=false` and a bounded `reportError`, emits both in the termination summary, and returns exit 1 (`api/src/scripts/repair-graph-city-key.ts:237`, `:242`, `:245`). The termination summary includes bounded committed/refused/error/unavailable city lists (`:144`). Both the failed-upload test and the long-list bounding test passed (`api/src/scripts/repair-graph-city-key.test.ts:108`, `:125`).

5. **SOL-825-03 — fixed.** RESET uses the deduplicated requested cities, independently of the current-geometry query (`api/src/services/geo/run-geo-mapper.ts:71`). RESET without a city filter exits 2 before database work (`:50`). Cities with no signals still have both geo tables purged together (`:117`); cities with signals purge and resolve through the same transaction handle (`:146`). Both integration tests at `api/tests/integration/geo-mapper-reset.spec.ts:55`, `:67` passed: a requested city without geometry is purged, the other city is unchanged, and missing CITIES refuses without purging.

## Reproduction log

The excerpts below retain assertion/results output and omit package-installation noise. All actual commands used RTK; application execution stayed behind Make.

**Supplied red evidence, inspected rather than rerun on main:**

```sh
rtk sed -n '290,340p' docs/reviews/pr-825/repro-red-782d20c9.log
```

```text
{"event":"graph-store:cross-city-id-collision","city":"barkmere","count":1,"collisions":[{"id":"__812_bylaw-242","ownerCitySlug":"gore"}]}
FAIL tests/integration/graph-city-key-repro.spec.ts > GH #812 repro > two cities with the same node id keep two rows, each with its own content
AssertionError: expected [ 'gore:242 (gore)' ] to deeply equal [ 'barkmere:242 (barkmere)', …(1) ]
- "barkmere:242 (barkmere)",
  "gore:242 (gore)",
Test Files  1 failed (1)
Tests       1 failed (1)
```

This establishes the right failure on the temporary-guard version: the second row is skipped. The branch test asserts that row and its own content. The repair tests establish the other half of the incident by deliberately seeding the overwritten first-city row; ordinary projection refuses before the repair restores it.

**Requested integration run:**

```sh
rtk make test-api SCOPE="tests/integration/graph-city-key" ENV=review-sol-825
```

```text
✓ tests/integration/graph-city-key-repair.spec.ts (10 tests)
✓ tests/integration/graph-city-key.spec.ts (11 tests)
✓ tests/integration/graph-city-key-migration.spec.ts (4 tests)
Test Files  3 passed (3)
Tests       25 passed (25)
exit 0
```

This includes the migration's lock timeout/rollback and replay checks. No production-sized migration timing is claimed.

**Repair CLI, classifier, store, route/readers, and RESET regressions:**

```sh
rtk make test-api SCOPE="src/services/graph/city-key-repair.test.ts src/scripts/repair-graph-city-key.test.ts src/services/graph/graph-store.test.ts src/routes/graph.test.ts tests/integration/geo-mapper-reset.spec.ts src/services/data-quality/summary.test.ts src/services/geo/regulatory-status-zone.integration.test.ts src/routes/graph-signals src/routes/source-coverage.test.ts" ENV=review-sol-825
```

```text
✓ src/services/graph/graph-store.test.ts (141 tests)
✓ tests/integration/geo-mapper-reset.spec.ts (2 tests)
Test Files  9 passed (9)
Tests       245 passed (245)
exit 0
```

The SCOPE entry `src/services/data-quality/summary.test.ts` matches no file in this checkout. The data-quality reader was reviewed statically; the nine matched test files cover the other listed areas.

**Existing graph UI tests and workspace typecheck, using the installed test volumes:**

```sh
rtk make test-ui SCOPE="src/lib/graph src/lib/components/reconciliation/CityGraphView.test.ts" COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review-sol-825
rtk make typecheck COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review-sol-825
```

```text
✓ src/lib/components/reconciliation/CityGraphView.test.ts (17 tests)
✓ src/lib/graph/graph-client.test.ts (12 tests)
✓ src/lib/graph/graph-client-mrc.test.ts (30 tests)
Test Files  3 passed (3)
Tests       59 passed (59)
exit 0

svelte-check found 0 errors and 7 warnings in 1 file
API, MCP, domain, scoring, and sources TypeScript checks: exit 0
```

The seven Svelte warnings concern `SignauxSelPanel.svelte` (unused exported property/CSS); there was no typecheck error.

**Actual component probe, temporary untracked test removed after execution:**

```sh
rtk make test-ui SCOPE="src/lib/graph/review-sol-825.tmp.test.ts" COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review-sol-825
```

The probe rendered `MrcGraphView` with mocked HTTP responses, four nodes (the same bylaw and zone IDs in two cities), and two city-owned edges. It awaited four `svg g[role='button']` elements, asserted two SVG lines, and asserted different x1/x2 coordinates for the two edges.

```text
✓ src/lib/graph/review-sol-825.tmp.test.ts (1 test) 81ms
Test Files  1 passed (1)
Tests       1 passed (1)
exit 0
```

**Offline operational checks:**

```sh
rtk make k8s-validate K8S_VALIDATE_WITH_CLUSTER=0 ENV=review-sol-825
rtk make object-storage-bindings-test ENV=review-sol-825
rtk proxy git diff --check origin/main...143555c433153153f073dd3582218fb8224e62f1
```

```text
[k8s-validate] structural check (every doc has apiVersion + kind)…
[document-date-recovery] offline render ok (preprod + prod)
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
exit 0

docs zero-writer bindings: PASS=5 FAIL=0
PASS=42 FAIL=0
PASS=96 FAIL=0
exit 0

git diff --check: no output, exit 0
```

The binding suite's green result has the specific coverage defect described below.

Two additional Make targets were provided through stdin, without altering the repository Makefile:

- `rtk make -f - review-workflow ENV=review-sol-825`: extracted Apply (`307–466`), Resolve (`221–285`), and Wait (`473–517`) from `run-job.yaml`, removed their YAML indentation, and ran `bash -n`; counted dispatch inputs; rendered the four new/changed repair and mapper templates and checked for remaining new placeholders.
- `rtk make -f - review-workflow-branches ENV=review-sol-825`: sourced the extracted Apply script in isolated subshells with a local `kubectl` function. The function supplied a fake served image, fake active-job table, and fake CronJob readback; delete/apply only printed mock calls. Tested preprod preview-all, apply-listed, refusal of apply-all before delete, mapper cities/reset rendering, refusal while repair or mapper is active, and suspend/resume readback. Every temporary file was trapped for removal. No real kubectl operation occurred.

```text
Apply, Resolve and Wait shell blocks: bash -n PASS
workflow_dispatch inputs: 10
deploy/k8s/42-graph-city-key-repair-job.yaml: all new placeholders rendered
deploy/k8s/graph-city-key-repair/job.yaml: all new placeholders rendered
deploy/k8s/35-run-geo-mapper-job.yaml: all new placeholders rendered
deploy/k8s/geo-mapper-preprod/job.yaml: all new placeholders rendered

repair preview all: PASS
repair apply listed cities: PASS
repair apply all refused before delete: PASS
mapper listed cities renders RESET=1: PASS
mapper empty cities renders append-only: PASS
busy radar-run-geo-mapper refuses before delete: PASS
busy radar-graph-city-key-repair refuses before delete: PASS
refresh suspend/resume patch and readback: PASS
```

**Reproduction of the new fixture finding:** the following stdin Make target copied exactly the suite's FILES array into a scratch directory, checked the untouched fixture, then copied the missing manifest and checked again.

```make
# Executed with: rtk make -f - review-binding-fixture ENV=review-sol-825
SHELL := /bin/bash
.PHONY: review-binding-fixture
review-binding-fixture:
	@set -euo pipefail; \
	  review_root="$$(mktemp -d)"; \
	  trap 'rm -rf "$$review_root"' EXIT; \
	  eval "$$(sed -n '18,41p' deploy/ci/check-object-storage-bindings.test.sh)"; \
	  cp --parents "$${FILES[@]}" "$$review_root"; \
	  if bash deploy/ci/check-object-storage-bindings.sh "$$review_root" >"$$review_root/check.log" 2>&1; then \
	    echo 'untouched fixture: accepted'; \
	  else \
	    echo 'untouched fixture: REJECTED'; \
	    grep -m 3 'FAIL: deploy/k8s/42-graph-city-key-repair-job.yaml' "$$review_root/check.log"; \
	  fi; \
	  cp --parents deploy/k8s/42-graph-city-key-repair-job.yaml "$$review_root"; \
	  bash deploy/ci/check-object-storage-bindings.sh "$$review_root" >"$$review_root/check.log" 2>&1; \
	  echo 'same fixture plus the new repair manifest: accepted'
```

```text
untouched fixture: REJECTED
FAIL: deploy/k8s/42-graph-city-key-repair-job.yaml missing SCRAPE_S3_ENDPOINT
FAIL: deploy/k8s/42-graph-city-key-repair-job.yaml missing SCRAPE_S3_BUCKET
FAIL: deploy/k8s/42-graph-city-key-repair-job.yaml missing SCRAPE_S3_REGION
same fixture plus the new repair manifest: accepted
exit 0
```

**Required cleanup:**

```sh
rtk make clean COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review-sol-825
```

```text
postgres and minio containers removed
radar-review-sol-825_postgres-data removed
radar-review-sol-825_radar-test-api-node-modules removed
radar-review-sol-825_radar-test-root-node-modules removed
radar-review-sol-825_radar network removed
exit 0
```

## Findings

### SOL-825-05 — storage binding negative tests now start from an invalid fixture

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/check-object-storage-bindings.sh:17` (new required repair manifest); `deploy/ci/check-object-storage-bindings.test.sh:18` and `:42` (fixture file list/copy); `:11` (any checker failure passes a negative test).
- **Evidence:** The PR adds `42-graph-city-key-repair-job.yaml` to SCRAPE_FILES, so the checker requires its six storage bindings. The suite's FILES array does not copy that manifest. The untouched scratch fixture consequently fails the checker for missing repair bindings; adding only that file makes the same fixture pass. The actual suite nevertheless prints `PASS=42 FAIL=0`: each `run_bad` hides the diagnostic and accepts any nonzero exit, including this unrelated missing-file failure.
- **Impact:** The production manifest passes the checker; this does not block the graph-key fix. It does reduce the negative tests' ability to detect regressions in the safety checks they are intended to exercise.
- **Fix:** Add the repair manifest to the fixture FILES array and assert that an untouched copied fixture passes before running mutations. Prefer checking the expected rejection diagnostic in each negative case, so an unrelated missing file cannot satisfy it.

No blocking defect was demonstrated in the assigned reproduction/API/UI/operational lens.

## Verdict

**GO-with-nits.** All five previous finding groups are fixed with code-path and executed-test evidence. The requested integration tests and additional regressions passed: 270 API tests, 59 existing UI tests, and one actual component-render probe. Workspace typecheck and offline operational checks passed. SOL-825-05 is a demonstrated non-blocking test-fixture regression. This verdict does not attest deployment execution, current production data repair, or production latency.
