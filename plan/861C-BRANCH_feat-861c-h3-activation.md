# H3 activation — branch scope for feat/861c-h3 (first PR, units 1-4)

**Type**: feature · **Base**: `main` at `7c56bb93` (H1+H2 merged) · **Branch**: `feat/861c-h3`
**Workspace**: `/home/antoinefa/src/radar-immobilier/.worktrees/861c-h3`
**Reference design**: `.lanes/conductor/tmp/861c/conception-h3-v1.md` (§10, units 1-4 only)
**Design review**: `.lanes/conductor/tmp/revues/astra-conception-h3.md` (approved, two non-blocking points)

## Objective

Deliver the first H3 pull request: branch scope, activation parser, cohort/approval
admission with commit-time reread, and private control cache headers. No provider
quota dependency, no deployment change. Each test below fails without its fix and
carries its §H matrix identifier where one exists.

Review integration (both non-blocking points):

- Concurrency wording (review point 1, §8 line 363): precise multi-process,
  distinct-idempotency-key competition for the last reservation belongs to unit 5
  (provider budgets). This PR only guarantees refusal paths never allocate, which
  holds regardless of process count.
- Commit-time authority (review point 2, §5.1 + §8 line 366): the authority source,
  and the result are defined in `packages/artifacts-host/src/admission.ts`:
  reread `account_users.status` and activation before storage dispatch, without
  deliberate grace. This seam does not cover a provider commit already in flight;
  no measured drain bound or instantaneous cutoff is claimed.

## Scope / Guardrails

- English code, tests and identifiers; no Python; never read `.env`.
- Reuse `api/src/artifacts/` and `packages/artifacts-host/`; no copied domain logic.
- Do not touch `api/src/config.ts`, the root `Makefile`, or root `docker-compose*`.
- Isolated tooling only: `tools/artifact-host.mk` (unchanged in this pass — the
  existing `test-host`, `test-api`, `typecheck` and `lint` targets already cover the
  new unit suites; no root Makefile include, no `.env` loading).
- Production startup wiring (`api/src/index.ts`, `api/src/app.ts`,
  `api/src/artifacts/control-route-startup.ts`) is deferred to a later unit: this PR
  adds the admission seam as an optional dependency so existing H2 behavior is
  preserved when no activation reader is provided.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `plan/861C-BRANCH_feat-861c-h3-activation.md`
  - `packages/artifacts-host/src/activation.ts`, `activation.test.ts`
  - `packages/artifacts-host/src/admission.ts`, `admission.test.ts`
  - `packages/artifacts-host/src/admission-commit.test.ts`
  - `packages/artifacts-host/src/facade.ts` (optional admission seam only)
  - `packages/artifacts-host/src/index.ts` (re-exports only)
  - `api/src/artifacts/control-cache.ts`, `control-cache.test.ts`
  - `api/src/artifacts/control-cache-errors.test.ts`
  - `api/src/artifacts/control-route.ts` (activation admission + cache headers only)
  - `api/src/artifacts/control-route-activation.test.ts`
  - `api/src/artifacts/control-route-commit.test.ts`
  - `RAPPORT-MUSE-H3-P1.md`, `RAPPORT-SOL-H3-P1.md` (uncommitted deliverables)
  - `tmp/861c-h3-p1/**` (ignored logs, copies, local Git and bundle)
- **Forbidden Paths (must not change in this branch)**:
  - `api/src/config.ts`, root `Makefile`, root `docker-compose*.yml`
  - `rules/**`, agent bootstrap files, other `plan/*-BRANCH_*.md`
  - Business routes, MCP composition, product UI
  - Upstream `@sentropic/artifacts` library sources
  - Provider quotas/reservations, migrations, denial service, image, nginx,
    preprod resources (units 5-15, later PRs)
- **Conditional Paths (allowed only with an explicit exception recorded here)**:
  - `tools/artifact-host.mk` — no change required in this pass
  - `api/src/index.ts`, `api/src/app.ts`, `api/src/artifacts/control-route-startup.ts`
    — deferred (production wiring of the activation reader)

## Deliverables

- [x] **Unit 1 — scope**: this plan; isolated tooling statement (no Makefile change).
- [x] **Unit 2 — activation parser** (§5.1): absent, incomplete, malformed and
      expired inputs stay closed by default; `off` disables; `validation` with exact
      subjects and a future `ARTIFACTS_VALIDATION_UNTIL` enables.
  - [x] Activation parser and exports.
  - [x] Parser regression tests.
- [ ] **Unit 3 — cohort/approval admission** (T02, T05, T17, T24; T05, T13):
      unknown, suspended, expired or non-cohort subjects are refused with no storage
      dispatch; authority is reread before dispatch, including suspension after entry.
      Authorization inside an in-flight provider commit remains unverified.
  - [x] Shared admission and facade seam.
  - [x] Refusal regression tests.
  - [ ] Async query and pre-dispatch reread tests.
  - [ ] HTTP admission seam.
  - [ ] HTTP entry regression tests.
  - [ ] HTTP reread regression tests.
- [ ] **Unit 4 — control cache headers** (§5.3, T29): `Cache-Control: private, no-store`
      plus `Vary: Cookie, Authorization` on control successes, errors and account-switch
      responses.
  - [ ] Final-response cache middleware.
  - [ ] Success, refusal and account-switch cache tests.
  - [ ] Parent-handler exception cache tests.

## Verification

Ports: API 18913, UI 15913, Maildev UI 11913; the test compose publishes none.

```sh
rtk make -f tools/artifact-host.mk test-host SCOPE=src/artifacts API_PORT=18913 UI_PORT=15913 MAILDEV_UI_PORT=11913 ENV=test-861c-h3
rtk make -f tools/artifact-host.mk test-api SCOPE=src/artifacts API_PORT=18913 UI_PORT=15913 MAILDEV_UI_PORT=11913 ENV=test-861c-h3
rtk make -f tools/artifact-host.mk test-api SCOPE="--exclude tests/integration/**" API_PORT=18913 UI_PORT=15913 MAILDEV_UI_PORT=11913 ENV=test-861c-h3
rtk make -f tools/artifact-host.mk test-api SCOPE="tests/integration/artifacts --no-file-parallelism" API_PORT=18913 UI_PORT=15913 MAILDEV_UI_PORT=11913 ENV=test-861c-h3
rtk make -f tools/artifact-host.mk typecheck API_PORT=18913 UI_PORT=15913 MAILDEV_UI_PORT=11913 ENV=test-861c-h3
rtk make -f tools/artifact-host.mk lint API_PORT=18913 UI_PORT=15913 MAILDEV_UI_PORT=11913 ENV=test-861c-h3
rtk make -f tools/artifact-host.mk down API_PORT=18913 UI_PORT=15913 MAILDEV_UI_PORT=11913 ENV=test-861c-h3
rtk make -f tools/artifact-host.mk inspect API_PORT=18913 UI_PORT=15913 MAILDEV_UI_PORT=11913 ENV=test-861c-h3
```

`ENV` stays last in every command. Teardown (`down -v --remove-orphans`) must be
followed by `inspect` proving no project containers, volumes or networks remain.

## Not covered (later H3 units)

Provider quota binding and migration, commit-time failure accounting, denial
listener, runtime image smoke, nginx route limit, preprod resources, render/operator
preflight, rollback documentation, and production startup wiring of the activation
reader.

## Feedback Loop

- Reviewer selection: exact Muse model/effort unavailable; no complementary peer
  consensus claimed. Local integration review and executable evidence are required.
