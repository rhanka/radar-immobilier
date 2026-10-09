# Fix: Expose the preprod immo MCP like prod

## Objective
Make `https://preprod.immo.sent-tech.ca/mcp` behave like
`https://immo.sent-tech.ca/mcp` (GH #835): same `/mcp` routing (transport and
RFC 9728 PRM under `/mcp/.well-known/oauth-protected-resource`), OAuth resource
`https://preprod.immo.sent-tech.ca/mcp`, the preprod IdP as issuer (the same
mechanism as prod: MCP issuer = the app's own IdP), same scopes. Prod output
must stay byte-identical.

## Scope / Guardrails
- Make-only workflow; worktree `./tmp/mcp-preprod-expose`; `ENV=mcp-preprod`.
- No change to anything prod renders or applies: `deploy/k8s/**` untouched,
  prod `deploy` job and `k8s-apply-mcp.yaml` untouched.
- No cluster write. The preprod Ingress stays operator-owned (k8s session).
- No Python added; secrets stay out of git.

## Branch Scope Boundaries
- **Allowed Paths**:
  - `deploy/overlays/preprod/**`
  - `deploy/ci/check-preprod-auth-isolation.sh`
  - `deploy/ci/check-preprod-auth-isolation.test.sh`
  - `deploy/ci/reconcile-preprod.sh`
  - `docs/reviews/pr-*/**` (this PR's review dossier)
  - `plan/MCPPREPROD-BRANCH_fix-mcp-preprod-expose.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `rules/**`,
  `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, other `plan/*-BRANCH_*.md`,
  `deploy/k8s/**`.
- **Conditional Paths**: `.github/workflows/build-push-images.yml` (comments
  of the `deploy-preprod` job only, see MCPPREPROD-EX1).

## Feedback Loop
- MCPPREPROD-EX1 (`.github/workflows/build-push-images.yml`): the
  `deploy-preprod` comments state that preprod cannot apply the immo-mcp
  ConfigMap; after this change it does (reconcile). Comment-only edit inside
  `deploy-preprod`; impact none on prod; rollback = revert the hunk.

## Orchestration Mode
- [x] Mono-branch + single final test cycle.

## Plan / Todo
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `AGENTS.md`.
  - [x] Live read-only diagnosis (preprod Ingress `/` only, immo-mcp-config
        carries prod resource/public URL, prod PRM under `/mcp`).
  - [x] Capture prod renders before the change.
- [ ] **Lot 1 — Preprod overlay renders the MCP like prod**
  - [x] Tests first: auth-isolation cases for immo-mcp-config and Ingress hosts.
  - [x] Overlay adds 40/41, pins the MCP resource/issuer/public URL, rewrites
        every Ingress to the preprod host and TLS Secret.
  - [x] CD reconcile applies ConfigMap immo-mcp-config when the Deployment exists.
  - [x] Lot gate: `make k8s-validate ENV=mcp-preprod`, auth-isolation tests,
        prod renders identical before/after.
- [ ] **Lot 2 — PR handoff**
  - [ ] Push, PR (Refs #835), CI green.
  - [ ] Two blind Codex review legs, GO.
