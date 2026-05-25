# PLAN — Orchestrated Roadmap `radar-immobilier`

Status: Updated 2026-05-25 — CONDUCTOR `chore/uat-env-conductor` in progress: pins UAT to the root checkout at fixed dev ports (stable URL `http://localhost:5301`), adds `make conductor-report` + `.agents/` lane registry + `make down-stale`, and tears down merged-branch stacks. BR-05R `feat/source-value-review-ui` is in visual UAT (round 1 corrections captured in its SPEC_EVOL §6). BR-04 remains in review on PR #8 with companion `poc-k8s` tenant PR #12.

## 0) Repo merge policy (inherited from sentropic, effective from BR-00)

- Squash merge: **DISABLED**.
- Rebase merge: **DISABLED**.
- Merge commit: **ONLY allowed merge strategy**.
- `delete_branch_on_merge`: **DISABLED** — source branches MUST be preserved post-merge.

Reference: sentropic incident on PR #141 (2026-05-13). Every PR is merged via a merge commit; source branches stay alive.

## 1) Current state

**Completed branches (merged):**
- BR-00 `chore/scaffolding-base` — merged 2026-05-24 (PR #1, `f139ee8`). Archived at `plan/done/00-BRANCH_chore-scaffolding-base.md`.
- BR-01 `feat/spec-evol-scaffolding-design` — merged 2026-05-24 (PR #2, `9f3447a`). Archived at `plan/done/01-BRANCH_feat-spec-evol-scaffolding-design.md`.
- BR-02 `feat/api-skeleton-hono-postgres-s3` — merged 2026-05-24 (PR #3, `6814d8b`). Archived at `plan/done/02-BRANCH_feat-api-skeleton-hono-postgres-s3.md`.
- BR-03 `feat/ui-skeleton-svelte-ds` — merged 2026-05-25 (PR #5, `27ace35`). Archived at `plan/done/03-BRANCH_feat-ui-skeleton-svelte-ds.md`.
- CI-FIX `fix/ci-pr-actions-trigger` — merged 2026-05-25 (PR #7, `c86d699`). Archived at `plan/done/CIFIX-BRANCH_fix-ci-pr-actions-trigger.md`.
- BR-05 `feat/source-investigation-spikes` — merged 2026-05-25 (PR #9, `74c5ead`). Archived at `plan/done/05-BRANCH_feat-source-investigation-spikes.md`.
- CI-FIX2 `fix/gh-pages-unsupported` — merged 2026-05-25 (PR #10, `88f31bd`). Archived at `plan/done/CIFIX2-BRANCH_fix-gh-pages-unsupported.md`.

**Active execution:**
- CONDUCTOR `chore/uat-env-conductor` — UAT env stability + `conductor-report`
  + `.agents/` lane registry. Plan: `plan/CONDUCTOR-BRANCH_chore-uat-env-conductor.md`.
- BR-05R `feat/source-value-review-ui` — visual UAT (round 1). Plan:
  `plan/05R-BRANCH_feat-source-value-review-ui.md`.
- BR-04 `feat/k8s-tenant-radar-and-infra` — in review on radar PR #8 and
  companion k8s-ops PR #12.

**Pending branches (ordered execution):**
- BR-06 `feat/data-model-investigation`
- BR-07 `feat/vertical-slice-avis-publics`
- BR-08 `feat/graphify-radar-integration`
- BR-09 `feat/auth-passkey-magic-link`
- BR-10 `feat/carte-interactive`
- BR-11 `feat/chat-demo-storyboard`
- BR-12 `feat/uat-and-pricing-pack`

## 2) Foundational branches

`BR-00` and `BR-01` are structural and must complete sequentially before any feature work :

- **BR-00 (`chore/scaffolding-base`)** bootstraps the repo: Makefile, docker-compose, multi-agent rules (`rules/MASTER.md` + `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`), `.claude/skills/`, npm workspace, CI baseline, `PLAN.md`, `plan/BRANCH_TEMPLATE.md`. All branches inherit its conventions.
- **BR-01 (`feat/spec-evol-scaffolding-design`)** brings the validated `SPEC_EVOL_SCAFFOLDING.md` into the repo (already drafted at scaffolding spec stage). It also seeds `docs/spec/SPEC_INTENT_SCAFFOLDING.md`.

Three parallel tracks become possible afterwards: API skeleton (`BR-02`), UI skeleton (`BR-03`) and source spikes (`BR-05`).

## 3) Branch catalog

### BR-00 `chore/scaffolding-base`
- **Goal**: bootstrap repo conventions and infrastructure files.
- **Allowed**: `Makefile`, `docker-compose*.yml`, `rules/`, `.claude/skills/`, `.gemini/`, `.codex/`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `package.json`, `package-lock.json`, `.github/workflows/`, `README.md`, `LICENSE`, `PLAN.md`, `plan/`.
- **Forbidden**: `api/**`, `ui/**`, `packages/**`, `e2e/**`, `../poc-k8s/**`.
- **Dependencies**: none.
- **Detail**: `plan/00-BRANCH_chore-scaffolding-base.md`.

### BR-01 `feat/spec-evol-scaffolding-design`
- **Goal**: officialize design specs in the repo (SPEC_INTENT, SPEC_EVOL).
- **Allowed**: `docs/spec/`.
- **Dependencies**: BR-00.

### BR-02 `feat/api-skeleton-hono-postgres-s3`
- **Goal**: Hono + Drizzle minimal API; schema §7.3 of SPEC_EVOL; S3 client abstraction; Zod schemas v1.
- **Allowed**: `api/**`, `packages/radar-domain/**`.
- **Dependencies**: BR-01.

### BR-03 `feat/ui-skeleton-svelte-ds`
- **Goal**: Svelte 5 SPA + design system sentropic + chat-ui shell + gh-pages workflow.
- **Allowed**: `ui/**`, `.github/workflows/deploy-gh-pages.yml`.
- **Dependencies**: BR-01.

### CI-FIX `fix/ci-pr-actions-trigger`
- **Goal**: document the correct CI verification path after PR #5 appeared to have no runs/statuses.
- **Allowed**: `rules/workflow.md`, `PLAN.md`, `plan/CIFIX-BRANCH_fix-ci-pr-actions-trigger.md`; `.github/workflows/**` only if root-cause evidence later shows workflow definitions are broken.
- **Dependencies**: BR-03 merge revealed the issue.
- **Root cause**: GitHub Actions did run for PR #5. Connector verification used short SHAs and returned empty results; using the full 40-character head SHA returns the CI and Branch policy PR runs.
- **Validation**: this branch's PR must verify workflow runs with the full 40-character head SHA before merge.

### BR-04 `feat/k8s-tenant-radar-and-infra`
- **Goal**: K8s tenant + S3 bucket creation + maildev + DNS `immo.sent-tech.ca`.
- **Allowed**: `../poc-k8s/tenants/radar-immobilier/**` (cross-repo exception), `docs/spec/SPEC_EVOL_INFRA.md`.
- **Dependencies**: BR-02 (API image to deploy), BR-03 (UI exposure not strictly required but tested).

### BR-05 `feat/source-investigation-spikes`
- **Goal**: spike for every source listed in VISION/PROCESS; deliver `docs/spec/SPEC_EVOL_SOURCE_FEASIBILITY.md` (effort estimates per source).
- **Allowed**: `packages/radar-sources/src/sources/_spikes/**`, `docs/spec/SPEC_EVOL_SOURCE_FEASIBILITY.md`.
- **Dependencies**: BR-01 (parallelizable with BR-02 / BR-03 / BR-04).

### BR-06 `feat/data-model-investigation`
- **Goal**: confront real municipal data; produce `docs/spec/SPEC_EVOL_DATA_MODEL.md` distinguishing universal vs local fields; update Postgres schema and Zod schemas (v2 if needed).
- **Allowed**: `docs/spec/SPEC_EVOL_DATA_MODEL.md`, `packages/radar-domain/src/schemas/**`, `api/drizzle/**` (limited additive migrations).
- **Dependencies**: BR-04 (need API+DB+S3 running to ingest sample docs), BR-05 (spikes inform).

### BR-07 `feat/vertical-slice-avis-publics`
- **Goal**: end-to-end avis publics Valleyfield (scrape with playwright+obscura → S3 → LLM extract → score → opportunity).
- **Allowed**: `api/src/services/**`, `packages/radar-sources/src/sources/avis-publics-valleyfield/**`, `packages/radar-scoring/**`, `api/src/routes/**`, `e2e/**`.
- **Dependencies**: BR-06.

### BR-08 `feat/graphify-radar-integration`
- **Goal**: wrap `graphifyy` in `packages/radar-graph`; index documents and link entities.
- **Allowed**: `packages/radar-graph/**`, integration glue in `api/src/services/`.
- **Dependencies**: BR-07.

### BR-09 `feat/auth-passkey-magic-link`
- **Goal**: port sentropic webauthn + magic-link pattern (server + UI).
- **Allowed**: `api/src/routes/auth/**`, `api/src/routes/api/me.ts`, `ui/src/lib/services/webauthn-client.ts`, `ui/src/routes/auth/**`, `api/drizzle/**` (1 migration: users, credentials, magic_link_tokens).
- **Dependencies**: BR-07 (parallelizable with BR-08 / BR-10).

### BR-10 `feat/carte-interactive`
- **Goal**: MapLibre map in SPA; PostGIS layers (signals, lots, constraints); link card ↔ map.
- **Allowed**: `ui/src/lib/map/**`, `ui/src/routes/(map)/**`, `api/src/routes/map/**`, `api/drizzle/**` (PostGIS indices).
- **Dependencies**: BR-07 (parallelizable with BR-08 / BR-09).

### BR-11 `feat/chat-demo-storyboard`
- **Goal**: chat UI consuming chat-core tools; radar tool catalog; demo dataset; demo script.
- **Allowed**: `ui/src/lib/chat/**`, `api/src/services/tools/**`, `docs/demo/**`.
- **Dependencies**: BR-08, BR-09, BR-10.

### BR-12 `feat/uat-and-pricing-pack`
- **Goal**: `docs/spec/SPEC_EVOL_PRICING_PHASE1.md` (consolidation + estimate); polished demo; `docs/spec/SPEC_SCAFFOLDING.md` (close-out).
- **Allowed**: `docs/spec/SPEC_EVOL_PRICING_PHASE1.md`, `docs/spec/SPEC_SCAFFOLDING.md`, `docs/demo/**`.
- **Dependencies**: BR-11.

## 4) Scope policy (inherited from sentropic `rules/MASTER.md`)

- Every branch declares **Allowed / Forbidden / Conditional Paths** in its `plan/NN-BRANCH_*.md`.
- Scope exceptions require `BRxx-EXn` with rationale + impact + rollback strategy.
- Default forbidden in any branch: `Makefile`, `docker-compose*.yml`, `rules/**`, `plan/NN-BRANCH_*.md` (other branches), `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`.
- Cross-repo work (e.g., `../poc-k8s/`) requires an explicit exception declared in the branch file.

## 5) Scheduling

```
BR-00 ──▶ BR-01 ──┬─▶ BR-02 ──┐
                  ├─▶ BR-03 ──┤
                  └─▶ BR-05 ──┤
                              ├──▶ BR-04 ──▶ BR-06 ──▶ BR-07 ──┬─▶ BR-08 ──┐
                              │                                ├─▶ BR-09 ──┤
                              │                                └─▶ BR-10 ──┤
                              │                                            ├──▶ BR-11 ──▶ BR-12
                              ▼
                        (independent track for spikes
                         informs BR-06 and BR-12)
```

## 6) References

- `docs/spec/input/VISION.md` — client vision (immutable input).
- `docs/spec/input/PROMPT.md` — expert analyst prompt (immutable input).
- `docs/spec/input/PROCESS.md` — operational pipeline (immutable input).
- `docs/spec/SPEC_INTENT_SCAFFOLDING.md` — initial scaffolding request.
- `docs/spec/SPEC_EVOL_SCAFFOLDING.md` — validated scaffolding design (current).
- `../sentropic/rules/MASTER.md` — source of inspiration for our own `rules/MASTER.md`.
- `../poc-k8s/contracts/README.md` — K8s tenant contract.
