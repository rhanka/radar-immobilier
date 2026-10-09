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
  - `deploy/ci/reconcile-preprod-mcp.test.sh`
  - `docs/reviews/pr-*/**` (this PR's review dossier)
  - `plan/MCPPREPROD-BRANCH_fix-mcp-preprod-expose.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `rules/**`,
  `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, other `plan/*-BRANCH_*.md`,
  `deploy/k8s/**`.
- **Conditional Paths**: `.github/workflows/ci.yml` (one test step) and
  `.github/workflows/build-push-images.yml` (comments
  of the `deploy-preprod` job only, see MCPPREPROD-EX1).

## Feedback Loop
- MCPPREPROD-EX1 (`.github/workflows/build-push-images.yml`): the
  `deploy-preprod` comments state that preprod cannot apply the immo-mcp
  ConfigMap; after this change it does (reconcile). Comment-only edit inside
  `deploy-preprod`; impact none on prod; rollback = revert the hunk.
- MCPPREPROD-EX2 (`.github/workflows/ci.yml`): one quality step running the
  hermetic `deploy/ci/reconcile-preprod-mcp.test.sh` (review ASTRA-837-02);
  impact: CI runtime of a few seconds, no prod effect; rollback = drop the step.

## Orchestration Mode
- [x] Mono-branch + single final test cycle.

## Plan / Todo
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `AGENTS.md`.
  - [x] Live read-only diagnosis (preprod Ingress `/` only, immo-mcp-config
        carries prod resource/public URL, prod PRM under `/mcp`).
  - [x] Capture prod renders before the change.
- [x] **Lot 1 — Preprod overlay renders the MCP like prod**
  - [x] Tests first: auth-isolation cases for immo-mcp-config and Ingress hosts.
  - [x] Overlay adds 40/41, pins the MCP resource/issuer/public URL, rewrites
        every Ingress to the preprod host and TLS Secret.
  - [x] CD reconcile applies ConfigMap immo-mcp-config when the Deployment exists.
  - [x] Lot gate: `make k8s-validate ENV=mcp-preprod`, auth-isolation tests,
        prod renders identical before/after.
- [ ] **Lot 2 — PR handoff**
  - [x] Push, PR #837 (Refs #835).
  - [x] Review round 1: astra GO-with-nits (ASTRA-837-01/02), sol GO-with-nits
        (SOL-837-01/02); fixes: reconcile rolls the MCP on ConfigMap change
        and fails on lookup errors (hermetic test), isolated Ingress test
        mutations, IdP handoff completed in the PR body.
  - [x] CI green (eb35da93).
  - [x] Review round 2: both GO-with-nits, same retry gap; fixed with the
        resourceVersion pod-template annotation.
  - [x] Review round 3: both GO-with-nits, same test-coverage gap; fixed with
        a strict stateful fake (8 cases).
  - [x] Review round 4: both GO-with-nits (test coverage of the apply
        arguments/content and read failures); fixed (11 cases).
  - [x] Review round 5: astra GO; sol GO-with-nits (applied-document
        assertion missed RADAR_API_BASE_URL); fixed with a byte comparison.
  - [ ] Review round 6, GO.
