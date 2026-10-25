# Fix: frozen artifacts acceptance profile

## Objective
- [ ] Align Q1/Q2 acceptance helpers with the candidate 0.2.0 public contract.

## Scope / Guardrails
- [x] Worktree: `tmp/artifacts-profile-helpers`; base `8d6aabb0`.
- [x] Never read `.env`; no host package installation or Python execution.
- [x] Make-only commands; `ENV` last; one Docker test stack machine-wide.
- [x] Test environment: `test-profile-helpers`; API 18920, UI 15920, Maildev 11920.
- [x] Stop below 10 GiB free; bounded tests; remove test volumes and orphans.
- [x] Shared Git metadata is read-only; use an ignored local backup repository.
- [x] English Conventional Commit subjects; empty bodies; at most 150 changed lines.
- [x] No push; deliver and audit a bundle from `8d6aabb0` in a fresh repository.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `api/tests/integration/artifacts-*.ts`, this plan, requested report.
- [x] Forbidden Paths: root Makefile, compose files, rules, agent instructions, runtime code, dependency manifests and lockfile.
- [x] Conditional Paths: ignored qualification runners and evidence under `tmp/**`.

## Feedback Loop
- [x] Owner brief explicitly authorizes French delivery report and commits without trailers.
- [x] Candidate archives absent from the brief's directory; locate the matching L8d archives cited by the analysis and verify hashes before use.

## Orchestration Mode (AI-selected)
- [x] Single developer on the assigned branch; no external agent messaging.

## UAT Management (in orchestration context)
- [x] Acceptance helpers only; isolated automated qualification.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, full conductor analysis, and candidate public declarations.
- [x] Lot 1: frozen profile input, digest and semantic mutation.
- [x] Lot 2: participant authorization, policy reads and outcome names.
- [x] Lot 2a: use participant admission/revision/approval methods and minted fences; remove guard SQL.
- [x] Lot 3: public coordinator, provider composition and E3 binding probes.
- [x] Lot 3a: replace unconditional constructor stubs and register leased policy reads.
- [x] Lot 3b: compose the r2 candidate app with real stores, domain writers and invocation-scoped locks.
- [ ] Lot 4: before/after Q1/Q2 candidate qualification and failure classification.
- [ ] Lot 5: full CI-equivalent API suite without candidate, lint and typecheck.
- [ ] Lot 6: report, atomic history, bundle audit and test-stack cleanup.
