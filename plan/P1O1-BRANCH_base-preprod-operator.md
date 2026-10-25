# Feature: BASE preprod operator vehicle

## Objective
- [ ] Deliver P1 bundles and O1 operator tooling; no live activation or push.

## Scope / Guardrails
- [x] Approved v2 design and both reviews read; P2/6K, UI-H and MCP excluded.
- [x] No environment files, secrets, Python, dependencies or new base images.
- [x] Worktree `tmp/base-preprod-p1o1`, branch `feat/base-preprod-operator`.
- [x] Test mapping: ENV=test-base-preprod, API 18925, UI 15925, Maildev 11925.
- [x] Make only; ENV last; one machine-wide Docker campaign; stop below 8 GiB.
- [x] Subject-only English commits, at most 150 changed lines; no push.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: `api/Dockerfile`, `api/src/scripts/*personal*`, `api/src/scripts/init-workspace-authority.ts`, `api/src/scripts/base-preprod*`, `api/tests/integration/base-preprod*`, `tools/make/base-preprod*`, `deploy/base-preprod/**`, `docs/spec/BASE_API_ACTIVATION.md`, this plan, `RAPPORT-SOL-BASE-PREPROD-P1O1.md`.
- [x] Forbidden: root `Makefile`, compose files, rules, agent instructions, other plans, migrations, UI, MCP.
- [x] Conditional: none; Dockerfile change explicitly authorized by P1.

## Feedback Loop
- [x] Owner instruction supersedes automatic coauthor trailers: subject-only commits.
- [x] No 6H opening until successor MCP adapter is deployed and qualified.

## Orchestration Mode (AI-selected)
- [x] Single branch, serial implementation and Docker verification.

## UAT Management (in orchestration context)
- [x] No live UAT or cluster operations; namespace administrator executes later.

## Plan / Todo (lot-based)
- [x] Lot 0: inspect approved design, constraints and existing isolation tooling.
- [ ] Lot 1: bundle scripts and qualify TypeScript/JavaScript entry guards.
- [ ] Lot 2: standalone operator inputs, read-only inspection and hardened Job.
  - [x] Inspection limited to read-only metadata and effective database privileges.
  - [x] Compact Job receipt hashes complete output; Make has explicit inputs only.
  - [x] Digest-pinned Job is non-root, tokenless, bounded and permanently unready.
  - [x] Independent roster, bound maintenance attestations and full receipt hash enforced.
  - [x] Expected DB name/role/schema and effective lock/drop privileges gate mutation.
  - [x] References reject access parameters; manifest arguments and termination bindings are bounded.
  - [x] Initial inspection can bind the target slug before its generated UUID exists.
  - [x] Bound proof tests reject foreign actors, workspaces, attempts/releases and missing/future coverage.
  - [x] Fake-cluster tests reject surviving/restarted workloads, ready endpoints, unsuspended jobs and live CD.
- [ ] Lot 3: permissions, maintenance collection, closure and selective reopening.
  - [x] Explicit Kubernetes/Actions controls and projected workload/route inventories.
  - [x] Closure preserves inventories; collection refuses surviving processes and ready endpoints.
  - [x] Q1/restart/Q2 are separate from reopening; MCP successor deployment is required.
  - [x] Reopening rechecks stopped consumers/jobs; deletion compares the actual saved Job receipt.
  - [x] Collector derives coverage only after independent roster input and live closure checks.
- [ ] Lot 4: operator refusal/transport tests and image execution receipts.
  - [x] Hermetic operator Make tests cover refusals, literal values and no root/environment discovery.
  - [x] Verification serializes Docker campaigns, polls at 60 seconds and monitors 8 GiB floor.
  - [x] Synthetic image proof uses existing Postgres base and actual runtime bundles.
  - [x] Image rehearsal checks all three JSON receipts and byte-stable read-only inspection/resume.
- [ ] Lot 5: complete CI API suite, lint, typecheck and audit gate.
- [ ] Lot 6: runbook, review evidence, local backup, audited bundle and report.
  - [x] Owner-input template and short-path prerequisites/inspection documented.
  - [x] Delivery pins initial origin/main and creates a separate bare backup plus fresh bundle audit.
  - [x] Maintenance observations, collector, protected resume and UID-bound Job termination documented.
