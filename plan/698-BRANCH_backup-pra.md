# Feature: PostgreSQL recovery and coordinated immo + geo PRA

## Objective
- [ ] Repair PR #712 and deliver the joint recovery sequence and branch-based premerge proof.

## Scope / Guardrails
- [x] Work only in `tmp/backup-pra-698`; no commit, push, secret values or cluster actions.
- [x] Use Make entry points; tests use `ENV=test-backup-pra`, no published ports (reserved API/UI/mail ports 8898/5398/1198).
- [x] Preserve `.h2a/` and unrelated existing changes.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `deploy/k8s/*backup*`, `deploy/k8s/db-backup/**`, `deploy/k8s/db-restore-verify/**`, `deploy/k8s/backup-*/**`, `deploy/ci/backup-*`, `deploy/ci/README.md`, `docs/spec/reports/PLAN_BACKUP_PRA_2026-09-17.md`, this plan.
- [x] Forbidden Paths: `rules/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, other branch plans, application code, other repositories.
- [x] Conditional Paths: `.github/workflows/**`, existing deployment manifests, `Makefile`.

## Feedback Loop
- [x] BR698-EX1: adjust base/preprod references, network and secret examples to route backups through dedicated overlays; rollback by reverting those hunks.
- [x] BR698-EX2: add backup image build and scoped CI tests; required for a runnable PG16/PostGIS + Python backup image; rollback by removing the backup build/test entries.
- [x] Brief requests rebase; latest owner forbids any commit. Preserve HEAD and deliver working changes for conductor rebase (71 main commits ahead at initial inspection).

## Orchestration Mode (AI-selected)
- [x] Single worktree; conductor coordinates the separate geo PR.

## UAT Management (in orchestration context)
- [ ] Lane k8s executes branch-rendered preproduction proof before merge; owner authorizes production application.

## Plan / Todo (lot-based)
- [x] V3: consolidate S3 roles into writer (including receipt writes), read-only reader (including bucket settings), isolated retainer; preserve the non-secret settings ConfigMap and other non-S3 resource names.
- [x] V3: owner-only idempotent backup-provision with OVH policy/key reuse, private versioned buckets, lifecycle, denial probes and server-side Secret apply through stdin.
- [x] V3: offline backup-test passes 18 backup tests, 12 provisioning tests and 26 runner assertions; absent-guard/environment Make invocations fail before external commands. Docker-only tests use --rm with no Compose stack/volumes; no down -v needed.
- [ ] V3: owner live OVH/cluster execution remains external; API policy/credential routes are BETA, project entitlement and S3 enforcement/public-block support remain unverified.
- [x] Lot 0: read rules, complete brief and both contradictory reviews; inspect actual scripts and CD path.
- [x] Lot 1: coherent dump manifest, isolated restore, retention, freshness and failure tests (18 tests + 26 existing assertions pass).
- [x] Lot 2: resources, credentials, network, dedicated active overlays and branch proof commands; both overlays and base render offline.
- [x] Lot 3: joint immo + geo recovery plan, evidence and remaining external gates documented.
- [ ] Lot 4: conductor review, preproduction proof, paired PR integration (no commit/push by this lane).
