# Chore: review minors of #1015, #1016 and #1017

## Objective
Address the minor findings of the post-merge reviews of #1015 (artifacts provider 0.2.18 MIME map), #1016 (`@hono/node-server` 2.1.6) and #1017 (hono 4.13.17): pin the newly resolved MIME types, align the in-memory release-files provider with the production `HOST_MIME_TYPES` gate, cover the reader content app in the line-terminator regression test, and close the three branch plans.

## Scope / Guardrails
- Scope limited to the release-files seam and its tests, the line-terminator regression test and the three merged branch plans.
- No DB migration.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in `./tmp/review-minors-1107`.
- Automated tests run on `ENV=test-minors1107`, never on `dev`.
- In every `make` command, `ENV=<env>` is the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/artifacts/release-files.ts`, `api/src/artifacts/release-files.test.ts`
  - `api/src/wildcard-middleware-line-terminator.test.ts`
  - `plan/MINORS1107-BRANCH_chore-review-minors-1107.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file and exception MINORS1107-EX1)
  - `.github/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `plan/ART0218-BRANCH_feat-artifacts-0218.md`, `plan/HONO216-BRANCH_fix-hono-node-server-2.1.6.md`, `plan/HONO41317-BRANCH_fix-hono-4.13.17.md` (MINORS1107-EX1)
- **Exception process**:
  - Declare exception ID `MINORS1107-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `MINORS1107-EX1`: close the Lot N / PR checkboxes of the three merged branch plans and record in ART0218 that the 0.2.18 package migrations 0010/0011 are not adopted (review minors #1015-3, #1016-2, #1017-4). Checkbox/text only; rollback = revert the plan hunks.
- `attention`: the hotfix review M4 (`${{ }}` interpolation in a workflow shell step) concerns hotfix tags only and stays out of scope; no `.github/**` change.
- `attention`: CI-pending minors of #1016/#1017 are moot (both PRs merged on green CI).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: small test-and-plan follow-up.

## UAT Management (in orchestration context)
- No UI surface change; UAT not required for this branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Create worktree `./tmp/review-minors-1107` from `origin/main`.
  - [x] Read the #1015, #1016 and #1017 reviews.

- [x] **Lot 1 — Release-files MIME (#1015 minors 1-2)**
  - [x] Pin the served type of `.avif`, `.ico`, `.woff`, `.ttf`, `.otf`, `.webm` in `release-files.test.ts`.
  - [x] Gate `createMemoryReleaseFiles` by `HOST_MIME_TYPES` like `reader-storage`, documented on `contentTypeForPath`.

- [x] **Lot 2 — Reader app line terminator (#1017 minor 3)**
  - [x] Reader content app case: `/api/*` with `%0A`/`%0D`/`%E2%80%A8` still gets the typed 401; an authority header with `%0A`/`%E2%80%A9` still gets the typed 400.

- [x] **Lot 3 — Plans (#1015-3, #1016-2, #1017-4)**
  - [x] Tick Lot N / PR boxes in ART0218, HONO216, HONO41317; note 0010/0011 not adopted in ART0218 (MINORS1107-EX1).

- [x] **Lot N — Final validation**
  - [x] Lot gate: typecheck, lint, api `src/artifacts` (113 files / 872 tests) and the two touched files (2 files / 14 tests) via `tools/artifact-host.mk`, `ENV=test-minors1107`, stack removed with `down -v`.
  - [x] Push branch and open the PR to `main`.
