# Feature: PW-D durable signal write admission

## Objective
Qualify and integrate Muse's durable write persistence on PW-B after A5.

## Scope / Guardrails
- One unpublished technical migration, globally numbered 0025 after A5.
- No route, H5 operation, deployment, push, or identity/session store.
- Make-only, Docker-only execution; no Python or environment-file access.
- Preserve the root checkout and every existing SQL migration byte.
- Tests: `ENV=test-api-paniers-pwd`, API 18932, UI 15932, Maildev 11932.
- One Docker campaign/build at a time; clean owned resources with volumes.
- Stop below 8 GiB available memory or disk.
- New commits contain at most 150 changed lines, no body or trailer.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/facets/pw-write*`
  - `api/src/db/schema-pw-write.ts`
  - `api/tests/integration/pw-write*`
  - `tools/make/base-api-pwd*`
  - `plan/PWD-BRANCH_feat-api-paniers-pwd.md`
  - `docs/spec/PW_D_PERSISTENCE.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans, except inherited A5 merge content.
- **Conditional Paths**:
  - `api/drizzle/**`, `api/src/db/schema.ts`: PWD-EX1.
  - A5 merge resolution files: PWD-EX2.

## Feedback Loop
- [x] PWD-EX1: owner explicitly requests A5-first journal integration and the
  PW-D schema spread; additive suffix only; rollback unshipped branch commits.
- [x] PWD-EX2: owner explicitly requests merge-commit integration and hunk-level
  conflict resolution; retain both account refusal and artifact composition,
  scoped purge listing and discriminating exclusive-blob assertions; rollback
  by reverting the integration merge, without rewriting either parent.
- [x] Merge imports A5 history intact; its aggregate diff necessarily exceeds
  150 lines. The 150-line ceiling applies to newly authored ordinary commits.

## Orchestration Mode (AI-selected)
- [x] Single local branch, serial Docker qualification, no push.

## UAT Management (in orchestration context)
- [x] No UI surface added; no UAT stack requested or started.

## Plan / Todo (lot-based)
- [x] Lot 0: preserve uncommitted input and base in a local rescue repository.
- [x] Lot 1: merge A5, preserve both conflict sides, allocate suffix 0025.
- [x] Lot 2: qualify durable challenge, fences, quota, audit/outbox primitives.
- [x] Lot 3: PostgreSQL, createApp, mutation, lint and typecheck gates.
- [x] Lot 4: bounded local commits, independently imported bundle, French report.
- [x] Qualification: 80 scoped tests, 4067 API tests passed, four killed/restored mutants.
- [x] Static gates: workspace typecheck, PW-D test typecheck, global lint, API build.
- [x] Delivery audit: base-seeded empty repository, bundle import, identical tree, full fsck.
- [x] Source bytes match the tested archive; owned Docker resources removed.

- [x] Delivery slice 01: docs(pw-d): declare integration and qualification scope.

- [x] Delivery slice 02: feat(pw-d): add durable write persistence tables.

- [x] Delivery slice 03: feat(pw-d): enforce immutable records and outbox delivery.

- [x] Delivery slice 04: feat(pw-d): register _journal.json.

- [x] Delivery slice 05: feat(pw-d): register schema-pw-write.ts.

- [x] Delivery slice 06: feat(pw-d): register schema.ts.

- [x] Delivery slice 07: feat(pw-d): register artifacts-finalization-authorization.spec.ts.

- [x] Delivery slice 08: test(pw-d): add pw-write-admission-db.test.ts.

- [x] Delivery slice 09: feat(pw-d): add pw-write-admission-durable.ts.

- [x] Delivery slice 10: test(pw-d): add pw-write-atomic-db.test.ts.

- [x] Delivery slice 11: feat(pw-d): add pw-write-audit.ts.

- [x] Delivery slice 12: feat(pw-d): add pw-write-confirm.ts.

- [x] Delivery slice 13: feat(pw-d): add pw-write-confirmation.ts.

