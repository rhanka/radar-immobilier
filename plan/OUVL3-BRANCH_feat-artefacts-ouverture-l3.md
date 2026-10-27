# Feature: Published pages read the current reader's baskets

## Objective
Connect published release files and H5 reads to current account/workspace authority.

## Scope / Guardrails
- Preserve origin isolation, cookie boundaries, CSP and current authorization.
- Use the standalone Make runner; never load environment files. Owner authorizes Docker qualification under the shared campaign lock.
- Worktree: `tmp/artefacts-ouv-l3`; root checkout remains untouched.
- Tests: `ENV=test-artefacts-ouv-l3`, API 18935, UI 15935, Maildev 11935.
- Hold the shared Docker campaign lock and wait for foreign test stacks.
- Always remove this project's volumes and orphans; never touch foreign resources.
- No push. Initial bundle: `9a723753`; first fixes: `2279b9ad`; browser product fixes: `60c10a1d`.
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
- [x] Conductor qualified `2279b9ad`: typecheck, lint, 3213 API unit tests, 63 PostgreSQL reader tests and 10 mutations passed. Browser DNS and three missing-curl probe cases failed.
- [x] Replace browser route interception with loopback HTTPS and Chromium resolver rules; preserve cookies, CSP and all behavioral assertions. Conductor rerun pending.
- [x] Targeted host Chromium regression passed (HTTPS redirects, CSS/JS, Secure cookie separation); strict helper typecheck passed. No Docker used for these corrections.
- [x] Bootstrap qualification with curl, jq and openssl before tests; preserve all three delivery-probe cases. Host guard and simulated installer success/failure passed; real image rerun pending.
- [x] Conductor requalified `60c10a1d`: all gates except browser passed, including 4131 API CI tests and 10 mutations.
- [x] Instrument browser console, CSP, network, H5 bodies and server-side Origin, with credentials redacted. Reproduced POST Origin `null` and 403 `forbidden_origin` before published code or H5 runs.
- [x] Fix approval response policies: same-origin referrers preserve CSRF Origin; form-action allows only the authorized artifact origin for Chromium's 303 chain. H5 returned 200 with two matched baskets in 182 ms; unchanged 1500 ms wait.
- [x] Align mounted reader API denials with private reader isolation headers, keeping 401 before delegation. Targeted 21/0/0 passed; two browser readers matched 2/1 in 175/117 ms. Full qualification pending.

## Orchestration Mode (AI-selected)
- [x] Single branch, serialized implementation and Docker campaigns.

## UAT Management (in orchestration context)
- [ ] Live UAT/deployment: outside this task; no root checkout changes.

## Plan / Todo (lot-based)
- [x] Lot 0: read instructions, inspect Muse build, merge origin/main 17f439c8.
- [x] Lot 1: implement basket contracts, durable release bytes and opening flow; qualification remains pending below.
- [x] Lot 2: typecheck, ESLint, reader/API unit tests, PostgreSQL reads (conductor evidence at `2279b9ad`).
- [ ] Lot 3: published HTML/CSS/JS browser proof and persistent continuation.
- [ ] Lot 4: discriminating isolation/authorization mutations and full API CI suite.
- [x] Lot 5: audit atomic commits, reconstruct bundle, record results and checksums separately in the owner report.
