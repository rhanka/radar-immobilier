status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: feat/period-presets-week-default@2a9f486a59ce0ffb95895e2f52f2a6c80ece359a
round: 2
lens: round1-fix-verification-and-regression

## Reasoning

Reviewed both mandatory targets independently at detached HEAD `2a9f486a59ce0ffb95895e2f52f2a6c80ece359a`:

- Round-2 delta: `git diff 931166e47b194961edebb4c93319681192c04e71..2a9f486a59ce0ffb95895e2f52f2a6c80ece359a` — 7 files, 63 insertions, 10 deletions.
- Whole PR: `git diff origin/main...2a9f486a59ce0ffb95895e2f52f2a6c80ece359a` — 12 files, 243 insertions, 39 deletions. Local `origin/main` is `8b0368c62a603c269b56828d9c1471cf249760a3`.

`git rev-parse 931166e47b194961edebb4c93319681192c04e71^{tree} 70df83aa^{tree}` returned `267b3a7a7a33d0ddb7497a9b97bca453c0086800` twice. Read the two permitted round-1 reports; the other round-2 review was not read.

**Presets and date membership.** `ui/src/lib/signals/signal-date-filter.ts:32` supplies, in order, `7d` / “Dernière semaine”, `1mo` / “Dernier mois”, `3mo`, `6mo`, `12mo`, and `all` / “Illimité”; `:100` sets the default to `7d`. Calendar-day subtraction (`:73`) and clamped calendar-month subtraction (`:55`) feed inclusive civil dates. At October 9 the week window is October 2–9; its eight included civil dates follow the existing inclusive endpoint convention. Relative presets use document dates through `dateBasisForTimeRange` (`:17`). The UI and domain tests exercise the new windows, month boundaries, labels/order, and document-versus-acquisition membership.

**Legacy migration and URL regression checks.** `hasExplicitPeriod` (`ui/src/lib/router/geo-filter-state.ts:111`) recognizes the same valid relative tokens/custom dates as `readTimeRange` (`:97`). The legacy branch (`:138`) now preserves those periods and derives their date basis. Additional checks exercised all six tokens through router initialization in six contexts: subset alone, subset with disabled axes plus `lots=0`, subset plus `layers=zones`, modern `lots=0`, modern `layers=zones`, and period alone. Every context retained the explicit token; subset migration removed `filter.subset`, retained the layer restriction, and preserved the interpreted state. Relative periods carrying acquisition basis read document dates; `writeGeoFilters` omits that basis.

Eight parser cases and a router case verified valid custom dates with an absent/invalid period and document/acquisition/legacy-scrap bases. Six invalid/missing-window cases took `7d` with document basis. Recognized relative periods took precedence over stale custom bounds. Comparisons with the actual main reader and main date-filter module verified that existing modern `3mo|6mo|12mo|all` snapshots, including layer flags, retain their meaning. Existing authoritative snapshots such as `filter.lots=0` or `filter.zonage=1` without a period remain unbounded, as on main; this snapshot grammar was not changed. Filterless/legacy-only links take the intended new default. No additional production URL regression was demonstrated in these cases.

**Counters.** The shared window reaches the bulk rail/map request at `SignauxMapView.svelte:2427`, while panel membership and selected-city counts use the document-date projection at `:796` and `:832`. The API reads `dateFrom/dateTo/dateBasis` at `api/src/routes/graph-signals.ts:889`, and aggregation calls `matchesDocumentDateWindow` at `api/src/services/graph/graph-store.ts:2076`. The passing mounted-map test (`SignauxMapView.test.ts:262`) observes the outgoing default week/document window; `signal-date-filter.test.ts:66` checks client/API-function membership equality. Full browser and full API-suite execution are **unverified** in this leg.

**QA/replay consumers.** The updated rail fixture was evaluated from its actual helper/node source at three controlled dates, including Toronto DST-transition weeks: production filtering retained exactly `ndbc-recent` out of four nodes. URL-proof assertions now expect the week default while retaining the explicitly selected six-month reload scenario. The cohort's actual range expression evaluates to February 10–August 10 at its documented August 10 date. Full replay is **unverified**: local execution fails at unresolved production imports, described below. No remote dump was accessed.

