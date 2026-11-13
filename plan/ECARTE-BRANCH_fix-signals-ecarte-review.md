# Feature: Restore discarded signals from the relevance filter

## Objective
Fix #760 P1 while preserving #1090 period selection and perimeter counters. P2 and P3 are outside implementation scope.

## Scope / Guardrails
- Base: origin/main at a54f05eaa, including merged #1090 and #1094.
- Worktree: tmp/ecarte-review. No environment files or Python. No merge or commit trailers.
- Isolated runtime: test-ecarte, UI 5407, PostGIS 5547, S3 mock 9147. No API or Maildev host listeners.
- CDP: 127.0.0.1:9333 only, disposable tabs closed in finally. Real Playwright mouse clicks.
- Make-only execution through tmp/lane.mk, avoiding the root Makefile environment include. Always down -v.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/routes/scoped-projection-revisions*.ts`
  - `ui/src/lib/signals/graph-signal-detail-client*.ts`
  - `ui/src/lib/signals/signal-filter-counts*.ts`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/e2e-qa/signals-period-perimeter.spec.ts`
  - `ui/e2e-qa/signals-relevance-fixtures.ts`
  - `ui/e2e-qa/signals-relevance.harness.spec.ts`
  - `docs/spec/SPEC_BASE_API.md`
  - `plan/ECARTE-BRANCH_fix-signals-ecarte-review.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`
  - Other branch plans
