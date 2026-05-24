---
description: "Test pyramid, CI, environment isolation for radar-immobilier"
paths: ["**/tests/**", "e2e/**", "vitest.config.*", "playwright.config.*"]
tags: [testing]
---

# Testing

## Test pyramid

1. **Unit tests** (`vitest`) in `api/tests/`, `ui/tests/`, `packages/*/tests/`.
   - Fast, no external dependencies, no DB, no network.
   - Mock at the port boundary (e.g., `MeshPort`, `ObjectStore`, `SourceAdapter`).
2. **Integration tests** (`vitest`) in `api/tests/integration/`.
   - Real Postgres (test DB), real MinIO (test bucket), mocked external HTTP.
   - Test the wiring between services and adapters.
3. **E2E tests** (`playwright`) in `e2e/tests/`.
   - Real browser, real UI, real API, real DB, real S3, real Obscura sidecar.
   - LLM calls mocked at the mesh boundary (no live provider charges in CI).
4. **Smoke** (`playwright`) in `e2e/tests/smoke/`.
   - Lightweight golden-path checks for the deployed environment.

## Environment isolation

- `ENV=dev` — user dev / UAT only. NEVER for automated tests.
- `ENV=test-<slug>` — branch-isolated unit/integration tests.
- `ENV=e2e-<slug>` — branch-isolated e2e tests with a built image.
- Each branch defines its own ports (`API_PORT`, `UI_PORT`, `MAILDEV_UI_PORT`) in its `BRANCH.md`.

## Make targets

- `make test ENV=test-<slug>` — unit + integration suites.
- `make test-api ENV=test-<slug> SCOPE=tests/<file>.spec.ts` — scoped run.
- `make test-ui ENV=test` — UI unit tests (Vitest, JSDOM).
- `make test-e2e ENV=e2e-<slug>` — full e2e (builds images then runs).
- `make test-smoke ENV=demo` — smoke against deployed env.

## Determinism rules

- No `Math.random()` / `Date.now()` in code under test without injection.
- Time is controlled via `vi.useFakeTimers()` or a `Clock` port.
- LLM calls are mocked with fixtures from `api/tests/fixtures/llm/` keyed by prompt hash.
- Scraping is mocked via fixtures from `packages/radar-sources/tests/fixtures/<source>/`.

## AI flaky tests

- Accept only non-systematic provider/model nondeterminism as `flaky accepted`.
- Non-systematic means at least one success on the same commit and same command.
- Never amend tests with additive timeouts.
- Document any flaky test in `BRANCH.md` with command + failing test file + signature.
- Capture explicit user sign-off before merge.

## CI

- Workflow `.github/workflows/ci.yml` runs on PR and on push to `main`.
- Stages: `typecheck` → `lint` → `test` (unit + integration) → `build` → `test-e2e` (matrix).
- E2E matrix splits the `e2e/tests/` directory into groups; see workflow file.
- CI is the source of truth: a branch is mergeable only if its CI run is green.
- "Pre-existing failure on main" is NOT an excuse — if it happens, fix `main` first.
