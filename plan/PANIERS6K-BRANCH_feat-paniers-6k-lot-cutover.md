# Feature: Guarded lot cutover (6K)

## Objective
Qualify the explicit nine-stage lot cutover over the current 6F manifest.
Preserve every source row, independent facets, and pre-activation UI behavior.
Dependencies: qualified 6J, 6F manifest contracts, ratified D4, and 6L1.
D5 applies only to actual conflicts; qualification uses synthetic data.

## Scope / Guardrails
- Make-only, container-only execution; no environment-file reads or real data.
- Base: `81678e05daa6d874aa6c680cc8560c01a914883c` (6J plus 6L1).
- Existing isolated worktree: `.worktrees/paniers-6k` (owner assignment).
- Environments: `test-paniers-6k-*`; API/UI/mail ports: 18867–18875/15867–15875/11867–11875.
- No host ports published; `ENV` is the last Make argument.
- Check disk before every campaign; stop below 10 GiB; remove test volumes and orphans.
- No operational activation, source identity, membership, grant, or D5 inference.
- Subject-only Conventional Commits: at most 72 characters, 150 changed lines, 15 files.
- Shared Git metadata is read-only; local delivery metadata and bundle: `tmp/paniers-6k`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/drizzle/0022_facet_lot_cutover.sql`, `api/drizzle/meta/_journal.json`.
  - `api/src/db/schema.ts` (6K tables), `api/src/app.ts` (router wiring).
  - `api/src/services/facets/lots/lot-cutover*.ts`, `cutover-fixture.ts`, `cutover-manifest.test.ts`.
  - `api/src/services/facets/lots/lot-source-*.ts`, `lot-legacy-fence*.ts`, `lot-manifest-refresh.ts`.
  - `api/src/services/facets/lots/lot-project.ts`, `lot-importer.ts`, `lot-streams.ts` (6K extensions).
  - `api/src/services/facets/lots/lot-reader.ts`, `lot-writer.ts`, `lot-batch.ts` (pending guards).
  - `api/src/services/chat/stream-bus*.ts`, `api/src/routes/chat.ts` (retirement only).
  - `api/src/routes/scoped-lot-cutover*.ts`, `lot-cutover-stream.test.ts`.
  - `api/src/routes/scoped-lot-facets*.ts`, `prospect-marks*.ts` (gating/test doubles).
  - `ui/src/lib/maps/lot-facet-counters*.ts`, `ui/src/lib/prospect/lot-cutover-client*.ts`.
  - `ui/src/lib/components/maps/{EvaluationMapView,LotFichePanel}.svelte`, `LotCutover.ui.test.ts`.
  - `tools/make/paniers-lot6.mk`, `paniers-lot6-verify.sh`, `paniers-lot6k*`, this plan.
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`.
  - Other branch plans, 6J business semantics, 6L1 storage, notes/contacts consumers (#859).
- **Conditional Paths**:
  - The single 0022 migration and necessary legacy-delivery boundaries above.

## Feedback Loop
- [x] BR6K-EX1: retain owner-assigned worktree; root UAT untouched; rollback rejects bundle.
- [x] BR6K-EX2: isolated Make launcher excludes environment files; rollback reverts tooling.
- [x] BR6K-EX3: pending guards extend 6J readers/writers; rollback rejects 6K before activation.
- [x] BR6K-EX4: close queued SSE delivery and recheck durable state on reconnect; no note consumer added.
- [x] BR6K-EX5: separate final opening helper for complete commits within 150 lines.
- [x] Attention: real writers, replica exclusion and parent UI data/command wiring remain unqualified.
- [x] Attention: no peer consensus claimed; author metadata names Muse, not an eligible review host/model pair.

## Orchestration Mode (AI-selected)
- [x] One branch, local delivery repository; no merge, rebase, or cherry-pick.

## UAT Management (in orchestration context)
- [x] Automated UI qualification: JSDOM and exact `origin/main` component baseline.
- [ ] Browser UAT: root `ENV=dev`, fixed ports, after operational wiring is qualified.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**: re-read rules, inspect interrupted tree/logs, isolate campaigns.
- [x] **Lot 1 — Durable gate**: replayable 0022, roster, basket, distinct rights, writers, manifest.
- [x] **Lot 2 — D5 & accounting**: conditional decisions, exact retry identity, source evidence.
- [x] **Lot 3 — Protected run**: nine stages, recovery, stale-snapshot fencing, no fallback/dual write.
- [x] **Lot 4 — Delivery retirement**: queued SSE destruction and replica/reconnect fail-closed checks.
- [x] **Lot 5 — UI isolation**: compare DOM/requests with main; independent facet counters.
- [x] **Lot 6 — Qualification**: API CI parallelism, types, declarations, lint, UI/MCP regression, mutations.
- [x] Delivery checkpoint: 23.
- [ ] **Operational acceptance**: real 6F/D5, writer locks, replicas, parent UI wiring, browser UAT.
- [ ] **Merge & close**: conductor imports bundle, runs CI, reviews scope, uses a merge commit.
