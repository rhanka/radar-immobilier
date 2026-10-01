# Feature: Document or scrape date for the shared Signals period

## Objective
- [ ] Use the document date by default, with an explicit scrape-date alternative, consistently across city counts and detailed results.
- [ ] Share the date basis and period through the geo URL without extracting dates in the filter.

## Scope / Guardrails
- [ ] Work only in `tmp/feat-document-date-filter-786` on `feat/document-date-filter-786`, stacked on `feat/url-filters-787` without copying commits.
- [ ] Use existing document metadata supplied by #788; no source parsing, LLM calls or signal creation-date fallback.
- [ ] Preserve root UAT, production data, source documents and Track single-writer ownership.
- [ ] Use Make only, Docker first, English code/docs, selective atomic commits under 150 lines and ENV last.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `ui/src/lib/signals/signal-date-filter.ts`, `ui/src/lib/signals/signal-date-filter.test.ts`, `ui/src/lib/signals/graph-signals-by-city-client.ts`, `ui/src/lib/signals/graph-signals-by-city-client.test.ts`, `ui/src/lib/signals/graph-signal-detail-client.ts`, `ui/src/lib/signals/graph-signal-detail-client.test.ts`.
  - [ ] `ui/src/lib/router/geo-filter-state.ts`, `ui/src/lib/router/geo-filter-state.test.ts` for the date-basis extension.
  - [ ] `ui/src/lib/components/maps/SignauxRail.svelte`, `ui/src/lib/components/maps/SignauxRail.test.ts`, `ui/src/lib/components/maps/SignauxMapView.svelte`, `ui/src/lib/components/maps/SignauxMapView.test.ts`.
  - [ ] `api/src/services/graph/graph-store.ts`, `api/src/services/graph/graph-store.test.ts`, `api/src/routes/graph-signals.ts`, `api/src/routes/graph-signals.test.ts`, coordinated with #788.
  - [ ] `ui/src/lib/signals/vivier-b-display-filter.ts`, `ui/src/lib/signals/vivier-b-display-filter.test.ts`, `ui/src/lib/components/maps/SignauxSelPanel.svelte`, `ui/src/lib/components/maps/SignauxRailFilterHarness.svelte` for existing predicate consumer imports only.
  - [ ] `plan/786-BRANCH_feat-document-date-filter-786.md`.
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `Makefile`, `docker-compose*.yml`, `rules/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` and other branch plans.
  - [ ] Source adapters, collectors, document resolvers, refresh extraction/LLM workflows, `.track/**` and `.agents/**`.
  - [ ] Root checkout, production writes/refresh/backfill, merging and deployment.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `packages/radar-domain/src/signals/document-date-filter.ts`, `packages/radar-domain/src/signals/document-date-filter.test.ts`, `packages/radar-domain/src/index.ts` for a shared deterministic filter policy after conductor/data coordination.
  - [ ] `packages/radar-domain/src/signals/vivier-display-exclusions.ts` for the existing display exclusion predicate shared with aggregation.
- [ ] **Exception process**:
  - [ ] Record reason, impact and rollback under `BR786-EXn` before changing conditional paths.

## Feedback Loop
- [x] `BR786-EX1` (conductor approved): share the deterministic date predicate in domain to prevent API/UI rules diverging; no I/O or dependency on sources. Rollback is reverting its consumers and module together.
- [x] `BR786-EX2` (conductor approved): move the existing display exclusion predicate to domain and pass the same exclusions to aggregation so a city click cannot change counters. Preserve classification/semantics, delete the old module without a shim, and update only necessary imports. Rollback is reverting the shared predicate and consumers together.
- [x] `clarification`: membership reads persisted document refs only; S3 presentation cannot change membership, and historical unknown dates await a separately prepared replay.
- [x] `clarification`: bounded windows exclude unknown/partial/ambiguous dates; unlimited includes them; any matching document ref includes a result once. Scrape timestamps use America/Toronto civil dates.
- [x] `clarification`: the DS TimeRangePicker has no content slot; use the standard DS Select adjacent to it in the same period group, available in both relative/custom modes, without DOM grafting.
- [x] `attention`: confirm the #788 document-date/fetchedAt contract and one metadata projection for both API views before editing shared files.
- [ ] `attention`: any necessary business interpretation beyond the selected date basis goes to the conductor with evidence; no workaround.