- [x] Delivery slice 14: test(pw-d): add pw-write-digests.test.ts.

- [x] Delivery slice 15: feat(pw-d): add pw-write-digests.ts.

- [x] Delivery slice 16: feat(pw-d): add pw-write-errors.ts.

- [x] Delivery slice 17: test(pw-d): add pw-write-fences-db.test.ts.

- [x] Delivery slice 18: feat(pw-d): add pw-write-fences.ts.

- [x] Delivery slice 19: test(pw-d): add pw-write-fixture.ts.

- [x] Delivery slice 20: test(pw-d): add pw-write-migration-db.test.ts.

- [x] Delivery slice 21: feat(pw-d): add pw-write-outbox.ts.

- [x] Delivery slice 22: feat(pw-d): add pw-write-prepare.ts.

- [x] Delivery slice 23: test(pw-d): add pw-write-quotas-db.test.ts.

- [x] Delivery slice 24: feat(pw-d): add pw-write-quotas.ts.

- [x] Delivery slice 25: test(pw-d): add pw-write-refusals-db.test.ts.

- [x] Delivery slice 26: feat(pw-d): add pw-write-rejection.ts.

- [x] Delivery slice 27: test(pw-d): add pw-write-retention-db.test.ts.

- [x] Delivery slice 28: test(pw-d): add pw-write-store-db.test.ts.

- [x] Delivery slice 29: feat(pw-d): add pw-write-store.ts.

- [x] Delivery slice 30: feat(pw-d): add pw-write.ts.

- [x] Delivery slice 31: test(pw-d): add pw-write-createapp.spec.ts.

- [x] Delivery slice 32: docs(pw-d): add PW_D_PERSISTENCE.md.

- [x] Delivery slice 33: chore(pw-d): add base-api-pwd-commit.sh.

- [x] Delivery slice 34: chore(pw-d): add base-api-pwd-container.sh.

- [x] Delivery slice 35: chore(pw-d): add base-api-pwd-deliver.sh.

- [x] Delivery slice 36: chore(pw-d): add base-api-pwd-mutations.mjs.

- [x] Delivery slice 37: chore(pw-d): add base-api-pwd-verify.sh.

- [x] Delivery slice 38: chore(pw-d): add base-api-pwd.mk.

- [ ] Astra corrections: persistent fixed I/P follow-up window plus global quota.
- [ ] Astra corrections: typed terminal refusal independent of outbox delivery.
- [ ] Astra corrections: independent application cookie deadline at final admission.
- [ ] Astra corrections: normalized command keys, concealed revoke ownership, refusal audit.
- [ ] Astra corrections: exact-refusal mutations, scoped and CI API gates, lint/typecheck.
- [ ] Astra corrections: bounded commits, de81ef0e bundle audit, French report.
- [x] Astra slice 01: scope corrective qualification without publication.
- [x] Astra slice 02: persist I/P follow-up budgets and immutable public refusals.
- [x] Astra slice 03: enforce terminal refusal, session deadline and request audit in admission.
- [x] Astra slice 04: normalize preparation keys and conceal foreign revocation ownership.
- [x] Astra slice 05: regress lost refusals, fixed follow-up and expiry during final SQL wait.
- [x] Astra slice 06: regress I/P spacing, sixty reads, reload and global quota rollback.
- [x] Astra slice 07: regress preparation, foreign ownership, deadline and refusal audits.
- [x] Astra slice 08: support serial scoped reproduction, exact-refusal mutations and bundle audit.
- [x] Astra slice 09: document cookie provenance, follow-up ownership and terminal error persistence.
- [x] Astra slice 10: keep rescue packaging independent from shared read-only Git metadata.
- [x] Astra slice 11: initialize bundle-audit repositories without a worktree option.
- [x] Astra slice 12: wait up to three hours at two-minute intervals, never holding a lock needed by foreign stacks.
- [x] Astra slice 13: reconcile new table reexports and requestId inference after 102 passing scoped tests.
