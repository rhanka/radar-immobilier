status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/period-presets-week-default@70df83aabf82e15ec91d2f4198987be154611e8b
lens: reproduction-counter-parity-regression

## Reasoning

Reviewed `git diff origin/main...70df83aabf82e15ec91d2f4198987be154611e8b` and read the description with `gh pr view 833`. This worktree is detached at the requested commit; the local `origin/main` is `8b0368c62a603c269b56828d9c1471cf249760a3`. No other review leg was consulted and no additional reviewer was launched.

The production change satisfies the requested preset list and default. `ui/src/lib/signals/signal-date-filter.ts:32` lists `7d`, `1mo`, `3mo`, `6mo`, `12mo`, `all`, with the exact labels `Dernière semaine` and `Dernier mois`. `signal-date-filter.ts:100` selects `7d` as the default. The new day resolver uses local calendar subtraction (`:73`); the month resolver retains its existing month-end clamp (`:55`). Existing presets remain in the list.

The URL parser derives its accepted tokens from that list (`ui/src/lib/router/geo-filter-state.ts:49`), so no second preset whitelist needs updating. Its default path uses `defaultSignalTimeRange` (`:79`), while explicit periods resolve through the existing normalization path (`:100`). The passing router/filter tests cover old filterless and legacy links, new-token round trips, explicit existing periods and custom date links. The existing authoritative-snapshot rule remains: an explicit `filter.*` snapshot with no period or custom bounds is unrestricted; this change does not alter that grammar.

**Counter parity.** The date-window path is shared:

1. `ui/src/lib/components/maps/SignauxMapView.svelte:551` initializes the period with the URL period or the new default. `:552` forces the relative basis to `document`, and `:553` derives civil dates. `signal-date-filter.ts:17` permits the acquisition basis only for an absolute period.
2. `SignauxMapView.svelte:2426` sends `signalDocumentDateWindow(dateRange, dateBasis)` and the display exclusions to the bulk `/api/graph-signals/by-city` request. `ui/src/lib/signals/graph-signals-by-city-client.ts:58` writes those date bounds to the query; document basis is implicit on the wire, while only `scrap` is explicitly written.
3. The API route (`api/src/routes/graph-signals.ts:889`) reads arbitrary civil bounds and passes them to `listCitiesWithSignalNodes` (`:904`). The store selects individual nodes and forwards the window to aggregation (`api/src/services/graph/graph-store.ts:2162`). Aggregation applies `matchesDocumentDateWindow(row.props, dateRange)` before incrementing any city count (`:2076`). There is no preset-token whitelist or minimum-span check on this path. The shared predicate validates civil dates, ordering and inclusive membership only (`packages/radar-domain/src/signals/document-date-filter.ts:101`). Its document basis uses persisted documentary refs, with the existing stage-date fallback; it does not use collection or node-creation time (`:90`).
4. The response becomes `graphItems` (`SignauxMapView.svelte:2432`) and then `allEntries` (`:749`). `ui/src/lib/maps/maps-data.ts:64` transfers response counts without another time filter. The older field name `signalCount6m` is a response-value container, not a hard-coded six-month window.
5. The rail uses those entries (`SignauxMapView.svelte:2467`). Its city counts use `countForVivierCity` (`ui/src/lib/components/maps/SignauxRail.svelte:278`); its displayed total sums the city counts (`:398`). Once selected-city detail is available, `countFor` substitutes `selectedCityLiveCount` for that city (`:308`). Map city counts use the same entries and subset helper in the geo-engine feature properties (`SignauxMapView.svelte:764`) and the MapLibre city-color expression (`:976`); those remain bulk counts.
6. The right-panel pipeline filters the authoritative projection with `filterNodesByDocumentDate(detailProjection.nodes, dateRange, dateBasis)` (`SignauxMapView.svelte:796`), then applies the existing display gates. `selectedCityLiveCount` is exactly `filteredDetailNodes.length` (`:832`). The same filtered array is passed to `SignauxSelPanel` (`:2767`), whose city-level signal count is `detailNodes.length` (`ui/src/lib/components/maps/SignauxSelPanel.svelte:219`). A focused zone further narrows the panel numerator, retaining that city total (`:1140`).

For the fixed test date 2026-10-09, the default window is `dateFrom=2026-10-02`, `dateTo=2026-10-09`, basis `document`. Both endpoints are included, consistent with the existing civil-date convention. The PR parity test checks the same three included node IDs on the panel predicate and the API predicate (`ui/src/lib/signals/signal-date-filter.test.ts:66`). The component test checks the default request window (`ui/src/lib/components/maps/SignauxMapView.test.ts:262`). Four additional review tests exercise the real route and real `listCitiesWithSignalNodes`, mocking only database query rows: the week counts 3 and the month counts 5, including boundary/stage-fallback rows and excluding future, undated and old-document/recent-collection rows. A browser assertion of all three rendered counters together is **not covered** by this leg; database persistence is mocked in those four tests.

