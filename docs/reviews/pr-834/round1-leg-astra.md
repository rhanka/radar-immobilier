status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/period-presets-week-default@70df83aabf82e15ec91d2f4198987be154611e8b
lens: calendar-url-ds-integration

## Reasoning

Reviewed `git diff origin/main...70df83aabf82e15ec91d2f4198987be154611e8b` independently, without reading the other leg. HEAD is detached at that exact commit; `origin/main` is `8b0368c62a603c269b56828d9c1471cf249760a3`. The PR description was read with `gh pr view 833`. This leg applies the owner's explicit-period compatibility requirement as well as the new default requirement.

**Calendar arithmetic and inclusive dates.** `signal-date-filter.ts:32` adds the requested options in order and retains `3mo`, `6mo`, `12mo`, and `all`. Lines 55 and 73 construct local calendar dates; they do not subtract fixed milliseconds for the actual filter. Temporary tests set `process.env.TZ = 'America/Toronto'` in the Vitest configuration and assert both winter and summer offsets. Observed cases:

| Preset and local endpoint | Calculated local start | Elapsed hours |
| --- | --- | ---: |
| 7d, 2026-01-03 10:30 | 2025-12-27 10:30 | 168 |
| 7d, 2026-03-10 10:30 | 2026-03-03 10:30 | 167 |
| 7d, 2026-11-03 10:30 | 2026-10-27 10:30 | 169 |
| 7d, 2026-03-15 02:30 | 2026-03-08 03:30 | 167 |
| 7d, 2026-11-08 01:30 | 2026-11-01 01:30, earlier occurrence | 169 |
| 1mo, 2026-03-31 10:30 | 2026-02-28 10:30 | 743 |
| 1mo, 2024-03-31 10:30 | 2024-02-29 10:30 | 743 |
| 1mo, 2026-01-31 10:30 | 2025-12-31 10:30 | 744 |
| 1mo, 2026-05-31 10:30 | 2026-04-30 10:30 | 744 |
| 1mo, 2026-04-08 02:30 | 2026-03-08 03:30 | 743 |
| 1mo, 2026-11-30 10:30 | 2026-10-30 10:30 | 745 |

The nonexistent spring 02:30 advances to 03:30 according to JavaScript's local-date construction. The intended civil day remains correct. Thus the source comment's “same local time-of-day” has that normal DST-gap exception; no civil-date filtering defect was demonstrated.

At 2026-10-09, the default sends `{ dateBasis: 'document', dateFrom: '2026-10-02', dateTo: '2026-10-09' }`. Both bounds are inclusive: **eight civil dates**, including today and the date seven days earlier. This follows the existing 3/6/12-month convention: subtract the calendar interval, then include both endpoint dates. Tests enumerated the eight accepted dates, rejected October 1 and 10, and compared client membership with `matchesDocumentDateWindow`. I do not report this endpoint convention as a regression.

**URL grammar and reloads.** Modern explicit `7d|1mo|3mo|6mo|12mo|all` links round-trip. Adding top-level `lots=0` or `layers=zones` preserves their explicit period. Relative links carrying `filter.dateBasis=acquisition` use document dates and omit that basis when serialized. Custom `dateFrom/dateTo` links preserve their bounds and acquisition basis. Filterless and legacy-only links resolve to `7d`; authoritative snapshots such as `?filter.lots=0` or `?filter.zonage=1` still mean unbounded time when the period is omitted (`geo-filter-state.ts:95`, `:119`). Changing that latter behavior would alter the existing snapshot grammar.

`sameTimeRange` (`geo-filter-state.ts:195`) compares recognized relative tokens, so 7d and 1mo differ while two resolutions of 7d remain equal. A mounted map test changed 7d to 1mo and observed the new September 9–October 9 bulk request; a subsequent search-only change with the same token did not reload bulk counts. The `periodChanged` branch is at `SignauxMapView.svelte:1882`. The bounds of a same-token range remain anchored until an explicit period selection or remount; automatic rollover of a long-lived page is not implemented by this branch and is not a new change in this diff.

One combined legacy/explicit-period URL changes meaning and is rewritten; see ASTRA-833-01. Also, the PR description's statement about canonicalizing *every* filterless link to `filter.period=7d` is broader than the code: the router rewrites legacy subset/layer links (`router.ts:100`), while a geographic route already supplied to the map does not call `syncFilterRoute` at mount (`SignauxMapView.svelte:2444`). Such an untouched filterless geographic URL still resolves to the requested default. This description discrepancy does not change that filter result.

**DS picker 0.35.1.** Read the installed package in the isolated make container; its `package.json:3` reports `0.35.1`. In `dist/TimeRangePicker.svelte`, lines 134–143 resolve `durationMs` and clamp `to` against `max`; lines 159–161 select by `current.relative`, not duration equality; lines 123–125 use Radar's supplied formatter. The actual default trigger says “Dernière semaine”, and the first-open listbox has exactly that option selected. Tests also confirmed selection after normalizing and returning the value to the picker.

