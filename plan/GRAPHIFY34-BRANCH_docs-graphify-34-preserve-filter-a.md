# Docs: Make Legacy Filter A Preservation Blocking in Graphify 3.4

## Objective

Record the Graphify 3.4 release gate that preserves the legacy Filter A (`z|m|p`) contract, and bring the documentation PR into repository-policy compliance.

## Scope / Guardrails

- Product scope is limited to the Graphify 3.4 consensus addendum; this branch does not change application behavior.
- Worktree: `tmp/graphify34-pr`; branch stack mapping: `API_PORT=8816`, `UI_PORT=5316`, `MAILDEV_UI_PORT=1116`, `ENV=test-graphify-34` last.
- No branch stack or UAT is needed for the documentation-only change; root `ENV=dev` remains untouched.
- Make-only workflow, selective staging, atomic commits, and merge commits only.
- All new text is English.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `docs/reports/consensus/graphify-3.4-legacy-filter-a-addendum.md`
  - `plan/GRAPHIFY34-BRANCH_docs-graphify-34-preserve-filter-a.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `PLAN.md`, `.track/**`
  - `api/**`, `ui/**`, `packages/**`, `radar/**`, `tools/**`
  - `docs/**` except the allowed consensus addendum
  - `plan/**` except this branch file
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
  - `../poc-k8s/**`, `../sentropic/**`, `../graphify/**`
- **Exception process**:
  - Declare `BRGRAPHIFY34-EXn` in `## Feedback Loop` before touching a conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [x] `review` — addendum claims were checked against `SPEC_EVOL_FILTRAGE_VIVIER_v2.md`: the two modes, shadow projection, atomic cutover, replay gap, and 3.x/v2.x numbering gap are accurately represented.
- [x] `policy` — PR #406 audit at `88d189be61da04b227c94fd602d20f53046eb5cb` identified this missing branch plan and a French PR title; this plan is the first correction and the title is handled in Lot 2.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: One documentation artifact and its PR metadata are the only changes.

## UAT Management (in orchestration context)

- No UAT: this documentation-only branch has no UI or runtime surface.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, Harness planning/review guidance, and GitHub PR guidance.
  - [x] Confirm isolated worktree `tmp/graphify34-pr`, branch `docs/graphify-34-preserve-filter-a`, and clean status at `88d189be61da04b227c94fd602d20f53046eb5cb`.
  - [x] Define the supplied isolated branch-stack mapping; no Make target is required for the documentation-only diff.
  - [x] Confirm the sole product-document path and default forbidden/conditional boundaries.

- [x] **Lot 1 — Legacy Filter A release gate**
  - [x] Add the consensus addendum requiring an exact Filter A inventory, golden fixtures, receipts, independent incremental/full proof, shadow cutover, and rollback.
  - [x] Check the one-file addendum diff for whitespace errors and source-spec consistency.

- [ ] **Lot 2 — PR policy and readiness**
  - [x] Confirm PR #406 originally changed only the consensus addendum (+67/-0) and has no comments, reviews, or review threads.
  - [x] Confirm CI run `30005229974` and Branch policy run `30005229866` succeeded on `88d189be61da04b227c94fd602d20f53046eb5cb`.
  - [x] Add this branch plan to satisfy the mandatory scoped-plan policy.
  - [ ] Commit and push this plan through the existing branch.
  - [ ] Retitle PR #406 in English: `docs(graphify): make legacy A preservation blocking in 3.4`.
  - [ ] Recheck the new-SHA CI, branch-policy result, and required approval before merge.

- [ ] **Lot 3 — Merge & close**
  - [ ] Merge only after all required reviews and checks are green, using a merge commit.
  - [ ] Preserve the source branch and move this plan to `plan/done/` after merge.
