# Fix: artifacts E3 commit barrier qualification

## Objective
- [x] Replace the two Q2 E3 injections with the confirmed public barrier ABI and align A4 calls.

## Scope / Guardrails
- [x] Worktree `tmp/artifacts-e3-barrier`; branch `fix/artifacts-tests-e3-barrier`; base `dde9f4c8`.
- [x] Make only, no Python, no `.env` reads, no dependency changes, no push.
- [x] Test environment `test-e3-barrier`; API 18922, UI 15922, Maildev 11922.
- [x] One Docker test stack machine-wide; stop below 10 GiB; remove volumes and orphans.
- [x] Local backup Git repository; English Conventional Commits, empty bodies, at most 150 changed lines.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `api/tests/integration/artifacts-*.ts`, this plan, requested report.
- [x] Forbidden Paths: root Makefile, compose files, rules, agent instructions, runtime code, dependency manifests and lockfile.
- [x] Conditional Paths: ignored runners, evidence and delivery repositories under `tmp/**`.

## Feedback Loop
- [x] Owner brief authorizes French report and commits without trailers.
- [x] Upstream ABI read from `sentropic/tmp/worktrees/861-contract-gaps/packages/artifacts/src/testing.ts`; no Sentropic writes.
- [x] Verified candidate 0.2.0 exports the public barrier, contrary to the brief; A4 seams and the public executor are absent. Missing contracts remain failures.
- [x] Preserve the first diagnostic run: its setup asserted barrier absence and was corrected after inspecting the pinned tarball.

## Orchestration Mode (AI-selected)
- [x] Single assigned developer/tester/integrator; no external agent messaging.

## UAT Management (in orchestration context)
- [x] Test helpers only; isolated automated verification, no user UAT.

## Plan / Todo (lot-based)
- [x] Final A1/A6: require ordinary retriable=false and classify invalid callable exports as contract violations.
- [x] Lot 0: rules, predecessor report, branch, local upstream ABI and machine capacity.
- [x] Lot 1: barrier factory/options and removal of the obsolete phase seam.
- [x] Lot 1a: confirmed factory/options and transparent PostgreSQL fault observer.
- [x] Lot 1b: register correlated waits before transport execution; make cleanup release idempotent.
- [x] Lot 2: two E3 cases with real PostgreSQL faults, no retry, rollback and resumed authority checks (candidate execution pending).
- [x] Lot 3: A4 typed host binding and public seam calls (candidate execution pending).
- [x] Lot 3a: release a paused barrier once, including A4 finally cleanup; require invocation IDs.
- [x] Lot 3b: revoke host authority at before_commit after an allowed guard; require a second guard and rollback on resume.
- [x] Lot 3c: preserve the public callable observer plus arrival method type at the dynamic factory boundary.
- [x] Lot 3d: count commits from the paused finalization, without constraining earlier preparation transactions.
- [x] Lot 4: candidate missing-contract evidence; baseline API suite, lint and typecheck.
- [x] Baseline: 3169 API tests pass, 533 skip, zero fail; all 69 ACC/Q1/Q2 cases skip.
- [x] Candidate: 63 failures, zero passes/skips; 59 missing public executor, two missing A4 pause seam, two H3 quota gaps.
- [x] Installed 0.1.2: both selected E3 cases fail by createArtifactCommitBarrier; all three testing symbols independently fail by exact name.
- [x] Final acceptance typecheck and lint pass; workspace typecheck passes with seven Svelte warnings.
- [x] Lot 5: atomic history, companion report, audited bundle from the base and stack cleanup.
- [x] Real E3 fault/rollback/authority behavior and A4 races remain unqualified until the public upstream prerequisites ship.