The DS raw range is observably different from Radar's range:

| Selection instant, Toronto | Preset | Raw DS civil start | Filter's civil start |
| --- | --- | --- | --- |
| 2026-03-10 00:30 | 7d | 2026-03-02 | 2026-03-03 |
| 2026-11-03 23:30 | 7d | 2026-10-28 | 2026-10-27 |
| 2026-03-31 10:30 | 1mo | 2026-03-01 | 2026-02-28 |

`SignauxRail.svelte:103` emits the raw range and document basis, then its production parent normalizes it at `SignauxMapView.svelte:612` **before** deriving civil bounds, updating the URL, or loading counts. Real component tests for the spring-midnight and month-end rows above observed the normalized API arguments. The only other rail consumer found is `SignauxRailFilterHarness.svelte`, a test harness without a period callback. No production filtering path bypassing normalization was demonstrated.

A picker held open across midnight can emit its old `max` as `to`; a temporary test observed October 9 in that raw range and October 10 after Radar normalization. The parent anchors recognized relative presets to the selection instant, so this raw clamp does not reach the production period filter. “Base de date” remains in the custom snippet at `SignauxRail.svelte:430`; existing component tests exercise staging, Apply, Cancel, and relative-basis reset.

**API and counters.** The API accepts civil boundaries, not preset tokens (`api/src/routes/graph-signals.ts:889`); the graph store applies the shared `matchesDocumentDateWindow` before counting (`api/src/services/graph/graph-store.ts:2076`). The map's bulk request uses `signalDocumentDateWindow(dateRange, dateBasis)` (`SignauxMapView.svelte:2426`). The right-panel projection uses `filterNodesByDocumentDate` at line 796, and its resulting node count feeds the selected-city rail badge at line 832; those nodes also feed the panel at line 2767. The UI tests plus domain tests demonstrate the boundary contract. Live database counts and browser/WebGL rendering are **unverified** in this leg; component network ports and the map renderer were mocked.

**Other consumers.** Searched all requested roots for `defaultSignalTimeRange`, `SIGNAL_TIME_RANGE_PRESETS`, `6mo`, and `derniers mois`. Production default consumers are the geographic filter state, rail, and map. The Palier matrix uses its own explicit recency windows (`palier-matrix-client.ts:395`); the QA URL script explicitly selects six months (`ui/e2e-qa/url-filters-proof.mjs:118`), so these are not forgotten default assignments. Source-adapter matches describe fixture history.

The historical six-month reproduction script still calls the moving default at `scripts/cohorte-vivier-b/reproduce-cohort.ts:84`, despite its six-month description at line 2 and `METHOD.md:19`. Its requested range now becomes a week. Whole-script execution is **unverified**: this leg fetched no historical dump, and the script also imports `filterNodesByEtapeDate` at line 42, which the current module does not export. A future repair of that archival reproducer should pin an explicit `6mo` range rather than use the product default. No changed cohort totals are claimed here.

## Checks run

Commands below used the `rtk` shell prefix. All container execution used make with `ENV` last. No cluster, bucket, or production URL was accessed; no tracked implementation or test file was edited. Temporary tests and their configuration lived under `.review-tmp`; Vitest reached them without copying into `ui/src`.

1. `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git rev-parse origin/main`, and `git diff origin/main...70df83aabf82e15ec91d2f4198987be154611e8b`.
   - Detached HEAD at the requested SHA; eight changed files, 180 insertions and 29 deletions. Initial untracked review dossier retained.
2. `gh pr view 833 --json number,title,body,baseRefName,headRefName,headRefOid`.
   - Read PR title, owner request, claimed behavior, and validation description; head SHA matches the target.
3. `make install ENV=review-astra-833`.
   - Exit 0, 974 packages added. Subsequent `git diff --exit-code` returned 0, including the lockfile. Dependency-audit findings printed by installation were not investigated in this calendar/URL review.
4. `make --eval 'review-ds: ; $(COMPOSE_RUN_API_NODEPS) sh -c '\''sed -n "1,310p" node_modules/@sentropic/design-system-svelte/dist/TimeRangePicker.svelte; grep -n "aria-selected\|max\|disabled\|resolvePreset" node_modules/@sentropic/design-system-svelte/dist/TimeRangePicker.svelte; grep -n "version" node_modules/@sentropic/design-system-svelte/package.json'\''' review-ds ENV=review-astra-833`.
   - Exit 0; inspected the installed 0.35.1 implementation and its max/selection behavior.
5. `make test-ui SCOPE="src/lib/signals/signal-date-filter.test.ts src/lib/router/geo-filter-state.test.ts src/lib/router/router.test.ts src/lib/components/maps/SignauxRail.test.ts src/lib/components/maps/SignauxMapView.test.ts" ENV=review-astra-833`.
   - Exit 0: **5 files, 93 tests passed** (13 + 15 + 12 + 33 + 20).
