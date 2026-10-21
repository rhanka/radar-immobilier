# Feature: Paniers 6A — Expected-head concurrency

## Objective
Add explicit expected-head concurrency to personal signal facets. Every mutation carries the head it intends to replace. Stale intentions conflict with the current authorized state. No silent overwrite, no partial transition, no success receipt for a failed command.

## Scope / Guardrails
- Scope limited to 6A files listed below. No workspace, no displayed-version fingerprint, no lot schema, no activation.
- No migration. Never modify `api/drizzle/0014*.sql`, `0015*.sql`, `0016*.sql`.
- Reuse `api/src/services/facets/`, `api/src/routes/signal-facets.ts`, `ui/src/lib/components/maps/`, `ui/src/lib/signals/signal-facets-client.ts`. No duplicated logic.
- Lots 2-4 writes keep working: the UI transmits head expectations for every action, including undo.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in this worktree (already isolated). Do not use system `/tmp` for work.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English. Discussions with the user may be in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/PANIERS6A-BRANCH_feat-paniers-6a-head-concurrency.md`
  - `api/src/services/facets/writer.ts`
  - `api/src/services/facets/commands.ts`
  - `api/src/services/facets/target.ts`
  - `api/src/services/facets/response.ts`
  - `api/src/routes/signal-facets.ts`
  - `api/tests/integration/facets-6a-head-concurrency.spec.ts`
  - `api/tests/integration/facets-http-6a-head.spec.ts`
  - `api/tests/integration/facets-fixture.ts` (only if a helper is needed, no behavior change)
  - `ui/src/lib/signals/signal-facets-client.ts`
  - `ui/src/lib/signals/signal-facets-client.test.ts`
  - `ui/src/lib/components/maps/SignalFacetControls.svelte`
  - `ui/src/lib/components/maps/SignalFacetControls.test.ts`
  - `ui/src/lib/components/maps/SignalFacetControls.viewer.test.ts`
  - `ui/src/lib/components/maps/SignauxSelPanel.svelte`
  - `ui/src/lib/components/maps/SignauxSelPanel.facets.test.ts`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/components/maps/SignauxMapView.facets.test.ts`
  - `ui/src/lib/components/maps/SignauxMapView.6a-head.test.ts`
  - `RAPPORT-MUSE-6A.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/drizzle/*.sql`
  - `api/src/db/schema.ts`
  - `api/src/services/graph/**`
  - `api/src/routes/graph-signals.ts`
  - `api/src/services/facets/discarded-reader.ts`
  - `api/src/services/facets/reader.ts`
  - `api/src/services/facets/codebook.ts`
  - `packages/**`
  - `ui/src/lib/components/maps/LotFichePanel.svelte`
  - `ui/src/lib/components/maps/EvaluationMapView.svelte`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `../poc-k8s/**` (cross-repo work)
  - `api/tests/integration/facets-selection.spec.ts`
  - `api/tests/integration/facets-archive.spec.ts`
  - `api/tests/integration/facets-concurrency.spec.ts`
  - `api/tests/integration/facets-http-write.spec.ts`
- **Exception process**:
  - Declare exception ID `6A-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `6A-EX1` — Touch `api/tests/integration/facets-selection.spec.ts`, `facets-archive.spec.ts`, `facets-concurrency.spec.ts`, `facets-http-write.spec.ts` ONLY to add required `expectedHeadId` / `expectedSelectionHeads` arguments to existing `writeFacet` / HTTP calls. Reason: the new contract requires explicit expectations; untouched legacy calls would fail typecheck and misrepresent lots 2-4 behavior. Impact: test-only adaptation, no production logic change outside Allowed Paths. Rollback: revert those hunks; production code still compiles because the new fields are required.
- `6A-EX2` — Adapt `api/tests/integration/facets-{discarded,http-read,read-only,refresh}.spec.ts` to explicit head expectations only. Reason: the requested complete facet regression campaign exercises these write fixtures too. Impact: test-only contract updates. Rollback: revert these expectation arguments.
- `6A-EX3` — Update `ui/src/lib/components/maps/SignauxSelPanelHarness.svelte` to forward the stale-head callback. Reason: exercise the existing parent contract through its test harness. Impact: test-only wiring. Rollback: remove the callback prop and forwarding.
- Verification uses `tmp/paniers-6a/Makefile`, standalone Compose and sanitized source copies; no root Makefile or environment files. Dedicated ENV `test-paniers-sol6a`; reserved API/UI/mail ports 18886/15386/11186 (no services published), PostgreSQL 15686. Local reports, logs and bundle are uncommitted verification artifacts under the authorized workspace.
- No migration created. Historical receipt recovery alone may accept the old payload; it must never execute a new command.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: 6A is a single reviewable sublot with no dependency; one branch, one test cycle.

## UAT Management (in orchestration context)
- UAT is always presented on the **root checkout**, `ENV=dev`, at the fixed
  ports (stable URL `http://localhost:5301`). Do NOT define a per-branch UAT
  port.
