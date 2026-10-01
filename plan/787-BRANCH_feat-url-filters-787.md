# Feature: Shareable geographic filters (#787)

## Objective
Make every existing geographic view restore its applicable active filters and period from a coherent, authoritative URL. Preserve the residual vivier and existing date semantics.

## Scope / Guardrails
- Scope limited to geographic filter controls, their router state, navigation and regression evidence.
- Make-only, Docker-first execution; ignored `tmp/issue-787.mk` supplies missing harness/browser targets without changing Makefile.
- Root checkout and fixed dev/UAT ports are reserved; no root edits, deployment, merge, refresh or data collection.
- Development worktree: `tmp/feat-url-filters-787`, branch `feat/url-filters-787`.
- Automated stacks: `test-url-filters-787` / `e2e-url-filters-787`; ENV always last.
- Ports: API 8898, UI 5398, Maildev UI 1198, Postgres 5639, S3 9198, Obscura 9398, SMTP 1098; UI API URL aligned to 8898.
- CDP 9222 may be used only through a dedicated new tab; preserve existing tabs.
- No #786 document/ingestion selector or date-semantic changes; no #788 collection options.
- English code/docs/commits; French owner communication.
- Conductor owns Track and issue/project writes; lane writes no `.track`.
- Runtime `.codex/config.toml` remains uncommitted.
- Atomic selective commits at most 150 changed lines; update this plan in each commit.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/router/*` (filter grammar, URL/router restoration and tests)
  - `ui/src/lib/components/maps/SignauxMapView*`
  - `ui/src/lib/components/maps/SignauxRail*`
  - `ui/src/lib/components/maps/SignauxSelPanel.svelte`
  - `ui/src/lib/components/maps/RailCityList.svelte`
  - `ui/src/lib/components/maps/EvaluationMapView*`
  - `ui/src/lib/components/sources-map/SourceMapView*`
  - `ui/src/lib/components/sources-map/SourceCoverageMap*`
  - `ui/src/lib/components/sources-map/SourceConsole*`
  - `ui/src/lib/components/sources-map/SourcesRail.svelte`
  - `ui/src/lib/maps/geo-level-navigation*`
  - `ui/src/lib/signals/vivier-view-mode.ts` and directly related route tests
  - `ui/e2e-qa/*url-filters*` (browser regression proof)
  - `plan/787-BRANCH_feat-url-filters-787.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans, root checkout, `.track/**`, `.agents/**`, committed `.codex/**`
  - Source adapters, collection, scoring, deployment and date-selector work
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - Existing API/MCP/chat request-to-geo filter mapping and tests, only if traced evidence proves a direct blocker
  - Minimal scoped specification if needed
- **Exception process**:
  - Record `BR787-EXn` in Feedback Loop before conditional edits, with reason, impact and rollback.

## Feedback Loop
- [x] BR787-D1: native launch requested `gpt-6.1-sol`, xhigh, priority (fast); effective identity cannot be independently attested by lane tools.
- [x] BR787-D2: date-only URL requests reset all omitted restrictions; changing the existing date picker preserves explicitly active filters and writes their complete state.
- [x] BR787-D3: no new chat/MCP UX; current chat has no geographic-filter mapping, so URL is the evidenced request entry point.
- [x] BR787-D4: canonical named axes replace outward `filter.subset`; bounded old-link parsing normalizes into the sole residual vivier.
- [x] BR787-D5: hash-based geographic views require their existing page query state; no new top-level view or business control.
- [x] BR787-D6: preserve the existing zones-only URL restriction across navigation; date-only requests clear it. Ignore superseded bulk date responses during history navigation.
- [x] BR787-D7: local API bootstrap hid UI-specific dependencies behind its empty named volume; seed that isolated UI volume and keep host dependencies removed. Temporary gate makefile mounts both volumes; rollback stops only this stack.
- [x] BR787-EX1: final control audit found local CPTAQ activation and city/zone/lot searches. Add their existing control files to scope and bind their state to the same URL snapshot. Impact: shared links override those local restrictions too; rollback is limited to these bindings. Basemap and label presentation remain unchanged.
- [x] BR787-D8: browser navigation exposed the existing lot-to-city route collapse and missing Zone-to-City URL transition. Preserve lot focus through existing selected/focused query primitives on its zone route, and synchronize the existing City/Close controls. No new geographic route or UX.
- [x] BR787-D9: CDP evidence showed the test page becoming hidden and receiving no animation frame in 500ms after reload. Create and dispose only an owned browser context/window/tab on existing CDP 9222, preserving user tabs and control waits below 2s.
- [x] BR787-D10: harness review selection has no configured live gateway catalog and no two exact complementary Claude model IDs. Record `selection-failed` in local proof dossier; no leg dispatched or consensus claimed. Draft publication remains reviewable; merge/UAT remain gated.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (template label only; no cherry-pick or additional integration branch)
- [ ] **Multi-branch**
- Rationale: one isolated branch, sequential implementation; harness complementary review at final target.

## UAT Management (in orchestration context)
- Root dev UAT remains conductor-owned at fixed ports; automated branch proof is not UAT acceptance.
- [ ] Owner UAT accepted (outside lane authorization; remains open).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read mandatory project rules and harness process skills.
  - [x] Confirm branch, isolated worktree, base SHA and uncommitted fast runtime config.
  - [x] Capture make target gaps; open harness branch recorder via ignored Docker-first make target.
  - [x] Define isolated environment and full port mapping; inspect containers before startup.
  - [x] Trace incomplete axes/date/exclusion persistence and navigation loss.
  - [x] Confirm bounded scope and request entry point.

- [x] **Lot 1 — Dates and business filter grammar**
  - [x] Add typed local signal/lot/zone URL serialization and restoration with unrestricted omitted filters.
  - [x] Preserve exact relative/absolute civil-date bounds and normalize old subset links.
  - [x] Regression tests: round trip, preferences independence, date-only reset, canonical old links.
  - [x] Gate: five codec regressions pass; 30 scoped router/navigation/component checks pass.

- [x] **Lot 2 — Signal geographic controls and navigation**
  - [x] Wire existing dates/axes/exclusions/lots/zones/CPTAQ and list searches to URL.
  - [x] Restore complete state before data loading, including same-city back/forward.
  - [x] Preserve filters across province/city/zone navigation and reload.
  - [x] Gate: component/router regressions and real CDP browser proof for dates/business filters, searches, CPTAQ, zone/lot/city/province and reload/history.

- [x] **Lot 3 — Other geographic views, Sources second**
  - [x] Wire Evaluation source/category/usages/minimum area/prospect/tab and Sources scope/status/focus/search/KPI/tab.
  - [x] Restore hash page filters on share/reload/back/forward without hidden preferences.
  - [x] Gate: scoped view tests and real browser proof, with API fixtures disclosed.

- [ ] **Lot 4 — Verification and reviewable draft**
  - [x] Full UI suite: 1615 passed / 10 todo; same-city/lot restoration: 18 component checks; 7 final router checks; typecheck: 0 errors / 7 existing warnings; build/lint passed.
  - [x] Real Playwright/CDP 9222 proof against isolated branch UI: eight scenarios, zero JS errors. API fixtures make this browser integration proof; full live-data E2E and owner UAT remain unaccepted.
  - [x] Harness C1 branch and C2 scope gates pass.
  - [ ] Complementary peer review: selection-failed; absent live catalog, no eligible pair selected. See local proof dossier; no consensus verdict.
  - [ ] Reconcile findings and update this plan/status with evidence.
  - [ ] Push branch and create draft PR linked to #787; no merge/deploy.
  - [ ] Report full head SHA, PR, checks and remaining acceptance limits to conductor.
  - [ ] Stop isolated stack after evidence collection; preserve all root services and data.

- [ ] **Lot 5 — Owner-controlled merge & close**
  - [ ] Owner UAT and CI accepted.
  - [ ] Merge commit, branch preservation and plan archival (not authorized for this lane).
