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
- No external deployment. Activation follows geo#439 in preprod.

## Orchestration Mode (AI-selected)
- [x] Single branch; no integration or merge.

## UAT Management (in orchestration context)
- [x] Automated browser verification uses an isolated synthetic stack.

## Plan / Todo (lot-based)
- [x] Lot 0: verify baseline, rules, scope and isolation.
- [x] Lot 1: preserve encoded responses across Nginx and Vite; configuration test.
- [ ] Lot 2: display precision, exact detail loading, separation and pagination tests.
- [ ] Lot 3: typecheck, lint, targeted UI and browser checks; remove stack volumes.
- [ ] Lot 4: push and open PR to main; no merge.
