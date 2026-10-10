status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: feat/period-presets-week-default@2a9f486a59ce0ffb95895e2f52f2a6c80ece359a
round: 2
lens: round1-fix-verification-and-url-compat

## Reasoning

Reviewed both required targets independently:

- Round-2 delta: `git diff 931166e47b194961edebb4c93319681192c04e71..2a9f486a59ce0ffb95895e2f52f2a6c80ece359a` — 7 files, 63 insertions, 10 deletions.
- Whole PR: `git diff origin/main...2a9f486a59ce0ffb95895e2f52f2a6c80ece359a` — 12 files, 243 insertions, 39 deletions.

HEAD is detached at the requested full SHA. Local `origin/main` is `8b0368c62a603c269b56828d9c1471cf249760a3`. `931166e47b194961edebb4c93319681192c04e71` and `70df83aabf82e15ec91d2f4198987be154611e8b` both resolve to tree `267b3a7a7a33d0ddb7497a9b97bca453c0086800`. Read the two permitted round-1 reports; did not read the other round-2 leg or launch another reviewer. All source references below are at the round-2 target.

**Legacy-period migration.** `ui/src/lib/router/geo-filter-state.ts:111` recognizes either an accepted relative token or a valid, ordered pair of civil dates. Its precedence matches `readTimeRange` at line 97: a recognized relative token wins; otherwise valid custom bounds win. The legacy branch at line 138 now applies that range and derives its basis with `dateBasisForTimeRange`. An absent/invalid period without valid custom bounds keeps the new `7d` default. This covers the invalid-period-plus-valid-custom-window case, rather than incorrectly discarding that window.

The exact original defect was checked against isolated copies of the real main and round-1 modules, without replacing tracked files. For `filter.subset=vivier-v2&filter.period=6mo`, the observed effective tokens were **main: `6mo`; round 1: `7d`; round 2: `6mo`**. The actual round-2 router produced:

```text
?mode=signal&filter.excludeDerogations=1&filter.excludePiia=1&filter.period=6mo&filter.precoce=1&filter.residentiel=1&filter.zonage=1
```

**URL compatibility.** Temporary tests exercised a 240-URL matrix: modern versus legacy `filter.subset=vivier-v2|-z|-p`; no layer parameter versus `lots=0` versus `layers=zones`; absent/document/acquisition/scrap/invalid date basis; and each of six relative tokens plus custom dates with absent or invalid period. Every case was checked through parser/writer round-trip, real router initialization, canonical query parsing, `popstate`, and fresh router initialization after canonicalization. The legacy marker disappeared and recognized explicit periods survived. Disabled axes and lots remained disabled.

| Input family | Observed effective result |
| --- | --- |
| Legacy subset + `period=6mo`, including either top-level layer restriction | Six months, document basis; layer restriction retained; canonical `filter.period=6mo`, no `filter.subset`. |
| Legacy subset + `period=2w` + May 1–31 custom dates + `dateBasis=acquisition` or `scrap` | May 1–31 absolute window, internal `scrap` basis; stable through canonicalization and reload. |
| Legacy subset + absent/invalid period and missing, impossible, or reversed custom bounds | `7d`, document basis. |
| Recognized relative period plus custom dates and acquisition basis | Relative period wins; document basis. |
| Modern explicit `3mo`, `6mo`, `12mo`, `all`, or valid custom window, with either layer parameter | Same effective range, basis, axes, exclusions, and lots state as the real main parser. |
| Filterless link, or legacy-only subset/layer link | New `7d` default. |
| Authoritative snapshot such as `filter.lots=0` or `filter.zonage=1`, omitting period and bounds | Unbounded, as on main. This is the existing snapshot grammar at `geo-filter-state.ts:19`, not a new default fallback. |

Separate probes covered bare `/geo` canonicalization and `/#/signaux` hash state with legacy explicit periods/custom acquisition dates. Relative periods, including `all`, use document dates; absolute periods retain acquisition basis, and the old `scrap` spelling writes as `acquisition`. `writeGeoFilters` omits acquisition basis for relative ranges. The router's existing merge at `router.ts:103` can retain an inert original basis or invalid-period query key; the exercised resulting URLs retain their effective meaning on reload. No new compatibility defect was demonstrated in these cases. Unenumerated URLs are **not covered** by the matrix.

**Whole-PR behavior and counters.** `ui/src/lib/signals/signal-date-filter.ts:32` supplies the ordered labels “Dernière semaine”, “Dernier mois”, then 3, 6, 12 months and “Illimité”; line 100 selects `7d` by default. Day arithmetic uses local calendar construction at line 73, and one-month arithmetic uses the existing month-end clamp at line 55. Passing production tests check order, selected default, month boundaries, new-token round-trips, old explicit periods and document-date membership. At October 9, the week window is October 2–9 inclusive, following the existing inclusive civil-bound convention.

`SignauxMapView.svelte:612` normalizes picker values before deriving dates. Its bulk request at line 2426 sends `signalDocumentDateWindow`; `api/src/routes/graph-signals.ts:889` accepts civil bounds without a preset whitelist, and `api/src/services/graph/graph-store.ts:2076` applies `matchesDocumentDateWindow` before counting. The panel's date filter at `SignauxMapView.svelte:796` feeds both its nodes and `selectedCityLiveCount` at line 832; rail/map bulk counts use the same date-scoped response. The component test at `SignauxMapView.test.ts:262` passed with the last-week request, the client/domain membership parity test passed, and all 14 domain date-window tests passed. Simultaneous browser-rendered rail/map/panel counters and live database counts are **unverified** by this leg.

## Previous findings