**UX.** Exact accented French labels and their order are asserted both in the preset array and in the rendered DS listbox (`signal-date-filter.test.ts:28`, `SignauxRail.test.ts:255`). The rendered default is the sole selected option. The picker still uses `size="sm"`, `locale="fr-CA"` and `customExtra` for `Base de date` (`SignauxRail.svelte:423`, `:429`). The passing test at `SignauxRail.test.ts:57` confirms the date-basis group is absent from Relatif and appears on Personnalisé. The compact rail keeps full-width picker/wrapper/trigger and a flexible label with `min-width: 0` (`SignauxRail.svelte:532`, `:541`, `:545`); the parent rail is `w-80` (`SignauxMapView.svelte:2455`). Neither component's markup/CSS changed in this diff. No overflow regression is evident from these rules; actual browser/font/viewport rendering is **unverified**.

**Regression search.** Searched `ui/`, `api/`, `packages/`, `e2e/`, `scripts/`, `docs/` and `plan/` for `defaultSignalTimeRange`, `6mo`, `6 derniers mois`, six-month/default wording and the French equivalent. The two remaining consumers below still depend on the previous default. Six-month collection windows, ontology freshness and separate palier recency bands are separate controls. Historical branch-plan statements were not treated as current product assertions.

## Reproduction (red/green counts)

Kept the PR's tests and temporarily replaced only these implementation files with their `origin/main` bytes:

```sh
rtk proxy git show origin/main:ui/src/lib/signals/signal-date-filter.ts > ui/src/lib/signals/signal-date-filter.ts
rtk proxy git show origin/main:ui/src/lib/router/geo-filter-state.ts > ui/src/lib/router/geo-filter-state.ts
rtk proxy make test-ui SCOPE="src/lib/signals/signal-date-filter.test.ts src/lib/router/geo-filter-state.test.ts src/lib/router/router.test.ts src/lib/components/maps/SignauxRail.test.ts src/lib/components/maps/SignauxMapView.test.ts" ENV=review-sol-833
```

| Test file | Main implementation: passed / failed | Restored HEAD: passed / failed |
| --- | ---: | ---: |
| `signal-date-filter.test.ts` | 9 / 4 | 13 / 0 |
| `geo-filter-state.test.ts` | 9 / 6 | 15 / 0 |
| `router.test.ts` | 10 / 2 | 12 / 0 |
| `SignauxRail.test.ts` | 27 / 6 | 33 / 0 |
| `SignauxMapView.test.ts` | 18 / 2 | 20 / 0 |
| **Total** | **73 / 20** | **93 / 0** |

The red command exited 2 (Make; Vitest reported 20 failed, 73 passed). `git checkout -- <files>` could not create the worktree's Git index lock on the read-only metadata directory. Restored with `git show HEAD:<path> > <path>` instead and confirmed an empty tracked diff. An early retry started before that restoration completed and repeated the red result; it is excluded from the HEAD column. The subsequent restored-HEAD command exited 0 with 93 passed. Logs: `.review-tmp/sol-833-red.log` and `.review-tmp/sol-833-green-restored.log`.

The domain test file separately passed **14/14**. Its implementation is byte-identical on main and HEAD (`git rev-parse origin/main:packages/radar-domain/src/signals/document-date-filter.ts HEAD:packages/radar-domain/src/signals/document-date-filter.ts` returned `9d53e186ad4e604f888130339dcb4e25454bb6bb` twice). It is an acceptance check for the windows, not a red/green discriminator for the preset change; a separate baseline-domain execution was not run.

Test sensitivity, established by assertions and the red results:

- **Wrong order or removed preset:** exact ordered equality of all six token/label pairs (`signal-date-filter.test.ts:29`) and all six rendered listbox labels (`SignauxRail.test.ts:260`) catches reordering/removal, including `12mo` and `all`.
- **Wrong default:** exact `7d` bounds (`signal-date-filter.test.ts:43`), selected-option equality (`SignauxRail.test.ts:263`), URL-default expectations (`geo-filter-state.test.ts:150`) and the outgoing request window catch a return to six months. These tests failed on main.
- **Broken legacy link:** old subset/zones-only canonicalization is asserted by router/filter tests and failed on main's period expectation. New tokens and explicit `3mo|6mo|12mo` are read/written (`geo-filter-state.test.ts:161`); the existing explicit `3mo|6mo|12mo|all` router loop asserts that each token survives (`router.test.ts:75`). Custom-date and acquisition-basis cases also passed. Exhaustive mutation testing of individual URL failures was not run.

## Checks run

All execution used Make-managed containers under `ENV=review-sol-833`, with ENV last. Shell commands were prefixed with `rtk`; test/gate output was retained under `.review-tmp/sol-833-*.log`. No cluster, remote bucket or production URL was accessed.