- **Conditional Paths**:
  - BR760-EX2: owner-requested atomic restoration after independent compensation failures.
  - `api/src/services/facets/restore-classement.ts`
  - `api/src/routes/scoped-signal-facets.ts`
  - Rationale: existing in-transaction writers support one all-or-nothing restore and selection command.
  - Impact: one browser-session endpoint; existing membership, fingerprint, head and moderateArchive checks remain enforced.
  - Rollback: revert the atomic restoration commits.
  - BR760-EX1: owner-requested shared archive review blocker (#1092).
  - `ui/src/lib/signals/signal-classement*.ts`
  - `ui/src/lib/components/maps/SignalClassementMenu.svelte`
  - `ui/src/lib/components/maps/SignalClassementMenu.test.ts`
  - `ui/src/lib/components/maps/SignauxSelPanel.svelte`
  - `api/tests/integration/scoped-classement-*.spec.ts`
  - `ui/e2e-qa/signals-perimeter-fixture.ts`
  - Rationale: retain archive scopes and existing moderation controls through card reclassification.
  - Impact: existing restore routes only; no new authority, schema or endpoint.
  - Rollback: revert this correction's commits; original P1 remains independently reviewable.

## Feedback Loop
- [x] Owner replaces #1090 archive-free Filtre rule: include discarded signals when checked.
- [x] P2 analysis belongs to a separate lane. List P3 only in the PR.

## Orchestration Mode (AI-selected)
- [x] Single branch, no delegated implementation.

## UAT Management (in orchestration context)
- [x] Combined period, counter and restore regression through CDP 9333.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Evidence**
  - [x] Read project rules, harness-debug and harness-test.
  - [x] Confirm clean branch at the required base; #1090 remains open.
  - [x] Trace missing reload and unconditional archive removal in coherent-city and Filtre.
- [x] **Lot 1 — Regression and correction**
  - [x] Capture red API, unit and browser regression.
  - [x] Add explicit authorized discarded-card reads and reload on relevance visibility change.
  - [x] Align totals and Filtre with the selected relevance classes.
  - [x] Confirm restore and reload persistence.
- [x] **Lot 2 — Validation and delivery**
  - [x] Run typecheck, lint, test-ui, concerned API tests and combined browser suite.
  - [x] Tear down every isolated stack with down -v and close disposable browser tabs.
  - [x] Check #1090 merge state; rebase when merged.
  - [x] Push and open PR referencing #760, listing P3 without implementing them.

## Evidence
- [x] Final rebased gates pass: typecheck (0 errors, 8 Svelte warnings), lint (0 errors, 1 warning), full UI suite (1,900 passing, 10 todo; 145 files passing, one skipped), 300 targeted API/PostgreSQL tests across 25 files. Logs: tmp/rebased-{final-typecheck,final-lint,test-ui,api,graph-store}.log.
- [x] All 18 real-click CDP scenarios pass after rebase: 7 period/perimeter/global-relevance cases (16.7 s) and 11 actual Hono/PostgreSQL archive cases (36.85 s). Includes six periods, class removal, pertinent-only total, map membership, checked archives, personal/shared/both restores, role refusal, late fingerprint 409, shared/selection head conflicts, lost 502/network responses, default-list return and F5 persistence. Logs: tmp/rebased-final-e2e.log, tmp/rebased-browser-stable.log.
- [x] Browser diagnostics: earlier runs exposed Vite HMR during a click and ERR_NETWORK_CHANGED during imports; one timeout's diagnostic also masked its original error. Register fixtures before one app boot, bound actions to 1,800 ms and preserve the original error. Final runs execute sequentially without source edits or concurrent quality jobs; no timeout was increased.
- [x] Both isolated stacks removed with down -v; the dedicated test browser was closed. No environment file, Python, merge or commit trailer. Manual scope/diff checks pass; independent peer consensus is unavailable (tmp/resume-review.md).
- [x] Rebase on a54f05eaa: resolved the rail conflict by retaining #1094's shared count cache for membership, sort, badges and totals. Removed the duplicate countedEntries path from #1092.
- [x] Semantic merge: displayedSignalCountForCity now includes every checked class, including archives, for both rail and map; older cubes without a class dimension remain unavailable when archives are requested. Preserve global #1094 unit cases and adjust archive expectations.
- [x] SignauxMapView merged without textual conflict: retain #1094's cartographic filter and count cache, plus #1092's showDiscarded reads and detail reload when visibility changes.
- [x] Preserve both #1094 browser scenarios; make archive fixtures honor date bounds and showDiscarded. Verify checked archives enter totals, cities and map, while unchecked archives stay excluded.
- [x] Resumed correction validation before rebase: typecheck, lint and full test-ui pass; 74 targeted API/PostgreSQL tests pass on a fresh database; 11 real-click PostgreSQL archive scenarios and 5 period/perimeter scenarios pass through CDP 9333. Logs: tmp/resume-*.log.
- [x] Second correction: reproduced both independent failures on fff272af5. Log: tmp/atomic-red-review.log (2 failed, 1 passed).
- [x] Atomic server operation uses the existing in-transaction personal and workspace writers, including the final selection. Six PostgreSQL tests are red on fff272af5 and green with the new route. Logs: tmp/atomic-{red-api,green-api-initial}.log.
- [x] Archive restoration now sends one idempotent command, retries uncertain transport with the same payload/key, then reconciles real server state if both replies are lost. No client archive compensation remains. A status awaiting verification never announces a definite failure.
- [x] The PostgreSQL regression checks rollback of archive heads and revision tokens after shared-head or selection failure, fingerprint conflicts, receipt replay after refresh, changed-payload rejection, moderation and browser-session guards. The period fixture now speaks the atomic command; all five #1090/perimeter browser scenarios pass.
- [x] Shared archive blocker reproduced on 87d8e7b6: API regression 2 failures; CDP regression 3 failures and personal restoration passes. Logs: tmp/shared-red-{api,browser}.log.
- [x] Shared archive correction: role refusal, independent scope restoration and default-list reload persistence.
- [x] Reusable browser fixture and standalone PostgreSQL route regression committed.
- [x] Existing period suite uses the shared fixture.
- [x] Real-click PostgreSQL browser regression and validation evidence committed.
- [x] Final correction gates: typecheck (0 errors, 8 warnings), lint (0 errors, 1 warning), UI 1,897 passing tests and 10 todo, 28 concerned API tests, four real-click PostgreSQL browser scenarios, five period/perimeter scenarios. Logs: tmp/shared-{typecheck,lint,test-ui,green-api,green-browser,e2e}.log.
- [x] Browser transport forwards facet requests into the real Hono routes and disposable PostgreSQL databases; authentication and map data are synthetic. Shared and double archives return to the default list and survive reload. Contributor options are disabled with a visible explanation; API independently refuses restoration with 403.
- [x] No API authorization change: existing workspace/restore requires moderateArchive. Personal and workspace streams stay independent, including compensation after a later write fails.
- [x] Runtime and database removed with down -v. Disposable CDP contexts close in finally; unrelated existing browser tabs are preserved.
- [x] Harness branch and explicit staged-path scope checks pass. Peer selection unavailable under harness/review (unknown exact author model/effort; no h2a_run MCP); tmp/shared-review.md records selection-failed, without consensus.
- [x] API red: scoped-projection-revisions-db returns no archived card with showDiscarded=1. Unit red: Filtre returns 12 instead of 13. Logs: tmp/red-api.log, tmp/red-unit.log.
- [x] Identical browser suite on 564971d24 UI sources: 3 pass, 2 fail (total remains 12, archived cards remain 6 instead of 7). Fixed sources: 5 pass. Logs: tmp/red-e2e-baseline.log, tmp/green-e2e-final.log.
- [x] Browser coverage uses Playwright clicks over the full application, synthetic stateful API responses, and disposable CDP 9333 tabs. Real PostGIS API tests independently cover visibility, authorization, fingerprints, restoration and archive scopes. This is not a live preprod write campaign.
- [x] UI: 145 files, 1895 passing tests, 10 todo. API: 19 files, 272 passing tests. Typecheck: 0 errors / 8 warnings after copying the complete isolated dependency tree. Lint: 0 errors / 1 warning.
- [x] Harness scope and branch checks pass. Independent consensus unavailable: exact author model/effort metadata and h2a_run MCP are unavailable; no consensus claimed (tmp/review.md).
- [x] Rebased on 0742dae98 after #1090 merged. Final gates repeated on the rebased sources: typecheck and lint pass; UI 1895 tests; API 272 tests; browser 5 scenarios in 14.7 seconds. Logs: tmp/final-{typecheck,lint,test-ui,test-api,test-e2e}.log.
- [x] CDP target inventory contains no tab at this lane's origin. Database and runtime teardown use down -v. Root checkout and UAT services are untouched.
- [x] Delivery: PR #1092 targets main and remains open, with P2 excluded and all five P3 findings listed. CI queued at opening. No commit trailers, no merge.
