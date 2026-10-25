# Feature: BASE preprod operator vehicle

## Objective
- [x] Deliver P1 bundles and O1 operator tooling; no live activation or push.

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
- [x] P1O1-EX1: owner PR920 instruction authorizes `deploy/ci/check-image-entrypoints.test.sh`; repair the active-entry inventory without weakening validation; rollback only with P1 removal.

## Feedback Loop
- [x] Owner instruction supersedes automatic coauthor trailers: subject-only commits.
- [x] No 6H opening until successor MCP adapter is deployed and qualified.
- [x] attention: peer-review selection failed without an exact author model; evidence records no consensus verdict.

## Orchestration Mode (AI-selected)
- [x] Single branch, serial implementation and Docker verification.

## UAT Management (in orchestration context)
- [x] No live UAT or cluster operations; namespace administrator executes later.

## Plan / Todo (lot-based)
- [x] PR920: init requires a null UUID and identical declared/argument slug; returned UUID resolves to that slug, also checked at collection.
- [x] PR920: shared SQL matrix covers every operation; row-lock UPDATE and all five table locks gate proofs and the runtime before mutation.
- [x] PR920: immutable image SHA gates execution; proofs, Job/pod digest and complete/termination receipts must agree.
- [x] PR920: restart receipt records live generation/template/pod/container identity and times; reopening compares Q2 to that instance again.
- [x] PR920: collect both terminal Job outcomes; failed verified receipts persist with nonzero exit and explicit read-only collect-job.
- [ ] PR920: reproduce offline K8s CI, mutation tests and fresh bundle audit from c100e6cc.
- [x] Lot 0: inspect approved design, constraints and existing isolation tooling.
- [x] Lot 1: bundle scripts and qualify TypeScript/JavaScript entry guards.
  - [x] Built API image emitted successful JSON receipts from all three JavaScript bundles.
- [x] Lot 2: standalone operator inputs, read-only inspection and hardened Job.
  - [x] Built-image inspection and already-open resume preserved every public SQL row.
  - [x] Inspection limited to read-only metadata and effective database privileges.
  - [x] Compact Job receipt hashes complete output; Make has explicit inputs only.
  - [x] Digest-pinned Job is non-root, tokenless, bounded and permanently unready.
  - [x] Independent roster, bound maintenance attestations and full receipt hash enforced.
  - [x] Expected DB name/role/schema and effective lock/drop privileges gate mutation.
  - [x] References reject access parameters; manifest arguments and termination bindings are bounded.
  - [x] Initial inspection can bind the target slug before its generated UUID exists.
  - [x] Bound proof tests reject foreign actors, workspaces, attempts/releases and missing/future coverage.
  - [x] Fake-cluster tests reject surviving/restarted workloads, ready endpoints, unsuspended jobs and live CD.
  - [x] Reopening tests require both qualifications, available API and stopped excluded consumers.
  - [x] Job collection tests accept complete bound receipts and refuse corrupted stdout hashes.
- [x] Lot 3: permissions, maintenance collection, closure and selective reopening.
  - [x] Explicit Kubernetes/Actions controls and projected workload/route inventories.
  - [x] Closure preserves inventories; collection refuses surviving processes and ready endpoints.
  - [x] Q1/restart/Q2 are separate from reopening; MCP successor deployment is required.
  - [x] Reopening rechecks stopped consumers/jobs; deletion compares the actual saved Job receipt.
  - [x] Both old and operator Job deletion use Kubernetes UID preconditions.
  - [x] Collector derives coverage only after independent roster input and live closure checks.
- [x] Lot 4: operator refusal/transport tests and image execution receipts.
  - [x] Hermetic operator Make tests cover refusals, literal values and no root/environment discovery.
  - [x] Verification serializes Docker campaigns, polls at 60 seconds and monitors 8 GiB floor.
  - [x] Synthetic image proof uses existing Postgres base and actual runtime bundles.
  - [x] Image rehearsal checks all three JSON receipts and byte-stable read-only inspection/resume.
- [x] Lot 5: complete CI API suite, lint, typecheck and audit gate.
  - [x] 3,632 API tests passed, zero failed, 76 conditionally skipped; all seven typechecks, lint and audit passed.
  - [x] Final immutable runner exited zero and removed only owned test resources.
  - [x] Corrected disposable archive to retain root API test helpers and full CI include list.
- [x] Lot 6: runbook, review evidence, local backup, audited bundle and report.
  - [x] 51 hermetic operator cases and static Job render passed; local backup and fresh-repository bundle audit passed.
  - [x] Root delivery report generated separately from the source payload; final receipt refresh follows the last metadata commit.
  - [x] Owner-input template and short-path prerequisites/inspection documented.
  - [x] Delivery pins initial origin/main and creates a separate bare backup plus fresh bundle audit.
  - [x] Maintenance observations, collector, protected resume and UID-bound Job termination documented.
  - [x] Q1/Q2, exact retirement statuses and API-only restitution commands documented.