- **Mono-branch**: UAT after the UI surface change; present it by
  pointing the root checkout at this branch, then return root to its prior state.
- UAT checkpoints listed as checkboxes inside the relevant lot.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read reference design `/home/antoinefa/src/radar-immobilier/.lanes/conductor/tmp/paniers/conception-lot6-v2.md` §3.1-§3.3 and `### 6A`.
  - [x] Confirm no migration: 6A migration is `none`; never touch `0014`-`0016`.
  - [x] Capture Make targets for debug/testing; `ENV` last on every command.
  - [x] Confirm scope and guardrails; declare `6A-EXn` exceptions if needed (`6A-EX1` to `6A-EX3`).
- [ ] **Lot 1 — API expected-head contract**
  - [x] `target.ts`: add `FacetHeadConflictError` with authorized `current` (`target`, `version: null`, `heads`).
  - [x] `commands.ts`: version digest with contract version plus expected heads; strict receipt recovery; pending null receipts without context return `command_context_unresolved`.
  - [x] `writer.ts`: require `expectedHeadId` plus `expectedSelectionHeads` for composite discard; compare every affected head before any no-op shortcut; atomic multi-stream discard; record receipt context for null results; disclose sanitized current heads on conflict.
  - [x] `response.ts`: keep `facetEventResponse` as the sanitized head shape (no owner, actor, digest).
  - [x] `signal-facets.ts`: strict zod schemas (`expectedHeadId`, `expectedSelectionHeads` with exact key match for discard); 400 on missing/extraneous; 409 `facet_head_conflict` with `current`, 409 `idempotency_key_conflict`, 409 `command_context_unresolved`.
  - [x] Adapt existing integration calls under `6A-EX1` (test-only) to the new required fields.
  - [ ] Lot gate:
    - [ ] `make typecheck`
    - [ ] `make lint`
    - [ ] `make test-api SCOPE=facets-6a-head-concurrency ENV=test-paniers-l6a` (last arg `ENV`)
    - [ ] `make test-api SCOPE=facets-http-6a-head ENV=test-paniers-l6a` (last arg `ENV`)
- [ ] **Lot 2 — UI intention capture and conflict handling**
  - [x] `signal-facets-client.ts`: extend `TargetFacetState` with `pertinentHeadId`, `watchingHeadId`, `archiveHeadId`; `indexFacetHeads` preserves inactive head IDs; `FacetCommandBody` carries expectations; `SignalFacetError` carries `current`; conflict copy requires reload and a new intention.
  - [ ] `SignalFacetControls.svelte`: send `expectedHeadId` (and `expectedSelectionHeads` when discard carries deselect) from state IDs; surface `facet_head_conflict` distinctly; never auto-resubmit a confirmed conflict; same-key retry only for unconfirmed writes; notify parent on stale heads for reload.
  - [ ] `SignauxSelPanel.svelte`: forward stale-head notification; pass through IDs via `facetHeads`.
  - [ ] `SignauxMapView.svelte`: reload heads/detail/by-city on stale-head notification; store undo expectation from the confirmed discard head; undo `restore` carries that expectation so an intervening archive change conflicts instead of overwriting.
  - [ ] UAT checkpoint: select/deselect/discard/restore round-trip on one signal; conflict banner after a stale retry; undo restores once and conflicts after an intervening archive change.
  - [ ] Lot gate:
    - [ ] `make typecheck`
    - [ ] `make lint`
    - [ ] `make test-ui SCOPE=signal-facets-client ENV=test-paniers-l6a` (last arg `ENV`)
    - [ ] `make test-ui SCOPE=SignalFacetControls ENV=test-paniers-l6a` (last arg `ENV`)
    - [ ] `make test-ui SCOPE=SignauxMapView.6a-head ENV=test-paniers-l6a` (last arg `ENV`)
- [ ] **Lot 3 — Discriminating tests**
  - [x] API: concurrent first writes (one success, one 409 with current); stale expectation conflicts even when the final state matches; null conflicts with an inactive head; one selection conflict rolls back the whole discard; exact replay returns the original result after later transitions; changed expectations with the same key conflict; undo cannot overwrite an intervening archive change; 409 carries only authorized heads.
  - [ ] UI: inactive IDs retained by the index; controls send expectations; 409 copy and reload path; undo carries the discard head.
  - [x] Each test fails without the fix (assert the pre-fix behavior would differ).
  - [ ] Lot gate: same as Lots 1-2.
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `RAPPORT-MUSE-6A.md` (root, uncommitted) with changes, tests, commit split, test commands, `not covered`.
  - [ ] Update this `BRANCH.md` with merge-ready state.
- [ ] **Lot N — Merge & close**
  - [ ] Push branch.
  - [ ] Open PR (or merge directly if solo dev).
  - [ ] Verify CI green.
  - [ ] Merge commit (NO squash, NO rebase merge).
  - [ ] Preserve branch (do NOT delete on merge).
  - [ ] Move this file to `plan/done/NN-BRANCH_<slug>.md`.
