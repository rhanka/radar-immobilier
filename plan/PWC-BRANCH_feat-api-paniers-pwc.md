# Feature: PW-C page and application write surfaces

## Objective
Qualify, repair and integrate the supplied PW-C implementation on 07ef2757.

## Scope / Guardrails
- Make-only, Docker-only; no Python, environment-file reads or push.
- Worktree: `tmp/api-paniers-pwc`; root UAT checkout remains unchanged.
- Test ENV: `test-api-paniers-pwc`; API 18934, UI 15934, Maildev 11934.
- ENV is the last Make argument; wait for foreign test stacks before starting.
- Remove only owned resources with `down -v --remove-orphans`.
- At most 150 changed lines per commit; English subject only, no trailer.
- Preserve page/app separation, exact principals and existing login/session.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/artifacts/write-intent-*` except the transaction implementation.
  - `api/src/artifacts/content-serve.ts`, `content-serve.test.ts`.
  - `ui/nginx/default.conf`, `deploy/k8s/nginx/default.conf`.
  - `tools/make/base-api-pwc*`.
  - `plan/PWC-BRANCH_feat-api-paniers-pwc.md`, `RAPPORT-SOL-PWC.md`.
- **Forbidden Paths (must not change in this branch)**:
  - `api/src/artifacts/write-intent-transaction.ts`.
  - `Makefile`, `docker-compose*.yml`, `rules/**`.
  - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, other branch plans.
  - PW-B/PW-D implementation, migrations and A6 read contracts.
- **Conditional Paths**:
  - None; no scope exception required.

## Feedback Loop
- [x] Supplied implementation and complete Muse report reviewed.
- [x] Baseline failures captured before corrections.

## Orchestration Mode (AI-selected)
- [x] One local branch; serial campaigns; local rescue repository and bundle.

## UAT Management (in orchestration context)
- [x] Browser/two-host qualification belongs to PW-E; root UAT untouched.

## Plan / Todo (lot-based)
- [x] Lot 0: rules, baseline, isolated ports and read-only shared Git.
- [ ] Lot 1: application dispatch, documents and cookie/CSRF guards.
- [ ] Lot 2: page preparation, listener and bounded follow-up.
- [ ] Lot 3: unit/PostgreSQL, API suite, static gates and mutations.
- [ ] Lot 4: atomic delivery, prerequisite-only bundle audit and report.

- [x] Delivery: feat(pw-c): dispatch confirmation and serialize revocations.

- [x] Delivery: feat(pw-c): serve the controlled application script.

- [x] Delivery: feat(pw-c): add escaped application document helpers.

- [x] Delivery: feat(pw-c): render summary and management documents.

- [x] Delivery: feat(pw-c): wire exact application routes and document hooks.

- [x] Delivery: test(pw-c): cover rendered documents and script policy.

- [x] Delivery: feat(pw-c): define page gesture contracts and poll bounds.

- [x] Delivery: feat(pw-c): validate gestures and create isolated app links.

- [x] Delivery: feat(pw-c): prepare gestures with stable uncertain retries.

- [x] Delivery: feat(pw-c): project status and rate limits on the page.

- [x] Delivery: feat(pw-c): bound automatic and manual intent follow-up.

- [x] Delivery: test(pw-c): define page browser fixtures and elements.

- [x] Delivery: test(pw-c): execute served page bytes in a browser harness.

- [x] Delivery: test(pw-c): verify gestures, isolated links and exact retries.

- [x] Delivery: test(pw-c): cover terminal states and polling limits.

- [x] Delivery: test(pw-c): discriminate page retries and follow-up races.

- [x] Delivery: test(pw-c): require explicit app confirmation gestures.

- [x] Delivery: feat(pw-c): forward page preparation and status to H5.

- [x] Delivery: test(pw-c): verify listener authority and typed refusals.

- [x] Delivery: feat(pw-c): mount page writes and proxy application routes.

- [x] Delivery: test(pw-c): cover rights loss and cookie remint on postgres.

- [x] Delivery: test(pw-c): qualify app confirmation and revocation on postgres.

- [x] Delivery: test(pw-c): discriminate principals, CSRF and revoke races.

- [x] Delivery: test(pw-c): add an isolated serial Docker campaign.

- [x] Delivery: test(pw-c): require functional mutant kills and restorations.