| Round-1 finding | Status | Evidence at `2a9f486a59ce0ffb95895e2f52f2a6c80ece359a` |
| --- | --- | --- |
| **ASTRA-833-01 — blocking: explicit legacy period rewritten to `7d`** | **fixed** | `geo-filter-state.ts:111` and `:138` preserve recognized explicit periods or valid custom dates and derive the appropriate basis. Added production tests at `geo-filter-state.test.ts:175` and `router.test.ts:85` passed. Independent before/after execution demonstrated main `6mo` → round-1 `7d` → round-2 `6mo`; actual router canonicalization retained `filter.period=6mo` and dropped `filter.subset`. Matrix tests additionally covered both layer parameters, all tokens, invalid period plus valid custom bounds, and acquisition basis. |
| **SOL-833-01 — non-blocking: browser-QA fixture assumes six-month default** | **fixed** | `ui/e2e-qa/rail-selected-city-stability.spec.ts:55` adds the day helper, line 132 dates the recent node two days ago, and line 127 describes the week default. Temporary tests extracted and executed the actual fixture functions and node array, then applied the production default filter: exactly `ndbc-recent` was included out of four nodes at October 9 and around both Toronto DST transitions. Also inspected `ui/e2e-qa/url-filters-proof.mjs:130`, `:137`, `:142`: default-link assertions now require `7d`/“Dernière semaine”; the explicit six-month selection/reload assertions at lines 118–123 correctly remain `6mo`. Browser execution of these QA scripts is **unverified**. |
| **SOL-833-02 — non-blocking: historical replay follows moving default** | **fixed** | `scripts/cohorte-vivier-b/reproduce-cohort.ts:85` now explicitly normalizes `relative: "6mo"` at `NOW`; `METHOD.md:17` documents that fixed preset. A temporary test extracted and executed the actual range expression at August 10: **February 10–August 10**, equal to the former main default; the new product default yields **August 3–August 10**. This verifies the reported window dependency. Whole-script execution and historical cohort totals are **unverified**; no dump or bucket was accessed. |

## Checks run

Shell commands used the `rtk` prefix. All executable tests and installation used Make-managed containers with `ENV=review2-astra-834` last. No cluster, bucket or production URL was accessed. No tracked implementation/test file was modified, and no commit or push was made.

| Command/check | Observed result |
| --- | --- |
| `git status --short`, `git branch --show-current`, `git rev-parse HEAD origin/main`, tree comparisons, both required diffs | Requested detached target and equivalent round-1 trees confirmed; initially only the review dossier was untracked. |
| `make ps ENV=review2-astra-834` | Empty service list before installation. |
| `make install ENV=review2-astra-834` | Exit 0; 974 packages installed into isolated volumes. Subsequent tracked diff remained empty, including the lockfile. |
| `make test-ui SCOPE="src/lib/router/geo-filter-state.test.ts src/lib/router/router.test.ts src/lib/router/geo-route.test.ts src/lib/signals/signal-date-filter.test.ts src/lib/components/maps/SignauxRail.test.ts src/lib/components/maps/SignauxMapView.test.ts" ENV=review2-astra-834` | Exit 0: **6 files, 101 tests passed** (16 + 13 + 6 + 13 + 33 + 20). |
| `make test-ui SCOPE="--config ../.review-tmp/astra-vitest.config.ts ../.review-tmp/astra-url.test.ts" ENV=review2-astra-834`, initial temporary harness | Exit 2: **244 passed, 3 failed**. One test packed all 240 router/reload cases into a single five-second test; two fixture readers used a URL that Vitest/JSDOM resolved with a non-file scheme. These were review-harness failures; no application assertion failure was observed. |
| Same command after correcting only `.review-tmp` | Exit 0: **486 tests passed**. Split the 240 router cases into independent tests without increasing timeouts; used container filesystem paths for fixture reads. This total includes 240 parser cases, 240 router cases, and six focused fix/default/precedence/hash/fixture/cohort tests. |
| `make test-ui SCOPE="--config /workspace/packages/radar-domain/vitest.config.ts --root /workspace/packages/radar-domain src/signals/document-date-filter.test.ts" ENV=review2-astra-834` | Exit 0: **14 tests passed**. |
| Targeted reads/searches of parser, router, period normalization, both QA scripts, replay/METHOD, and API/counter consumers | Findings and limits described above. |
| `make clean ENV=review2-astra-834` | Exit 0; isolated network and dependency/data volumes removed. |
| Final `make ps ENV=review2-astra-834`, `git diff --exit-code`, `git diff --check`, `git status --short`, and `.review-tmp` file listing | Empty service list; tracked diff and whitespace checks exited 0; status showed only the initially untracked review dossier; no temporary files remained. Only this leg file was edited within the dossier. |

Temporary tests used `America/Toronto` and a fixed October 9, 2026 clock for URL comparisons. Main and round-1 parser copies stayed under `.review-tmp`; only the main copy's date-filter import was redirected to the main date-filter copy. Fixture/cohort probes executed extracted source expressions, not handwritten replacements. Temporary test/config/baseline/log files were removed after recording these results.

Typecheck, lint, full UI/API suites, browser QA, visual layout, and the complete historical replay are **unverified** in this leg. The passing scoped runs comprise **601 tests**; they do not establish those unrun checks.

## Findings

No demonstrated blocking or non-blocking finding remains within this review's targets and exercised URL cases. The three round-1 findings are fixed within their reported scopes; execution limits are stated above.

## Verdict

**GO** — the round-1 compatibility defect is fixed, the two default-dependent consumers are updated, and no new defect was demonstrated by this leg's scoped checks.
