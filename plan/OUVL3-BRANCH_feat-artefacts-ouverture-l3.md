# Feature: Published pages read the current reader's baskets

## Objective
Connect published release files and H5 reads to current account/workspace authority.

## Scope / Guardrails
- Preserve origin isolation, cookie boundaries, CSP and current authorization.
- Use the standalone Make runner; never load environment files or run host runtimes.
- Worktree: `tmp/artefacts-ouv-l3`; root checkout remains untouched.
- Tests: `ENV=test-artefacts-ouv-l3`, API 18935, UI 15935, Maildev 11935.
- Hold the shared Docker campaign lock and wait for foreign test stacks.
- Always remove this project's volumes and orphans; never touch foreign resources.
- No push. Deliver a local Git bundle based on `9a723753`.
- English Conventional Commits, at most 150 changed lines, no body or trailer.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/artifacts/**`, `api/src/index.ts`, `api/src/app.ts`
  - `api/tests/integration/artifacts-baskets*`
  - `api/tests/integration/artifacts-reader-opening*`
  - `tools/make/artefacts-ouv-l3*`
  - `RAPPORT-SOL-OUV-L3.md`, `RAPPORT-MUSE-OUV-L3.md`
  - This branch file.
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`
  - Other branch plans; producer admission and MCP tools.
- **Conditional Paths**:
  - `api/drizzle/0025_artifacts_reader_tickets.sql`, `api/drizzle/meta/_journal.json`
- **Exception process**:
  - Declare bounded exceptions below before changing conditional paths.

## Feedback Loop
- [x] OUVL3-EX1: add one migration for shared, expiring, single-use reader tickets. Reason: no durable A6 ticket implementation exists on main. Impact: additive table and migration journal; rollback: disable reader mounting, preserve stored data.
- [x] Shared Git metadata is read-only; use `tmp/sol-l3.git` and audit the bundle in a fresh repository.
- [ ] Blocked qualification: foreign test stacks remained active from 09:08 to 10:06 UTC. The queued runner was cancelled before creating resources; no foreign stack was touched. Dynamic gates below remain unaccepted.

## Orchestration Mode (AI-selected)
- [x] Single branch, serialized implementation and Docker campaigns.

## UAT Management (in orchestration context)
- [ ] Live UAT/deployment: outside this task; no root checkout changes.

## Plan / Todo (lot-based)
- [x] Lot 0: read instructions, inspect Muse build, merge origin/main 17f439c8.
- [x] Lot 1: implement basket contracts, durable release bytes and opening flow; qualification remains pending below.
- [ ] Lot 2: typecheck, ESLint, reader/API unit tests, PostgreSQL reads.
- [ ] Lot 3: published HTML/CSS/JS browser proof and persistent continuation.
- [ ] Lot 4: discriminating isolation/authorization mutations and full API CI suite.
- [x] Lot 5: audit atomic commits, reconstruct bundle, record results and checksums separately in the owner report.