| Command | Observed result |
| --- | --- |
| `gh pr view 833` | Read PR description and its stated test claims. |
| `make ps ENV=review-sol-833` before installation | Empty service list. |
| `make install ENV=review-sol-833` | Exit 0; dependencies installed in review volumes. |
| Scoped UI command above, main implementation | 20 failed / 73 passed, 5 failed files, exit 2. |
| Same scoped UI command, restored HEAD | 93 passed, 5 passed files, exit 0. |
| `make test-ui ENV=review-sol-833` | **1,652 passed / 10 todo**; 124 passed files / 1 skipped file, exit 0. |
| `make test-api SCOPE="src/routes/graph-signals.test.ts" ENV=review-sol-833` | **20 passed**, exit 0. |
| `make test-api SCOPE="--config ../.review-tmp/sol-833-api-vitest.config.ts" ENV=review-sol-833` | **4 passed**, real route/store, database rows mocked, exit 0. |
| `make test-ui SCOPE="--config /workspace/packages/radar-domain/vitest.config.ts --root /workspace/packages/radar-domain src/signals/document-date-filter.test.ts" ENV=review-sol-833` | **14 passed**, exit 0. A first relative-config invocation failed before test collection because Vitest resolved `packages/packages/...`; the absolute container path above corrected it. |
| `make test-ui SCOPE="--config ../.review-tmp/sol-833-ui-vitest.config.ts" ENV=review-sol-833` | **2 passed**, demonstrating the remaining default-dependent consumers below, exit 0. |
| `make typecheck ENV=review-sol-833` | Exit 0 across workspace checks; Svelte reported **0 errors / 7 warnings** in `SignauxSelPanel.svelte` (unused export/CSS selectors, outside this diff). |
| `make lint ENV=review-sol-833` | Exit 0; no ESLint diagnostics. |
| `make clean ENV=review-sol-833` | Exit 0; review containers/network and dev-compose dependency/data volumes removed. |
| `make clean COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review-sol-833` | Exit 0; remaining review test dependency volumes removed. |
| `make ps ENV=review-sol-833` after cleanup | Empty service list. |
| `git diff --exit-code` after restoration/checks | Exit 0; no tracked source changes remain. |

Review-only tests/configs stayed under `.review-tmp`; none were copied into `ui/src`. No commit or push was performed. Full browser QA, full API/domain suites and visual viewport checks are **unverified** in this leg.

## Findings

### SOL-833-01 — Browser-QA fixture retains the old default-window expectation

- **Severity:** non-blocking.
- **File:line:** `ui/e2e-qa/rail-selected-city-stability.spec.ts:126`; related assertions at `:224` and `:258`.
- **Evidence:** The fixture calls `isoMonthsAgo(1)` for its only "recent" signal and dates the other three nine months ago. Its comment at `:121` expressly assumes a six-month default. `openVivierB` navigates to `/#/signaux` without an explicit period (`:192`), yet both scenarios expect the selected-city badge `1/4`. The throwaway test in `.review-tmp/sol-833-ui-regressions.test.ts` recreated those date inputs at 2026-10-09: the production filter includes **1** node with explicit `6mo` and **0** with the new default `7d`. Through `selectedCityLiveCount`, that date-filter result cannot support the existing one-visible-signal assertion. The file is browser QA, outside the passing unit-suite include pattern (`ui/vitest.config.ts:20`). Browser execution itself is **unverified**; this finding concerns the demonstrated fixture/period mismatch.
- **Fix:** Date the in-window fixture inside the current week and update the six-month comment, or make this historical six-month scenario select/share explicit `filter.period=6mo`. Keep the intended list-stability and badge assertions aligned with the chosen window.

### SOL-833-02 — Versioned six-month replay still derives its window from the moving default

- **Severity:** non-blocking.
- **File:line:** `scripts/cohorte-vivier-b/reproduce-cohort.ts:84`; matching definition at `scripts/cohorte-vivier-b/METHOD.md:17`.
- **Evidence:** The replay calls `dateRangeFromSignalTimeRange(defaultSignalTimeRange(NOW))`; METHOD describes that same expression as **six calendar months** and identifies the artifact as a six-month cohort (`:1`, `:4`, `:18`). The throwaway test at the artifact's documented 2026-08-10 date shows the actual expression now produces `{ dateBasis: "document", dateFrom: "2026-08-03", dateTo: "2026-08-10" }`. The product-default change therefore invalidates that persisted window definition. Full cohort replay/output is **unverified**: it was not run against a dump; this finding is limited to the date-range expression and its documentation.
- **Fix:** Pin the historical replay to explicit `6mo` normalization and describe that explicit window in METHOD. This preserves the versioned cohort's intent while the product defaults to `7d`.

## Verdict

**GO-with-nits.** No blocking defect was demonstrated in the requested production behavior. The red/green claim is reproduced, both short API windows are accepted through the actual route/store path, and the required UI/typecheck/lint commands exit successfully. The two non-blocking observations concern consumers of the former six-month default outside the UI unit suite; browser rendering and full historical replay remain unverified.
