# Fix: artifacts E3 commit barrier qualification

## Objective
- [ ] Replace the two Q2 E3 injections with the confirmed public barrier ABI and align A4 calls.

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
- [x] Candidate 0.2.0 lacks the public testing entry; missing contracts must remain failures.

## Orchestration Mode (AI-selected)
- [x] Single assigned developer/tester/integrator; no external agent messaging.

## UAT Management (in orchestration context)
- [x] Test helpers only; isolated automated verification, no user UAT.

## Plan / Todo (lot-based)
- [x] Lot 0: rules, predecessor report, branch, local upstream ABI and machine capacity.
- [x] Lot 1: barrier factory/options and removal of the obsolete phase seam.
- [x] Lot 1a: confirmed factory/options and transparent PostgreSQL fault observer.
- [x] Lot 1b: register correlated waits before transport execution; make cleanup release idempotent.
- [x] Lot 2: two E3 cases with real PostgreSQL faults, no retry, rollback and resumed authority checks (candidate execution pending).
- [x] Lot 3: A4 typed host binding and public seam calls (candidate execution pending).
- [ ] Lot 4: candidate missing-contract evidence; baseline API suite, lint and typecheck.
- [ ] Lot 5: atomic history, report, audited bundle from the base and stack cleanup.
