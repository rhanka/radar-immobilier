# Feature: PW-A write authority qualification

## Objective
Qualify and correct the uncommitted PW-A authority layer on 39ed4f1b.

## Scope / Guardrails
- Preserve merges 512ca686 and 39ed4f1b; no push or history rewrite.
- Make-only, Docker-only, no Python or environment-file reads.
- ENV=test-api-paniers-pwa, API 18933, UI 15933, Maildev 11933.
- One stack/build at a time; stop below 8 GiB disk or available memory.
- At most 150 changed lines per new commit; subject only, no trailer.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/artifacts/write-*`
  - `api/src/app.ts`, `api/src/config.ts`
  - `api/tests/integration/pw-write-authority*`
  - `tools/make/base-api-pwa*`
  - `plan/PWA-BRANCH_feat-api-paniers-pwa.md`
  - `RAPPORT-SOL-PWA.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, other branch plans
  - PW-B/PW-D implementations, migrations, A6 read contracts
- **Conditional Paths**:
  - `api/tests/integration/pw-write-createapp.spec.ts`: PWA-EX1.

## Feedback Loop
- [x] PWA-EX1: inherited createApp assertion must expect the new closed 503
  mount rather than an absent route. Test-only impact; rollback these two lines.
- [x] Execution and HTML summary remain PW-C; PW-A supplies guarded seams.
- [x] PW-D parallel corrections stay external: status budget, terminal refusal,
  session expiry at transactional confirmation. Preserve an explicit expiry seam.

## Orchestration Mode (AI-selected)
- [x] One local branch; serial Docker campaigns; no publication.

## UAT Management (in orchestration context)
- [x] No UI delivery or UAT requested; root checkout untouched.

## Plan / Todo (lot-based)
- [x] Lot 0: rules, inherited history and rescue bundle/uncommitted archive.
- [ ] Lot 1: strict grants, schemas, bindings and idempotent preparation.
- [ ] Lot 2: cookie-only, principal, CSRF and bounded application mounting.
- [ ] Lot 3: unit/PG/createApp, discriminating mutations, API CI parity,
  ARTEFACTS/MCP, lint and typecheck.
- [ ] Lot 4: atomic commits, bundle from de81ef0e, isolated import audit/report.

- [x] Delivery: `api/src/app.ts`.

- [x] Delivery: `api/src/artifacts/write-grant.test.ts`.

- [x] Delivery: `api/src/artifacts/write-grant.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-app-authority.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-app-guard.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-app-route.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-app-route.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-authority.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-binding.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-binding.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-challenge.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-challenge.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-csrf.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-csrf.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-errors.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-h5-route.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-h5-route.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-page-authority.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-principal.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-refusal.test.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-refusal.ts`.

- [x] Delivery: `api/src/artifacts/write-intent-schemas.test.ts`.
