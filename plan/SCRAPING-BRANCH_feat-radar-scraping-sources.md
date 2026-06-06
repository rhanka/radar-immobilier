# Feature: Radar Scraping Sources

## Objective
Create the source ingestion contract required by `SPEC_PLAN_SCRAPING.md` J0, then use it as the stable base for promoting the priority source adapters.

## Scope / Guardrails
- Scope limited to `packages/radar-sources/**`, this branch plan, and source-specific tests/docs needed for the J0 adapter contract.
- Make-only workflow, no direct Docker, Node, or npm commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in repository-local isolated worktree `./tmp/feat-radar-scraping-sources`.
- Automated tests run on `ENV=test-radar-scraping-sources`, never on `ENV=dev`.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/radar-sources/**`
  - `plan/SCRAPING-BRANCH_feat-radar-scraping-sources.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `../poc-k8s/**` (cross-repo work)
- **Exception process**:
  - Declare exception ID `SCRAPING-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] acknowledge: H2A mandate received and accepted on negotiation `neg:radar-scraping-codex-20260606`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: J0 is a narrow package contract; later adapters can be added as separate atomic lots.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and relevant source/workflow/testing rules.
  - [x] Create isolated repository-local worktree `./tmp/feat-radar-scraping-sources`.
  - [x] Confirm command style: `make ... ENV=test-radar-scraping-sources`.
  - [x] Confirm scope and guardrails.

- [ ] **Lot 1 — J0 SourceAdapter contract**
  - [x] Add `@radar/sources` package shell.
  - [ ] Add a failing contract test for `SourceAdapter`.
  - [ ] Implement `SourceAdapter`, `RawDocumentRef`, `RawDocument`, and `ListOptions`.
  - [ ] Export the contract from the package entrypoint.
  - [ ] Lot gate:
    - [ ] `make test ENV=test-radar-scraping-sources`
    - [ ] `make typecheck ENV=test-radar-scraping-sources`
    - [ ] `make lint ENV=test-radar-scraping-sources`

- [ ] **Lot 2 — Promote priority adapter skeletons**
  - [ ] Map top-5 source IDs to the new contract without network fetching behavior.
  - [ ] Keep adapter implementation lots small enough for atomic commits.

- [ ] **Lot N — Merge & close**
  - [ ] Push branch.
  - [ ] Open PR.
  - [ ] Verify CI green.
  - [ ] Merge commit only.
  - [ ] Preserve branch.
  - [ ] Move this file to `plan/done/`.
