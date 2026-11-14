# Feature: Geometry display quick wins

## Objective
Reduce map transfers while preserving exact geometry for details and calculations.

## Scope / Guardrails
- No merge. No secrets, dotenv files, Python or Kubernetes credentials.
- Worktree: `tmp/geo-quickwins-ui`; base: `origin/main`.
- Make commands use `SKIP_DOTENV=1`, Compose `--env-file /dev/null`, and ENV last.
- Test environment: `test-geo-quickwins`; ports API 18841, UI 15341, Maildev 11141.
- Every started stack is removed with volumes.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/maps/**`
  - `ui/src/lib/components/maps/**`
  - `ui/nginx/default.conf`, `ui/vite.config.ts`
  - `deploy/k8s/nginx/default.conf`
  - `ui/e2e-real/**`, `tools/make/geo-quickwins*`
  - `tools/make/e2e-real.sh`, `tools/make/e2e-real-runner.sh`
  - `plan/GEOQUICK-BRANCH_feat-geo-quickwins-ui.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, other branch plans
- **Conditional Paths**:
  - None.

## Feedback Loop
- No external deployment. M1 display contract follows geo#440 in preprod.
- Review consensus unavailable: this session exposes no h2a MCP launcher. No peer verdict is asserted.

## Orchestration Mode (AI-selected)
- [x] Single branch; no integration or merge.

## UAT Management (in orchestration context)
- [x] Automated browser verification uses an isolated synthetic stack.

## Plan / Todo (lot-based)
- [x] Lot 0: verify baseline, rules, scope and isolation.
- [x] Lot 1: preserve encoded responses across Nginx and Vite; configuration test.
- [x] Lot 2: display precision, exact detail loading, separation and pagination tests.
- [x] Lot 3: typecheck, lint, targeted UI and browser checks; remove stack volumes.
  - [x] `make typecheck`: passed (warnings only).
  - [x] `make lint`: passed (one warning, no errors).
  - [x] `make test-ui SCOPE=...`: 174 tests passed in 7 files.
  - [x] `make test-e2e E2E_SPEC=geo-quickwins.spec.ts`: 1 passed (4.5 s).
  - [x] Browser clicks city, selects lot, opens exact detail; external geo is mocked at HTTP boundary.
  - [x] Preprod probes: display query and exact geoId item both return HTTP 200.
  - [x] Unit stack: `make clean` (`down -v`); e2e script teardown: `down -v`.
- [x] Lot 4: push and open PR to main; no merge.
  - [x] PR: https://github.com/rhanka/radar-immobilier/pull/1109
  - [x] CI checks started; merge remains outside this lane.
- [x] Lot 5: load M1 display mirrors once per collection; log explicit exact fallback for HTTP 400/404/503; preserve exact item details and browser cache validation.
  - [x] Typecheck and lint pass (warnings only); targeted UI tests pass in 7 files, including 16 display-boundary cases.
- [x] Lot 6: validate M1 client tests and real-click browser scenarios.
  - [x] Four browser scenarios pass in 4.94 s: nominal display and explicit fallback on HTTP 400/404/503, then exact lot detail without profile or precision.
  - [x] Local synthetic nominal city-click-to-exact-card measurement: 578 ms. Geo is mocked; this is not a city-scale performance benchmark.
  - [x] Preprod measured from this host: Rawdon 1,843,278 bytes / 0.669 s; Saint-Eustache 3,182,380 bytes / 1.351 s. ETag revalidation: HTTP 304, zero bytes, 0.122 s / 0.104 s respectively.
  - [x] Initial browser failure came from applying M1 assertions to CPTAQ requests; the trace identified the unrelated constraints collection. The simulator now scopes M1 assertions to lots/zoning.
  - [x] Unit stack and both browser campaigns removed with volumes (`down -v`).
- [x] Lot 7: push M1 commits and update PR #1109; no merge.
