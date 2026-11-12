# Branch: fix/chaperon-reference-c-reprise

## Objective
Re-insert the Chaperon Immobilier triage (reference set C: workbook revision 2026-09-18,
transmitted 2026-09-21) into the PREPROD personal signal facets of the workspace
`agence-chaperon-immobilier`: classification (basket / verdict) and reason code.

Owner decisions (2026-11-12): write on three member accounts (the client account, the
owner account, the Product Owner account) so each can check; INSERT-ONLY ("we do not
touch their real data": a target that already carries a facet of that account is skipped
and listed, never superseded); "Non pertinent" = personal archive on each account, no
workspace archive; source = sealed 21/09 state, no fresh export; loss of the original
date accepted, provenance kept in the command keys and a JSON receipt outside the repo.

## Scope / Guardrails
- Preprod only (`radar-preprod-tenant.kubeconfig`, namespace `radar-immobilier-preprod`);
  the in-pod programs refuse any `APP_BASE_URL` that is not `https://preprod.`.
- Dry run by default: one `REPEATABLE READ READ ONLY` transaction inside radar-api.
- Nothing decrypted is written: the unsealed reference stays in a private mode-700
  directory outside the repository; the plan only travels on the kubectl stdin pipe.
- Write mode goes through the governed writer `writeScopedPersonalFacetInTx` only
  (bundled `api/dist/scripts/chaperon-reprise-apply.js`), never raw SQL.
- No migration, no 0 Python, no `.env` read by the agent.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `scripts/chaperon-reprise.mjs`, `scripts/chaperon-reprise-plan.mjs`, `scripts/chaperon-reprise-pod.mjs`,
    `scripts/chaperon-reprise.test.mjs`
  - `api/src/scripts/chaperon-reprise-apply.ts`, `api/tests/integration/chaperon-reprise-apply.spec.ts`
  - `tools/make/chaperon-reprise.mk`
  - `plan/CHAPREPRISE-BRANCH_fix-chaperon-reference-c-reprise.md`
- **Conditional Paths**:
  - `api/Dockerfile` (one bundle entry) — `BR-CR-EX1`.
  - `deploy/ci/check-image-entrypoints.test.sh` (entrypoint count) — `BR-CR-EX4`.
  - `.github/workflows/ci.yml` (one gate step) — `BR-CR-EX5`.
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`, `AGENTS.md`,
  `GEMINI.md`, other `plan/*BRANCH_*.md`, `api/drizzle/**`, other `.github/workflows/**`, `.env`,
  `docs/spec/reports/reference-c/**` (sealed set, read only).

## Feedback Loop
- `BR-CR-EX1` (accepted): add `api/src/scripts/chaperon-reprise-apply.ts` to the api image
  bundle list. Reason: the governed writer is only reachable from inside the image.
  Impact: one more bundled operator script. Rollback: drop the line.
- `BR-CR-EX2` (accepted): commits via plain `git commit`, no trailer (owner rule).
- `BR-CR-EX4` (accepted): the released entrypoint count moves from 27 to 28 and the operator
  entrypoint loop covers `chaperon-reprise-apply`. Reason: the hermetic entrypoint test pins the
  count. Impact: none outside the test. Rollback: revert both lines with BR-CR-EX1.
- `BR-CR-EX5` (accepted): one CI step `make -f tools/make/chaperon-reprise.mk test` (plan unit
  tests + apply integration spec with `LOT_MIGRATION_DB_TEST=1`, stack removed with `down -v`).
  Reason: independent review asked for these tests in CI. Impact: one more Docker step in
  Quality gates. Rollback: drop the step.
- `BR-CR-EX3` (accepted): the host driver runs with the host `node`, like
  `scripts/reference-seal.mjs` (needs the private unsealed directory and kubectl).

## Plan / Todo
- [x] Lot A1 — source located, reference set C unsealed through `scripts/reference-seal.mjs`.
- [x] Lot A2 — mapping columns -> facet fields; exact + stable-key matching measured on preprod.
- [x] Lot A3 — host driver with in-pod read-only dry run; governed apply script; unit tests (synthetic).
- [x] Lot A4 — dry run against preprod (release fa86c8647): 162/162 exact, 162 inserts planned.
- [x] Lot B0 — owner GO (2026-11-12); multi-account insert-only driver and writer; dry run 3 x 162 inserts.
- [x] Lot B1 — review fixes: entrypoint count, apply JSON and receipt kept on readback gap,
  receipt path checked first, CI gate + integration spec, per-node dedup, command-key noop,
  workspace lock, receipt scope, no `--json`, exact kubeconfig.
- [ ] Lot B — merge + CD to preprod; dry run right before; `--apply`; readback per account and city
  with the `baskets.search.v1` head reader.
- [ ] Lot C — replay after each prod -> preprod restore (hook after replay, before reopening, #984 model).
