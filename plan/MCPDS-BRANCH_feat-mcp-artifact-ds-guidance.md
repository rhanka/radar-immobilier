# Feature: Artifact design-system and reader authoring guidance

## Objective
Give every artifact author the official Sentropic starter and H5 reader contract through the existing MCP creation and retrieval tools. Style reader approval with the same official design kit.

## Scope / Guardrails
- Implement the owner's 2026-11-01 Astra recommendation and framework addendum.
- Keep durable receipts, publication limits, reader authority and release CSP unchanged.
- Use the existing requested `.worktrees/mcp-ds-guidance` checkout.
- Run commands through Make; no Python, secrets, cluster operations or environment-file reads.
- Use `ENV=test-mcp-ds-guidance` last; remove the isolated stack with `down -v` after verification.
- The standalone Make runner uses `--env-file /dev/null`, no host ports and synthetic defaults.
- Keep commits free of attribution/session/generated trailers, as explicitly required by the owner.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/immo-mcp/src/registry/**`
  - `packages/artifacts-host/src/design-kit*.ts`
  - `packages/artifacts-host/src/index.ts`
  - `api/src/artifacts/design-kit*.ts`
  - `api/src/artifacts/design-assets/**`
  - `api/src/artifacts/content-serve.ts`
  - `api/src/artifacts/reader-opening.ts`
  - `api/src/app.ts`
  - `api/tests/integration/artifacts-{reader-opening,baskets-browser,baskets,starter-browser}*`
  - `api/Dockerfile`
  - `plan/MCPDS-BRANCH_feat-mcp-artifact-ds-guidance.md`
- **Forbidden Paths (must not change in this branch)**:
  - `deploy/cutover/**`, `tools/make/cutover*`
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`
  - Other branch plans, migrations, kube config and environment files
- **Conditional Paths**:
  - None required.

## Feedback Loop
- [x] MCPDS-EX1: reuse the owner-specified existing worktree rather than `tmp/`; no other checkout changes.
- [x] MCPDS-EX2: vendor upstream CSS verbatim in an indivisible commit, exceeding 150 lines; required to preserve upstream hashes. Rollback removes this kit and its manifest together.
- [x] MCPDS-EX3: keep complete directly publishable starter/guide units together when they exceed the normal 150-line guideline; inherited uncommitted work was reviewed, not discarded.
- [x] MCPDS-EX4: user explicitly requires no commit trailers, overriding the default attribution recipe; use the standalone Make commit target.

## Orchestration Mode (AI-selected)
- [x] Single branch, all work performed directly in this session; no delegation or background workflow.

## UAT Management
- [x] Do not change the root checkout or fixed dev environment.
- [ ] Qualify approval and starter in isolated Chromium over HTTPS with the real CSP.
- [ ] Owner/conductor qualifies the actual refreshed Claude.ai connector after deployment; no cluster action authorized here.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Reprise**
  - [x] Read project rules, authoring design, reference page and existing modifications.
  - [x] Identify missing tool instructions and content-origin data boundary.
  - [x] Inspect official assets, framework bindings and UI-state design.
- [x] **Lot 1 — Official design assets**
  - [x] Version/hash/MIME manifest, closed path and runtime integrity checks.
  - [x] Serve assets inside content reader authority and publicly for app approval.
  - [x] Include assets alongside all production bundle entrypoints.
- [x] **Lot 2 — MCP guide and starter**
  - [x] Add mandatory DS/H5 descriptions and response-only guide in ensure/get.
  - [x] Include four publishable files, explicit workspace, typed failures and shared renewal.
  - [x] Include framework source adapters, DS prompt identities, package inventory and local UI-state contract.
- [x] **Lot 3 — Approval**
  - [x] French native form, official DS CSS, mobile layout and exact style hash.
  - [x] Preserve fields, CSRF, conditional write copy and pinned redirects.
- [ ] **Lot 4 — Verification and delivery**
  - [ ] Targeted API/MCP/host tests and HTTPS Chromium acceptance.
  - [ ] Scoped typecheck/lint and pinned static DS audit.
  - [ ] Push, open an English PR and write the French conductor report.
  - [ ] Record follow-ups in the PR: server enforcement, guide tool/resource, framework runtimes, Elements, OpenAPI and ui://.
