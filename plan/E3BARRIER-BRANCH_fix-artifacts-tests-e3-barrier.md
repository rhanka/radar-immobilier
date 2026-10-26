# Fix: artifacts E3 commit barrier qualification

## Objective
- [x] Replace the two Q2 E3 injections with the confirmed public barrier ABI and align A4 calls.
- [x] Correct both helper reviews and requalify the final published 0.2.0 archives without changing delivered dependencies or runtime code.

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
- [x] Historical candidate: public barrier present, A4/executor absent; superseded by the verified final archive and public postgres-commit entrypoint.
- [x] Preserve the first diagnostic run: its setup asserted barrier absence and was corrected after inspecting the pinned tarball.

## Orchestration Mode (AI-selected)
- [x] Single assigned developer/tester/integrator; no external agent messaging.

## UAT Management (in orchestration context)
- [x] Test helpers only; isolated automated verification, no user UAT.

## Plan / Todo (lot-based)
- [x] Independently require every observed winner blob to survive loser cleanup, including the changed-command variant with no shared digest.
- [x] Observe both race preparations before winner COMMIT (the public inventory excludes completed successes), then sweep the loser by its deadline and preserve shared bytes/history assertions.
- [x] Preserve HTTP/MCP assertions and run a direct provider leg first for Q2 lock/E3 faults, so transport blockers cannot hide whether injections execute.
- [x] Configure the documented 30-second cleanup lifetime and compare the stored publication receipt (releaseId/manifest) separately from its HTTP projection.
- [x] Register cross-process race waits before execution, drain each once, and release/join both competitors before closing the worker.
- [x] Replace inspection-race polling with one registered wait/release per public barrier point; historical arrival is not a fresh pause.
- [x] Bind the published preparation-cleanup host (intents/refs/blobs/transactional claims), fix the A4 executor entrypoint, and observe the actual shared blob/deletion advisory lock.
- [x] Resolve the packaged migration through the public migrations wildcard export; no CommonJS root or unsupported Vitest import.meta.resolve is required.
- [x] Final receipt evidence: count/query operation_receipts using internal_key/receipt rather than the retired idempotency receipt store in all gated suites.
- [x] Final B2/B4: supply the real compiled profile to legacy commit/MCP probes, preserving all assertions; diagnose subsequent production-composition requirements separately.
- [x] Final A5/B3: inject binding/quota callback failures on the executed paths; E3 contends on a separate guard authority fixture after approval is already locked. Quota accounting remains uncovered.
- [x] Final A2/A3/A4/B1: apply the packaged coordinator migration, separate entry/revision reads, lock approval before the guard barrier, and use the published executor entrypoint.
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
- [x] Final archives: SHA-256 and SHA-512 match the owner receipt; all four public probes succeed.
- [x] Final Q1: 28 pass, one Radar transport failure, two explicit H3 quota gaps; zero skips.
- [x] Final Q2: 32 Radar transport failures, zero passes/skips; eight direct lock injections and two real E3 faults reach their assertions without converting partial legs into case passes.
- [x] Final acceptance: one pass, three Radar transport failures, two provider-contract divergences; zero skips.
- [x] Legacy commit probe: four missing-coordinator failures after the real compiled profile is supplied; MCP has five setup skips caused by the same production composition.
- [x] Final baseline: 3169 API tests pass, 533 skip, zero fail; all 69 gated cases skip; explicit acceptance/workspace typechecks and global lint pass.
- [x] Final test sources are frozen and hash-checked against the runner; the intermediate fifth run is excluded after its Q1 copy changed during execution.
- [x] Final candidate and baseline cleanups remove all project containers, volumes and networks; all campaigns stay above the 10 GiB stop threshold.
- [x] Remaining runtime migration belongs to Radar H3/H4; guard invocation and bounded host-timeout mapping discrepancies are handed to Sentropic L2/L6 in the companion report. Global qualification remains NO-GO.
