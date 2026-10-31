# Feature: Classification pilot L0 — guard, draws, route probes

## Objective
Lot L0 of the Steve-aligned classification pilot (plan-pilote-v2 §B-L0, §H): seal the evaluation set with the reference-c mechanism, draw the dev PVs and signals, probe the 12 model routes.

## Scope / Guardrails
- Scope limited to `tools/classif/**`, the sealed evaluation folder and this branch file.
- No DB, cluster or S3 write: DB = SELECT in a READ ONLY transaction; S3 = `s5cmd ls/cp` read-only.
- Engram unchanged (0.21.2 pinned); 0 Python; private outputs in `$CLASSIF_HOME` (mode 700).
- Steve's labels never leave the machine, are never printed and never reach optimisers.
- Branch development in `./tmp/classif-pilot-l0`; `ENV` last in every `make` command.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `tools/classif/**`
  - `docs/spec/reports/classif-eval/**`
  - `plan/CLASSIFL0-BRANCH_feat-classif-pilot-l0.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `docs/spec/reports/reference-c/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BRCLASSIF-EX2)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `attention` BRCLASSIF-EX1: host Node for `tools/classif/**` targets. Reason: they drive host-only CLIs (kubectl, s5cmd, muse, agy, claude, vibe) with seat logins; node built-ins only, no npm dependency. Impact: no container image. Rollback: delete `tools/classif/`.
- `attention` BRCLASSIF-EX2: one line `-include tools/classif/classif.mk` in `Makefile`. Impact: adds `classif-*` targets only. Rollback: remove the line.
- `clarification` (conductor, 2026-10-31): the conductor runs `make classif-guard-unseal ENV=preprod` with `REFERENCE_C_KEY` and `CLASSIF_EVAL_KEY` injected; the evaluation set is sealed with the reference-c mechanism (REFC1, plaintext hashes in a README, byte-for-byte round trip); no plaintext stays on disk.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one builder, one lot, tooling only.

## UAT Management (in orchestration context)
- No UI surface: no UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and pointers.
  - [x] Create isolated worktree `./tmp/classif-pilot-l0` from `origin/main`.
  - [x] Confirm command style: `make ... ENV=<env>` with `ENV` last.
  - [x] Declare BRCLASSIF-EX1 and BRCLASSIF-EX2.

- [ ] **Lot 1 — Guard and evaluation-set seal**
  - [x] `tools/classif/lib/refc1.mjs`: REFC1 library (mechanism of `scripts/reference-seal.mjs`), env-only keys.
  - [x] `tools/classif/guard/unseal.mjs` + `make classif-guard-unseal ENV=preprod`.
  - [x] `tools/classif/guard/evalset.mjs`: executor role, hash check, one run per prompt/model/effort, access log.
  - [x] Unit tests on a synthetic sealed fixture (`make classif-test ENV=test-classif`).
  - [x] Conductor run done; sealed files and README committed.

- [ ] **Lot 2 — Draws**
  - [ ] `make classif-l0-pvs ENV=preprod`: 120 PVs, seed committed in track first, text read-only, sha256 checked.
  - [ ] `make classif-l0-signals ENV=preprod`: pool + strata; draw refused until `exclusions.json` exists.

- [ ] **Lot 3 — Probes and sandbox scanner**
  - [ ] `tools/classif/run-seat.mjs` + `make classif-l0-probe ENV=preprod`: 12 probe calls, report.
  - [ ] `make classif-sandbox-build DIR=<dir> ENV=preprod`: fingerprint scanner.

- [ ] **Lot 4 — Gate**
  - [ ] `make classif-check ENV=test-classif` + `make classif-test ENV=test-classif`.
  - [ ] `harness verify --category static` and `--category unit`.
  - [ ] Push branch (no PR).
