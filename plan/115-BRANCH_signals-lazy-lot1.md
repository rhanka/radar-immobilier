# Feature: Exact SQL signal metadata

## Objective
- [ ] Deliver design sections 3–5, lot 1 only, under i-cond.

## Scope / Guardrails
- [x] Read the complete reference DESIGN.md and repository rules.
- [x] Use feat/signals-lazy-lot1 in tmp/signals-lazy-lot1, based on origin/main.
- [x] Reserve migration 0049; 0047 and 0048 belong to concurrent lanes.
- [x] No environment files, Python, Kubernetes configuration, merge or attribution trailers.
- [x] Preserve URL semantics, city details, selection panels, badges and geometry.
- [x] Use make with SKIP_DOTENV=1 and ENV last; remove test volumes after stacks.
- [x] Test ports: API 18861, UI 15361, mail 11161, PostgreSQL 15561, S3 19161, Obscura 19261, SMTP 11261.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: api/src/services/facets/**, api/src/services/graph/graph-store.ts, api/src/db/scripts/**, api/src/routes/scoped-projection-revisions.ts, api/tests/integration/**, packages/radar-domain/src/**, ui/src/lib/signals/**, ui/src/lib/components/maps/SignauxMapView.svelte, ui/tests/**, e2e/tests/**, docs/spec/SPEC_SIGNALS_METADATA.md, this plan.
- [x] Forbidden Paths: docker-compose*.yml, rules/**, CLAUDE.md, AGENTS.md, GEMINI.md, other branch plans, SignauxSelPanel and badge components.
- [x] Conditional Paths: Makefile, api/drizzle/0049_signal_metadata.sql, api/drizzle/meta/_journal.json.

## Feedback Loop
- [x] SL1-EX1: add the explicitly requested make backfill target. Impact: one isolated command. Rollback: remove target.
- [x] SL1-EX2: add replayable migration 0049 and journal entry. Impact: additive fine projection. Rollback: coordinated API/UI rollback; retain inert table.
- [x] Owner authorizes old contract during coordinated migration; metadata-v2 never falls back to full cards.
- [x] SL1-EX3: allow ui/e2e-real/** and ui/playwright.real.config.ts for real-click qualification and source-projection seeding. Rollback: revert isolated test changes.
- [x] SL1-EX4: pass optional E2E_SPEC through Makefile and tools/make/e2e-real*.sh for the explicitly requested scoped real-stack run. Default suite unchanged. Rollback: remove optional argument.

## Orchestration Mode (AI-selected)
- [x] Mono-branch BUILD lane; no merge.

## UAT Management (in orchestration context)
- [x] Automated isolated stacks only; root UAT remains under conductor control.

## Plan / Todo (lot-based)
- [x] Canonical filter and faceted metadata contract.
- [x] Versioned projection, transactional refresh, idempotent backfill and migration.
- [x] Authorized SQL aggregation and exact class resolution.
- [x] Coordinated map/rail client; remove detail substitution.
- [ ] Unit matrix, reference parity, PostgreSQL rights/dates/reprojection/plans.
- [ ] Typecheck, lint, targeted API/UI/E2E gates.
- [ ] Representative local cold unlimited measurement, budget 1 second.
- [ ] Independent review, PR to main, measurements and activation/rollback report.
