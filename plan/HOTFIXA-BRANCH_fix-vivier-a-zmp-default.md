# Fix: Restore Coherent Vivier A and Label the Transition

## Objective
Restore the immutable Vivier A projection (`z|m|p`) as the default on every signal surface, while exposing the current `z|p` projection only as an explicitly non-final transition mode with end-to-end ID and count parity.

## Scope / Guardrails
- Scope limited to the signal map UI, its filter contract, and focused regression tests.
- Vivier A is fixed to `z|m|p`; it is never recomputed as Vivier v2 and never coerced to `z|p`.
- Transition mode is fixed to `z|p`, labelled non-final, and uses the same server classification as its rail count.
- No hybrid client/server predicates, fallback between modes, minor-variance filter, scoring, PG, deployment, merge, or Track write.
- Make-only workflow; root UAT checkout remains untouched.
- Branch work happens only in `./tmp/hotfix-vivier-a-zmp`.
- Tests use `ENV=test-vivier-a-zmp`; optional E2E uses ports `API_PORT=8897`, `UI_PORT=5397`, `MAILDEV_UI_PORT=1197`, `ENV=e2e-vivier-a-zmp` last.
- All new text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/HOTFIXA-BRANCH_fix-vivier-a-zmp-default.md`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/src/lib/components/maps/SignauxRail.test.ts`
  - `ui/src/lib/components/maps/SignauxSelPanel.svelte`
  - `ui/src/lib/components/maps/SignauxSelPanel.test.ts`
  - `ui/src/lib/components/maps/SignauxSelPanelHarness.svelte`
  - `ui/src/lib/router/filter-persistence.test.ts`
  - `ui/src/lib/signals/graph-signal-filter.ts`
  - `ui/src/lib/signals/graph-signal-filter.test.ts`
  - `ui/src/lib/signals/graph-signal-detail-client.ts`
  - `ui/src/lib/signals/signals-live.test.ts`
  - `ui/src/lib/signals/vivier-view-mode.ts`
  - `ui/src/lib/signals/vivier-view-mode.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `PLAN.md`
  - `.track/**`
  - `docs/spec/**`
  - `packages/radar-scoring/**`
  - `api/drizzle/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only after conductor approval of `BRHOTFIXA-EX1`)**:
  - `api/src/services/graph/vivier-v2.ts`
  - `api/src/services/graph/vivier-v2.test.ts`
  - `api/src/services/graph/graph-store.ts`
  - `api/src/services/graph/graph-store.test.ts`
  - `api/src/services/graph/sutton-legacy.fixture.ts`
  - `api/src/routes/graph-signals.ts`
  - `api/src/routes/graph-signals.test.ts`
- **Exception process**:
  - Declare `BRHOTFIXA-EX1` in `## Feedback Loop` before touching conditional API paths.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `decision` — Conductor selected exact server-classified option 1 before test/code.
- [x] `BRHOTFIXA-EX1` — Reason: rail counts already use server `z/m/p` classification while detail cards do not expose those exact flags; impact: add read-only legacy flags produced by the same pure classifier; rollback: remove the additive response field and UI consumption.
- [x] `attention` — A client-only restoration is rejected because refs `0140601` and `34a9d4e` prove `p` was neutralized in the detail panel while remaining restrictive in server counts.
- [x] `review/no-go` — Consensus review rejected publication until strict legacy inputs, selected-city detail authority, route resync, transient-state invalidation, malformed-payload fail-closed handling, and honest unavailable states were proven.
- [x] `decision` — For the selected city, `GET /api/graph-signals/:city` is the sole observable authority for A/T counts and IDs through versioned `legacyProjection`; by-city counts remain for non-selected cities only.
- [x] `decision` — Existing internal Vivier v2 / `r` computations remain untouched and unexposed; their removal is explicitly outside this hotfix.
- [ ] `G1` — Global immutable snapshot identity is a separate publication gate owned by the conductor; this hotfix proves per-response A/T coherence but does not claim global snapshot identity.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: One containment change with one focused verification cycle.

## UAT Management (in orchestration context)
- UAT is deferred to the conductor on the root checkout at fixed `ENV=dev` ports after consensus review; this worktree never hosts UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read mandatory rules and Harness plan/test/debug skills.
  - [x] Create `fix/vivier-a-zmp-default` in `./tmp/hotfix-vivier-a-zmp` from `origin/main` at `37a6c5d`.
  - [x] Prove regression refs: `0140601` neutralizes `p` for display parity; `34a9d4e` restores exact server counts without restoring detail parity; `08e6eeb` then coerces `z|m|p` to `z|p`.
  - [x] Define isolated test environment and scope boundaries.

- [x] **Lot 1 — Coherent A and labelled transition**
  - [x] Add red Sutton contract fixture: raw `5`, transition `z|p=2`, A `z|m|p=1`; assert rail count equals detail IDs in each mode.
  - [x] Add red persistence tests: empty/invalid state defaults to A; exact legacy `z|m|p` remains A; only explicit transition state selects `z|p`.
  - [x] Add red rail tests: A is selected by default and immutable; transition is explicitly labelled non-final; no free-form axis combination or Vivier v2 label is exposed.
  - [x] Under `BRHOTFIXA-EX1`, expose server-produced legacy `z/m/p` flags per detail card from the same pure classifier used by aggregate counts.
  - [x] Filter detail IDs only from server legacy flags; remove the duplicated client `z/m/p` predicate for these modes.
  - [x] Persist only the two canonical modes through URL and localStorage; unsupported historical hybrids resolve to A.
  - [x] Lot gate: `make test-ui SCOPE=src/lib/signals/vivier-view-mode.test.ts ENV=test-vivier-a-zmp`.
  - [x] Lot gate: focused UI filter/rail tests and focused API graph/vivier tests with `ENV=test-vivier-a-zmp` last.
  - [x] Lot gate: `make typecheck ENV=test-vivier-a-zmp` and `make lint ENV=test-vivier-a-zmp`.
  - [x] Commit atomically via selective staging and `make commit` under 150 changed lines, or split tests/implementation into separate atomic commits if required.

- [x] **Lot 2 — Consensus correction loop**
  - [x] Capture red tests: API `2` expected failures with `103` passes; UI `8` expected failures with `40` passes.
  - [x] Extract legacy inputs exactly like reference `8fe75cd`: graph identity fields plus legacy category/description/etape/units/intensity only from `props.properties`.
  - [x] Add the five real Sutton graph records and prove normalized aggregate/detail parity: raw `5`, A IDs `1`, transition IDs `2`.
  - [x] Return common-version `legacyProjection` with exact A/T counts and IDs from the detail response.
  - [x] Make selected-city rail, panel, and map consume detail authority; reject missing, malformed, or inconsistent flags/projection without fallback.
  - [x] Key geo routes by A/T and resynchronize mode on route/popstate changes.
  - [x] On mode change, purge excluded focus/evidence/hover and prevent viewer actions from reopening excluded signals.
  - [x] Replace false zero/empty copy with explicit unavailable states.
  - [x] Targeted API gate: `105` passed, `7` DB-bound skipped.
  - [x] Targeted UI gate: `49` passed.
  - [x] Static gates: typecheck `0` errors (`7` pre-existing Svelte warnings), lint clean.

- [ ] **Lot 3 — Review handoff**
  - [x] Run Harness scope/branch verification without writing Track.
  - [x] Report exact diff, test evidence, remaining UAT requirement, and no push/PR/merge/deploy.
  - [ ] Await consensus review before any publication action.
