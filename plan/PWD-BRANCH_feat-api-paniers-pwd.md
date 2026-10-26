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
- [ ] Lot 4: bounded local commits, independently imported bundle, French report.

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