6. `make test-ui SCOPE="--config ../.review-tmp/vitest.config.ts --reporter verbose" ENV=review-astra-833`.
   - First temporary configuration used `mergeConfig`, which concatenated the include arrays and also ran the full UI suite: **126 files passed, 1 skipped; 1683 tests passed, 10 todo**. That total includes 17 temporary calendar/URL cases and 14 domain cases. This broader run was an include-configuration consequence, not an additional planned gate.
   - Replaced the temporary include list directly, then ran the command with the additional picker/map probes: exit 0, **4 files, 38 tests passed** (17 calendar/URL + 4 picker + 3 map integration + 14 domain).
   - Toronto DST offsets, year/month boundaries, leap/non-leap clamping, civil-window membership, explicit URL variants, default picker selection, stale max, and real picker-to-parent normalization were asserted. Component clients were mocked.
7. `git show origin/main:ui/src/lib/signals/signal-date-filter.ts > .review-tmp/main-signal-date-filter.ts` and `git show origin/main:ui/src/lib/router/geo-filter-state.ts | sed 's|"$lib/signals/signal-date-filter.js"|"./main-signal-date-filter.ts"|' > .review-tmp/main-geo-filter-state.ts`.
   - Created isolated baseline module copies, with only the second module's date-filter import redirected to the baseline copy. No tracked file was swapped.
8. `make test-ui SCOPE="--config ../.review-tmp/vitest.config.ts ../.review-tmp/calendar-url.test.ts --reporter verbose" ENV=review-astra-833`.
   - Exit 0: **17 tests passed**, including assertions of the observed compatibility defect. Output:

     ```text
     ASTRA same mixed URL: origin/main -> [ '6mo' ] ; PR -> [ '7d' ]
     ASTRA mixed legacy explicit 6mo: ?mode=signal&filter.excludeDerogations=1&filter.excludePiia=1&filter.period=7d&filter.precoce=1&filter.residentiel=1&filter.zonage=1
     ```

9. `rg -n 'defaultSignalTimeRange|SIGNAL_TIME_RANGE_PRESETS|6mo|derniers mois' ui/ api/ packages/ e2e/ scripts/`, plus targeted reads of the callers, router, API route, graph store, and DS source.
   - Consumer results and code paths are summarized above. Typecheck, lint, deployed E2E, and the historical cohort replay are **unverified** by this leg.
10. Removed the temporary tests, baseline copies, configuration, and logs, then ran `make clean ENV=review-astra-833`, `git diff --exit-code`, `git diff --check`, `git status --short`, and `rg --files --hidden .review-tmp`.
    - Cleanup exited 0 and removed the review environment's network and volumes. The tracked diff remained empty, whitespace checks returned 0, and no temporary files remained. Git status showed only the initially untracked `docs/reviews/pr-833/` dossier. This leg edited only its own review file within that dossier. No commit or push was made.

## Findings

### ASTRA-833-01 — Preserve an explicit period when migrating a legacy subset link

- **Severity:** blocking.
- **File:line:** `ui/src/lib/signals/signal-date-filter.ts:100` (changed default); affected consumer `ui/src/lib/router/geo-filter-state.ts:122`, with the URL rewrite at `ui/src/lib/router/router.ts:103`.
- **Evidence:** Open `/geo/city/val-des-monts?filter.subset=vivier-v2&filter.period=6mo`. The legacy-subset branch returns `defaultGeoFilters(now)` without reading the explicit period. On the actual `origin/main` modules, the resulting period is `6mo`; on this PR it is `7d`. `initRouter()` then overwrites the explicit `filter.period=6mo` with `filter.period=7d` and removes `filter.subset`, as shown in check 8. This is a demonstrated change in the meaning of the same accepted URL, not merely a label mismatch. The count window narrows from six months to a week, contrary to the owner's requirement that existing links with an explicit period retain their meaning. The number of real saved links using this combination is **unknown**.
- **Refutation considered:** The reader's legacy branch already used the default, and its comment says “product defaults elsewhere”. That explains the mechanism but does not preserve a previously effective explicit `6mo` link when this PR changes the default. Modern `filter.period=6mo` alone does remain unchanged, so the finding is limited to the demonstrated mixed legacy link.
- **Fix:** In legacy-subset migration, retain a supplied recognized `period` (and a valid explicit custom date window where applicable) before applying defaults to omitted fields. Derive its date basis through the same existing relative/custom rules. Add a parser and router regression test for `filter.subset=vivier-v2&filter.period=6mo`, while retaining the new `7d` expectation for legacy links with no period. Acceptance: opening that explicit link keeps a six-month range and canonicalizes to `filter.period=6mo`; the legacy-only link canonicalizes to `7d`.

## Verdict

**NO-GO** — ASTRA-833-01 violates the explicit-period URL compatibility requirement. Calendar arithmetic, inclusive endpoint consistency, preset order/default, and the exercised DS-to-filter path produced the expected results in the checks above.
