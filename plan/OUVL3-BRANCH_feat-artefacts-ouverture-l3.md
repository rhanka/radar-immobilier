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
- [x] Replace browser route interception with loopback HTTPS and Chromium resolver rules; transport requalified by conductor at `60c10a1d`; product corrections are recorded below.
- [x] Targeted host Chromium regression passed (HTTPS redirects, CSS/JS, Secure cookie separation); strict helper typecheck passed. No Docker used for these corrections.
- [x] Bootstrap qualification with curl, jq and openssl before tests; all three delivery-probe cases passed in the real qualification image.
- [x] Conductor requalified `60c10a1d`: all gates except browser passed, including 4131 API CI tests and 10 mutations.
- [x] Instrument browser console, CSP, network, H5 bodies and server-side Origin, with credentials redacted. Reproduced POST Origin `null` and 403 `forbidden_origin` before published code or H5 runs.
- [x] Fix approval response policies: same-origin referrers preserve CSRF Origin; form-action allows only the authorized artifact origin for Chromium's 303 chain. H5 returned 200 with two matched baskets in 182 ms; unchanged 1500 ms wait.
- [x] Align mounted reader API denials with private reader isolation headers, keeping 401 before delegation. Targeted 21/0/0 passed; two browser readers matched 2/1 in 175/117 ms.
- [x] Full qualification at `6365b696` passed all 10 gates by 15:59 UTC: 3215 API unit tests, 63 PostgreSQL reads, browser acceptance, 10 killed mutations and 4133 API CI tests. Evidence: `tmp/sol-l3-evidence/20261027T154538-5/`.
- [x] Docker cleanup completed with exit 0; no L3 containers, volumes or networks remain. Runner exited and released its lock; foreign L12 campaign subsequently observed, untouched.
- [x] Read both complete Astra reviews of PR #931 at `0e9c0cbe`; owner requests the bounded corrections below, no push, incremental bundle from that head.
- [x] OUVL3-EX2: allow `api/src/routes/auth.ts` and its auth tests only for validated reader login resumption. Impact: optional, same-origin reader return target in the existing OIDC flow; rollback: remove that optional return path, leave login unchanged.
- [ ] Authorize native transitive resources with a host/release/session-bound reader cookie; remove HTML query rewriting and normalize CSP input line endings.
- [ ] Resolve readable historical pinned releases and scope authority versions to the relevant artifact/reader.
- [ ] Preserve the existing basket error contracts and resume opening through the existing login flow.
- [ ] Keep the Muse report only in local evidence; qualify browser imports, CRLF and consecutive publications, then all gates.
- [x] Implement pinned-host opening and a sealed resource authority in the reader cookie; native files recheck current rights while H5 still requires its explicit grant. Acceptance pending below.
- [x] Remove grant injection from HTML entirely; normalize CRLF/CR to LF before emission and CSP hashing. Inline source and native resource URLs remain intact.
- [x] Add Chromium cases for module/CSS imports, dynamic scripts, LF/CRLF inline code and two successive pinned publications; adapt opening proof to canonical pinned sessions. Execution pending.
- [x] Reuse classification query decoding and error projection for basket reads, including request IDs and internal errors; keep resource and non-basket contracts separate.
- [x] Route disconnected readers through existing OIDC login, retaining only a validated local resume path; restart on the validated pinned host to refresh expired browser binding.
- [x] Add native-file boundary tests (reader/release/host substitution, missing or invalid grants, manifest misses, revocation) and compare all three read error envelopes with the existing routes.
- [x] Add OIDC return-target tests and PostgreSQL regressions for fresh post-login binding and unrelated account/ACL changes during a blob read.

## Orchestration Mode (AI-selected)
- [x] Single branch, serialized implementation and Docker campaigns.

## UAT Management (in orchestration context)
- [ ] Live UAT/deployment: outside this task; no root checkout changes.

## Plan / Todo (lot-based)
- [x] Lot 0: read instructions, inspect Muse build, merge origin/main 17f439c8.
- [x] Lot 1: implement and qualify basket contracts, durable release bytes and opening flow.
- [x] Lot 2: typecheck, ESLint, reader/API unit tests, PostgreSQL reads (conductor evidence at `2279b9ad`).
- [x] Lot 3: published HTML/CSS/JS browser proof (2/1 matched at 161/124 ms) and PostgreSQL persistent continuation passed.
- [x] Lot 4: all 10 isolation/authorization mutations killed; full API CI suite 4133/0/77 passed.
- [x] Lot 5: audit atomic commits, reconstruct bundle, record results and checksums separately in the owner report.