## Previous findings

All evidence below refers to `2a9f486a59ce0ffb95895e2f52f2a6c80ece359a`.

| Round-1 finding | Status | Evidence |
| --- | --- | --- |
| ASTRA-833-01 — Explicit legacy period rewritten to `7d` | **fixed** | `geo-filter-state.ts:111` and `:138` preserve recognized periods/valid custom windows and their basis. The two new tests at `geo-filter-state.test.ts:175` and `router.test.ts:85` fail with the round-1 reader and pass at HEAD. The router case keeps `filter.period=6mo` and removes `filter.subset`. Additional cases cover layer combinations, invalid period plus valid custom dates, relative document basis, and custom acquisition/scrap basis. |
| SOL-833-01 — Browser-QA fixture assumes the six-month default | **fixed** | `rail-selected-city-stability.spec.ts:132` uses `isoDaysAgo(2)`; the other three signals remain nine months old (`:133`). Actual fixture evaluation yields one in-window signal out of four at all three tested dates. `url-filters-proof.mjs:130`, `:137`, and `:142` expect `7d` / “Dernière semaine”; `:118` and `:123` correctly retain the explicitly selected six-month scenario. Browser execution is **unverified**. |
| SOL-833-02 — Historical replay window follows the moving default | **fixed** for the reported window drift | `reproduce-cohort.ts:85` explicitly normalizes `6mo`, and `METHOD.md:17` describes that pin. Evaluating the actual expression at August 10 gives `{ dateBasis: "document", dateFrom: "2026-02-10", dateTo: "2026-08-10" }`. End-to-end replay/anchor totals are **unverified**; the independent import defect below remains. |

## Reproduction

Extracted the exact round-1 reader without changing tracked source:

```text
rtk git show 931166e47b194961edebb4c93319681192c04e71:ui/src/lib/router/geo-filter-state.ts > .review-tmp/round1-geo-filter-state.ts
```

`.review-tmp/sol-red.config.ts` extends the repository's UI Vitest configuration and redirects `geo-filter-state.js/ts` imports to that copy, including imports made by the real router. Other production modules stay at HEAD; the round-2 delta did not change those dependencies. The current regression tests were identical in the red and green runs.

| Execution | Passed | Failed | Exit |
| --- | ---: | ---: | ---: |
| Round-1 reader: `make test-ui SCOPE="--config ../.review-tmp/sol-red.config.ts src/lib/router/geo-filter-state.test.ts src/lib/router/router.test.ts" ENV=review2-sol-834` | 27 | 2 | 2 |
| HEAD: `make test-ui SCOPE="src/lib/router/geo-filter-state.test.ts src/lib/router/router.test.ts" ENV=review2-sol-834` | 29 | 0 | 0 |

The parser failure at `geo-filter-state.test.ts:179` receives `7d` instead of explicit `1mo`; the router failure at `router.test.ts:89` receives `7d` instead of `6mo`. Both newly added tests pass at HEAD. Logs: `.review-tmp/round1-red.log` and `.review-tmp/head-green.log`.

## Checks run

Runtime commands used Make-managed one-off containers with ENV last, under `review2-sol-834`. No services were exposed on host ports, and no cluster, bucket, or production URL was accessed. Every shell command after the bootstrap read used `rtk`.

