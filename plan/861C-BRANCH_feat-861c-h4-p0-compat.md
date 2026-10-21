# H4 P0 — Compatibility provenance and isolated verification — 861c

## Objective
- Preserve the twelve-tool MCP compatibility evidence: recover the historical captured fixture bytes, attribute the `showDiscarded` source amendment separately, retain the historical 401 capture, and keep capture/source/ingress/stdio evidence classes distinct.
- Prepare isolated verification: exclude service E2E from the ordinary `test-mcp` target and add a dedicated guarded H4 runner skeleton. No runtime change.

## Scope / Guardrails
- Scope limited to MCP fixture provenance, `deployed-baseline.test.ts` and the discovery/session/egress suites (read-only reference), `tools/immo-mcp-test.mk` (reference runner), the bounded `test-mcp` exclusion in `tools/artifact-host.mk`, the new `tools/h4-mcp.mk` runner, one provenance record and one new provenance test.
- No runtime change: tooling, provenance fixtures and tests only. No dependency or lockfile change.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in this worktree (branch `feat/861c-h4-p0-compat`); do not use system `/tmp` for deliverables.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- Test ports for every H4 campaign: API 18914, UI 15914, Maildev UI 11914. The proposed service stack publishes no host ports.
- All new text in English. No Python. Never read `.env` files.
- Every commit stays under 150 changed lines and at most 15 files, plan update included. Commit subjects are Conventional Commits in English, 72 characters max, no body, no trailer.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/861C-BRANCH_feat-861c-h4-p0-compat.md`
  - `packages/immo-mcp/src/fixtures/immo-tools.provenance.v1.json`
  - `packages/immo-mcp/src/tool-fixture-provenance.test.ts`
  - `tools/artifact-host.mk` (bounded: `test-mcp` E2E exclusion only)
  - `tools/h4-mcp.mk` (new isolated H4 runner skeleton)
  - `tools/immo-mcp-test.mk` (reference runner; change only if guard parity is needed, none planned)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile` (root)
  - `docker-compose*.yml`
  - `api/**`
  - `packages/artifacts-host/**`
  - `packages/immo-mcp/src/server-http.ts`, `server.ts`, `tools.ts`, `data-source.ts`, `raw-data.ts`, `auth-context.ts`
  - Existing MCP suites (`deployed-baseline.test.ts`, `oauth-discovery.test.ts`, `server-http.test.ts`, `http-session-egress.test.ts`, `data-source.test.ts`) — behavior frozen, reference only
  - `deploy/**`
  - Dependency manifests and lockfiles
  - `.env*` files (never read, load or create)
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None for P0.
- **Exception process**:
  - Declare exception ID `BR861C-P0-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `acknowledge` — Git objects `07f1f4b2` (before `3d2869a3`) and `608ae5bd` establish the captured/amended bytes. Correct the transcribed historical hash to `31487e8f...dae1b44d998`; keep existing fixtures and receipts untouched.
- `acknowledge` — Reproduced unsafe teardown argument injection with `ENV=test-h4 -p radar-dev` against a Docker stub. Restrict slugs and fix Compose project/environment options before qualification.
- `clarification` — The execution brief authorizes this assigned `.worktrees/861c-h4-p0` workspace, local Git delivery under `tmp/861c-h4-p0/git`, temporary canaries and an uncommitted French report. Shared Git metadata is read-only; no push, PR or merge is requested.
- `acknowledge` — MCPAUTH022 net: the existing discovery/session/egress suites stay green untouched; the new provenance test only adds assertions.
- `deferred` — The missing-coarse-scope 403 `insufficient_scope` expectation belongs to P4 (mcp-auth 0.2.2); P0 retains the 401 capture and records the delta separately.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (single final test cycle; no commit copying)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: P0 is a small additive tooling/provenance change with no runtime surface; one branch and one test cycle are sufficient.

## UAT Management (in orchestration context)
- No UI surface is impacted; no UAT checkpoint applies to P0. The fixed root `dev` ports are untouched.

## Make matrix (H4 verification entrypoints)
- P0: `make -f tools/immo-mcp-test.mk typecheck lint test-immo-mcp API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p0`
- P0: `make -f tools/artifact-host.mk test-mcp API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p0` (service E2E excluded)
- P4 (required addition, skeleton in P0): `make -f tools/h4-mcp.mk qualify-tuple API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p4`
- P4 (required addition, skeleton in P0): `make -f tools/h4-mcp.mk test-exchange-e2e API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p4`
- P6 (required addition, skeleton in P0): `make -f tools/h4-mcp.mk image-smoke API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p6`
- P7 (required addition, skeleton in P0): `make -f tools/h4-mcp.mk test-composition-e2e API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p7`
- Teardown/inspection with the same runner and ENV, including after failures: `down` then `inspect` from the matrix above.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read `rules/MASTER.md` and pointers (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`).
  - [x] Confirm this worktree and branch `feat/861c-h4-p0-compat`; root checkout stays on user dev.
  - [x] Confirm command style: `make -f tools/<runner>.mk <target> API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p0` with `ENV` last.
  - [x] Confirm scope and guardrails; execution-brief clarifications recorded above.