- [x] `evidence`: aggregation applies B display exclusions to the vivier_v2 path only (A counters unchanged), matching the client detail; Postgres integration spec `api/tests/integration/graph-signals-date-parity.spec.ts` proves aggregate = detail on the Val-des-Monts shape in both modes.
- [x] `dependency`: #788 (`feat/document-date-collection-788`) projects `documentDate` {status, precision, value}, `publishedAt` (= known value) and the first `fetchedAt` on canonical refs; the filter only reads these fields. Historical refs without `documentDate` fall back to a day-precision `publishedAt` only.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**: not used; do not copy URL commits.
- [x] **Multi-branch**: separate data and filter worktrees; filter is stacked on the URL branch.
- [x] Rationale: coordinate the shared document contract while keeping code review and isolated checks attributable.

## UAT Management (in orchestration context)
- [ ] Root UAT remains at API 8801, UI 5301 and existing dev data; only the conductor may prepare it.
- [ ] Browser proofs use an isolated branch stack and a dedicated tab/context, without claiming production or owner UAT acceptance.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read MASTER, workflow, subagents, testing and harness method/debug/plan/test skills.
  - [x] Confirm branch/worktree and URL base `a1b9bbe8a33c620531ae92fe6486c3ad8f357014`, rebased on #789 head `69167ed2`.
  - [x] Inspect aggregate/list-vs-detail date mismatch and existing DS TimeRangePicker.
  - [x] Define `test-document-date-filter-786` / `e2e-document-date-filter-786`; API 8896, UI 5396, Mail UI 1196, Postgres 5636, S3 9196, Obscura 9396, SMTP 1096.
  - [x] Obtain conductor scope gate and data/URL contract coordination (C1/C2 checked).
- [x] **Lot 1 — Deterministic date basis**
  - [x] Move the existing display exclusions to domain without a shim so the API and UI share its unchanged semantics.
  - [x] Add a shared pure persisted-reference date predicate, independent of presentation enrichment and event/creation dates.
  - [x] Consume document metadata and scrape timestamp; reject unknown/partial/ambiguous dates in bounded periods without another clock fallback.
  - [x] Share one inclusive date policy between aggregation and client detail, including unbounded periods and multiple references.
  - [x] Regression tests cover the September/July fixture, missing dates, partial/ambiguous dates, scrape-only timestamps and calendar boundaries.
- [x] **Lot 2 — Selector and shared URL**
  - [x] Extend the existing geo URL codec with explicit scrape basis and implicit document default, including dates-only reset semantics.
  - [x] Add the document/scrape selector to the existing period group for relative and custom periods, default document.
  - [x] Serialize/restore `filter.dateBasis` with period and retain it across geo navigation, reload and browser history.
  - [x] Reload bulk counts and reconcile detail/selection using the same basis.
  - [x] UI/client/codec tests cover default and both modes without extracting dates.
- [ ] **Lot 3 — Gates and browser evidence**
  - [x] Run relevant API/domain/UI tests, typecheck and lint through Make on the isolated test environment.
  - [x] Prove identical city count, badge, total and detail membership in a dedicated CDP browser context/tab.
  - [ ] Review every hunk for scope; request independent review through the conductor.
- [ ] **Lot 4 — Reviewable delivery**
  - [ ] Push the branch and open a PR against `main`, stacked on #789 (`feat/url-filters-787`), which must merge first.
  - [ ] Report full SHA, checks, browser artifacts, limitations and unresolved decisions to the conductor.
  - [ ] Verify CI green before any later merge; preserve branch and defer merge/deploy to conductor authorization.