| Command | Observed result |
| --- | --- |
| `make ps ENV=review2-sol-834` before installation | Empty service list. |
| `make install ENV=review2-sol-834` | Exit 0. |
| Red/green commands above | 27 passed / 2 failed on round 1; 29 passed at HEAD. |
| `make test-ui SCOPE="--config ../.review-tmp/sol-extra.config.ts ../.review-tmp/sol-extra.test.ts" ENV=review2-sol-834` | **70 passed**, exit 0; URL matrix, main comparisons, actual QA fixture evaluation, actual cohort range expression. |
| `make test-ui ENV=review2-sol-834` | **1,654 passed / 10 todo**, 124 passed files / 1 skipped file, exit 0. |
| `make test-ui SCOPE="--config /workspace/packages/radar-domain/vitest.config.ts --root /workspace/packages/radar-domain src/signals/document-date-filter.test.ts" ENV=review2-sol-834` | **14 passed**, exit 0. |
| `make typecheck ENV=review2-sol-834` | Exit 0; Svelte reports **0 errors / 7 warnings** in `SignauxSelPanel.svelte` (unused export/CSS selectors). |
| `make lint ENV=review2-sol-834` | Final run exits 0, no diagnostics. |
| `make -f Makefile -f .review-tmp/sol-checks.mk review-qa-syntax ENV=review2-sol-834` | Exit 0; container runs `node --check ui/e2e-qa/url-filters-proof.mjs`. |
| `make -f Makefile -f .review-tmp/sol-checks.mk review-cohort-import ENV=review2-sol-834` | Exit 2; empty local NDJSON input, fixed NOW; fails before replay with `ERR_MODULE_NOT_FOUND`. |
| `make -f Makefile -f .review-tmp/sol-checks.mk review-cohort-symbol ENV=review2-sol-834` | Exit 2; isolated import reproduces the absent `filterNodesByEtapeDate` export. |
| `make clean ENV=review2-sol-834` | Exit 0; review network and all created volumes removed. |
| `make ps ENV=review2-sol-834` after cleanup | Empty service list. |
| `git diff --exit-code` and `git diff --check` | Both exit 0; no tracked source changes. |

Two review-artifact errors were corrected before the final gates: the first additional-check run had 69 passes/1 failure because its main-module redirect did not match Vite's expanded alias; correcting that redirect produced 70 passes. The first lint run reported five line-break errors solely in `.review-tmp/sol-extra.test.ts`; fixing those formatting errors produced exit 0. Neither result is counted as a PR defect. Logs remain under `.review-tmp`; no test was copied into `ui/src`. Only this review leg was edited outside `.review-tmp`; no commit or push was performed.

## Findings

### SOL-834-01 — The edited historical replay still fails at its production imports

- **Severity:** non-blocking.
- **File:line:** `scripts/cohorte-vivier-b/reproduce-cohort.ts:49`; second unresolved import at `:42`, with matching obsolete references in `scripts/cohorte-vivier-b/METHOD.md:17` and `:24`.
- **Evidence:** `review-cohort-import` runs the actual script in the isolated container with an empty local NDJSON file and fixed NOW. It exits before producing its range or results:

  ```text
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/workspace/ui/src/lib/signals/vivier-b-display-filter.ts' imported from /workspace/scripts/cohorte-vivier-b/reproduce-cohort.ts
  ```

  The independent `review-cohort-symbol` probe also fails:

  ```text
  SyntaxError: The requested module '../ui/src/lib/signals/signal-date-filter.ts' does not provide an export named 'filterNodesByEtapeDate'
  ```

  The current date helper is `filterNodesByDocumentDate` (`ui/src/lib/signals/signal-date-filter.ts:168`); exclusion helpers reside in `packages/radar-domain/src/signals/vivier-display-exclusions.ts:153` and `:33` and are consumed through `@radar/domain`. The new six-month expression is correct, but these imports prevent the advertised replay from reaching it. Historical signal/city counts and anchor agreement remain **unverified**.
- **Refutation/attribution:** These problematic imports also appear in the main version of the script; `git cat-file -e origin/main:ui/src/lib/signals/vivier-b-display-filter.ts` exits 128 because that path is absent, and the main date module also lacks the old export. This is a remaining coherence problem in an explicitly edited/reviewed artifact, not a demonstrated new regression from `2a9f486a`. Main-script runtime execution was not performed. It does not affect the product's period filtering.
- **Fix:** Update the replay to the current document-date helper and import the exclusions from `@radar/domain`; update METHOD's helper paths and date/undated semantics to match those functions. Acceptance: the local script reaches its window/result logging without import errors while retaining explicit `6mo`; verify the historical anchors separately against the frozen dump and NOW. No compatibility shim is needed.

## Verdict

**GO-with-nits.** ASTRA-833-01 is reproduced red on round 1 and green at HEAD; both SOL round-1 window/default findings are fixed. Required UI/typecheck/lint checks pass, and the additional URL cases demonstrate no production regression. SOL-834-01 remains non-blocking for the historical replay artifact. Browser QA, full API-suite execution, and historical cohort totals are **unverified** in this leg.