- [x] **Lot 1 — Fixture provenance record**
  - [x] Write `packages/immo-mcp/src/fixtures/immo-tools.provenance.v1.json`: captured hash `31487e8f...`, amended source hash `2145e05a...`, `showDiscarded` attribution to the 6C sub-lot amendment, retained 401 capture with the separately recorded 403 delta, five-stub inventory, evidence-class distinction.
  - [x] Files: `packages/immo-mcp/src/fixtures/immo-tools.provenance.v1.json`, this plan.
  - [x] Lot gate:
    - [x] JSON parses and hashes match the design and the deployed-baseline receipt.
    - [x] No runtime file touched.
- [x] **Lot 2 — Discriminating provenance tests**
  - [x] Write `packages/immo-mcp/src/tool-fixture-provenance.test.ts`: derived captured bytes hash, amended hash, exact `showDiscarded` block, five `not_wired_yet` stubs, retained 401 capture, evidence-class distinction, ordinary-target E2E exclusion, H4 runner guards.
  - [x] Files: `packages/immo-mcp/src/tool-fixture-provenance.test.ts`, this plan.
  - [x] Lot gate:
    - [x] `make -f tools/immo-mcp-test.mk typecheck lint test-immo-mcp API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p0`
- [x] **Lot 3 — Ordinary-target E2E exclusion**
  - [x] Append `-- --exclude '**/*.e2e.test.ts'` to the `test-mcp` recipe in `tools/artifact-host.mk`, matching `test-immo-mcp`.
  - [x] Files: `tools/artifact-host.mk`, this plan.
  - [x] Lot gate:
    - [x] Both ordinary targets pass 134 tests with a throwing E2E canary present in a copy; removing the exclusion executes it and fails. Restore the runner, remove the canary and confirm `cmp=0`.
    - [x] `make -f tools/artifact-host.mk test-mcp API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p0-canary`
- [x] **Lot 4 — Dedicated H4 runner skeleton**
  - [x] Write `tools/h4-mcp.mk`: strict `test-*`/`e2e-*` slugs, environment-file refusal, fixed Compose options, project-scoped cleanup/inspection and phase placeholders refusing execution before P4/P6/P7.
  - [x] Files: `tools/h4-mcp.mk`, this plan.
  - [x] Lot gate:
    - [x] Runner never includes the root Makefile and never references `env_file`.
    - [x] `test-guard` behaviorally verifies eight unsafe slugs, two project bindings despite overrides and environment-file refusal without Docker.
    - [x] Provenance test guard assertions pass through the Lot 2 command.
- [x] **Lot 5 — Docs consolidation**
  - [x] Tick every completed checkbox in this plan within its own lot commit.
  - [x] Write the uncommitted French integrator report `RAPPORT-SOL-H4-P0.md`; retain Muse's initial report as historical context.
  - [x] Recover historical Git bytes, prove hash mutation failure/restoration (`cmp=0`), and record all local qualification evidence under `tmp/861c-h4-p0/evidence`.
- [ ] **Lot N — Merge and close (operator-owned; outside this execution brief)**
  - [ ] Push branch.
  - [ ] Open PR (or merge directly if solo dev).
  - [ ] Verify CI green.
  - [ ] Merge commit (NO squash, NO rebase merge).
  - [ ] Preserve branch (do NOT delete on merge).
  - [ ] Move this file to `plan/done/861C-BRANCH_feat-861c-h4-p0-compat.md`.
