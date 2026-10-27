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
  - `api/tests/integration/pw-write-authority-rights.spec.ts`: PWC-EX1.

## Feedback Loop
- [x] Owner retarget: fetch approved PW-A 509e664d and rebase all 37 PW-C
  commits without conflicts; preserve 9316a877 under a rescue ref and bundle.
  Track bytes and the approved transaction implementation remain unchanged.
- [ ] Requalify PW-C on final PW-A, including upstream CI fixtures and real
  curl/jq tools from the approved offline runner; deliver a 509e664d bundle.
- [x] Final complete archive: typecheck, lint, build and nginx gates passed;
  65 unit and 9 PostgreSQL cases passed without skips; API suite passed
  4316 cases with 76 documented conditional skips and no failed suites. All
  25 individual mutants were killed and restored byte-identically.
- [x] Archive top-level API test files as well as integration tests; the
  omitted blob-store helper prevented 19 suites from loading. Preserve the
  original Vitest discovery and qualify every selected suite before delivery.
- [x] Enforce content isolation headers on forwarded responses, preserving status,
  body and Retry-After; a raw upstream Response must not drop the local policy.
- [x] PWC-EX1: update two inherited strict management DTO expectations for
  the new durable state field. Test-only impact; rollback removes that field.
- [x] Cover prepared-header preservation on summary, management and login HTML.
- [x] Supply the same synthetic database to createApp's shared route dependencies.
- [x] Delivery: preserve prepared response headers on all three HTML documents.
- [x] Preserve prepared Hono isolation headers when rendering HTML documents,
  including login and management; raw Responses had dropped COOP and no-store.
- [x] Complete createApp's required object-store boundary in the PG fixture;
  every unexpected object operation fails instead of hiding an integration gap.
- [x] Require an observable extra network request from the manual-loop mutant,
  rather than counting a timer that could return without fetching.
- [x] Expose the durable technical state on owner management reads, without
  a receipt or challenge, so recovery remains usable after page loss.
- [x] Supplied implementation and complete Muse report reviewed.
- [x] Baseline failures captured before corrections.

## Orchestration Mode (AI-selected)
- [x] One local branch; serial campaigns; local rescue repository and bundle.

## UAT Management (in orchestration context)
- [x] Browser/two-host qualification belongs to PW-E; root UAT untouched.

## Plan / Todo (lot-based)
- [x] Lot 0: rules, baseline, isolated ports and read-only shared Git.
- [x] Lot 1: application dispatch, documents and cookie/CSRF guards.
- [x] Lot 2: page preparation, listener and bounded follow-up.
- [x] Lot 3: unit/PostgreSQL, API suite, static gates and mutations.
- [x] Lot 4: atomic delivery, prerequisite-only bundle audit and report.

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

- [x] Delivery: chore(pw-c): audit local commits and incremental bundle delivery.
