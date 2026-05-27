# PLAN — Orchestrated Roadmap `radar-immobilier`

Status: Updated 2026-05-26 — SOCLE `docs/process-e2e-socle` MERGED (PR #17): foundational process-e2e spec (`SPEC_EVOL_PROCESS_E2E.md` v4) + scoring grids + right-sized `@sentropic/h2a`, quadruple-reviewed by agents (Opus 4.7 xhigh + agy Gemini 3.5, v3 then v4, verdict GO). The roadmap is now **replanned around the socle's evolution track ÉV1–ÉV7** (spec §9): the product process build (states model + scoring grids → Radar T1 → Opportunités T2 → T0 onboarding → h2a spike + chat → T3/T4 consoles → automation + per-stage benchmark). BR-06 (data model) + BR-07 (vertical slice) are materialized by 06V (PR #15). BR-05R UAT round-1 copy backlog still open. BR-04 in review (PR #8 + poc-k8s #12). `feat/demo-guided-tour` (24-step tour + radar↔opportunités UX) unmerged.

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
- CONDUCTOR `chore/uat-env-conductor` — merged 2026-05-25 (PR #11, `4e8256b`). Archived at `plan/done/CONDUCTOR-BRANCH_chore-uat-env-conductor.md`.
- FAIRBENCH `chore/fair-benchmark-rule` — merged 2026-05-25 (PR #12). Archived at `plan/done/FAIRBENCH-BRANCH_chore-fair-benchmark-rule.md`.
- DEMOFIND `feat/demo-findings-valleyfield` — merged 2026-05-25 (PR #13). Archived at `plan/done/DEMOFIND-BRANCH_feat-demo-findings-valleyfield.md`.
- 3VIEWS `feat/demo-3-views` — merged 2026-05-25 (PR #14). Archived at `plan/done/3VIEWS-BRANCH_feat-demo-3-views.md`. (Absorbed BR-05R source-review code into main.)
- 06V `feat/vertical-slice-valleyfield` — merged 2026-05-25 (PR #15). Archived at `plan/done/06V-BRANCH_feat-vertical-slice-valleyfield.md`. Real end-to-end slice (3 opps, real sources, "Opportunité" view). Materializes core of BR-06 + BR-07.
- SOCLE `docs/process-e2e-socle` — merged 2026-05-26 (PR #17, `73ffc7b`). Foundational process-e2e spec + scoring grids + h2a right-sizing, agent-reviewed (GO). Drives the ÉV1–ÉV7 evolution track below. (No plan file — brainstorm-spec branch.)

**Active execution:**
- BR-05R `feat/source-value-review-ui` — code absorbed via PR #14; UAT round-1 copy backlog still open (acronyms inline, matrix↔VISION, real insights). Plan: `plan/05R-BRANCH_feat-source-value-review-ui.md`.
- BR-04 `feat/k8s-tenant-radar-and-infra` — in review on radar PR #8 and
  companion k8s-ops PR #12.

**Evolution track — product process e2e (post-SOCLE, ordered).** Replaces the old speculative BR-08→BR-12 demo path; reconciliation in §3.
- **ÉV1** `feat/socle-states-scoring` — states model + scoring grids 0-5 + non-disponible + Grilles view + calibration on the 3 pilots. **Next.**
- **ÉV2** `feat/radar-t1-signals` — signal feed + statuses + value/confidence sort + "Approfondir".
- **ÉV3** `feat/opportunites-t2-funnel` — signal→N opportunities, progressive funnel, opportunity score, global réel/sim toggle, multi-session memory.
- **ÉV4** `feat/t0-onboarding-sources` — source proposal + 2-year retro-analysis (productizes ingestion).
- **ÉV5** `feat/h2a-spike-chat` — `@sentropic/h2a` spike → V1 POLICY + role label + simple journal (decoupled behind an interface); global chat on `@sentropic/flow` (after its spike). Absorbs BR-08 (graphify) + BR-11 (chat-demo).
- **ÉV6** `feat/t3-t4-consoles` — T3 sources console (2 sub-views, absorbs BR-05R) + T4 jobs monitoring.
- **ÉV7** `feat/automation-benchmark` — continuous automation (initial→recurrent) + per-stage agent benchmark.

**Infra branches (parallelizable, plug into the track):**
- BR-09 `feat/auth-passkey-magic-link`
- BR-10 `feat/carte-interactive`
- BR-12 `feat/uat-and-pricing-pack` (close-out: pricing + polished demo).

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

### BR-06 `feat/data-model-investigation` — **MATERIALIZED by 06V (PR #15)**
- **Goal**: confront real municipal data; produce `docs/spec/SPEC_EVOL_DATA_MODEL.md` distinguishing universal vs local fields; update Postgres schema and Zod schemas (v2 if needed).
- **Status**: core delivered by 06V (real data, `SPEC_EVOL_DATA_MODEL.md`, `valleyfield-dossiers.ts`). Formal states model + grids are folded into **ÉV1**.
- **Allowed**: `docs/spec/SPEC_EVOL_DATA_MODEL.md`, `packages/radar-domain/src/schemas/**`, `api/drizzle/**` (limited additive migrations).
- **Dependencies**: BR-04 (need API+DB+S3 running to ingest sample docs), BR-05 (spikes inform).

### BR-07 `feat/vertical-slice-avis-publics` — **MATERIALIZED by 06V (PR #15)**
- **Goal**: end-to-end avis publics Valleyfield (scrape with playwright+obscura → S3 → LLM extract → score → opportunity).
- **Status**: end-to-end slice delivered by 06V (3 opportunities, real sources, "Opportunité" view). Productization continues in ÉV2/ÉV3/ÉV4.
- **Allowed**: `api/src/services/**`, `packages/radar-sources/src/sources/avis-publics-valleyfield/**`, `packages/radar-scoring/**`, `api/src/routes/**`, `e2e/**`.
- **Dependencies**: BR-06.

### BR-08 `feat/graphify-radar-integration` — **ABSORBED by ÉV5**
- **Goal**: wrap `graphifyy` in `packages/radar-graph`; index documents and link entities.
- **Status**: knowledge-graph linking now lives in the ÉV5 chat/coordination evolution.
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

### BR-11 `feat/chat-demo-storyboard` — **ABSORBED by ÉV3/ÉV5**
- **Goal**: chat UI consuming chat-core tools; radar tool catalog; demo dataset; demo script.
- **Status**: storyboard superseded by `feat/demo-guided-tour` (24-step tour, unmerged); chat UI moves to ÉV5 (global chat on `@sentropic/flow`).
- **Allowed**: `ui/src/lib/chat/**`, `api/src/services/tools/**`, `docs/demo/**`.
- **Dependencies**: BR-08, BR-09, BR-10.

### BR-12 `feat/uat-and-pricing-pack`
- **Goal**: `docs/spec/SPEC_EVOL_PRICING_PHASE1.md` (consolidation + estimate); polished demo; `docs/spec/SPEC_SCAFFOLDING.md` (close-out).
- **Allowed**: `docs/spec/SPEC_EVOL_PRICING_PHASE1.md`, `docs/spec/SPEC_SCAFFOLDING.md`, `docs/demo/**`.
- **Dependencies**: ÉV6 (full track demoable).

## 3bis) Evolution track — product process e2e (socle PR #17, spec §9)

Forward roadmap. Each evolution declares its own `plan/ÉVn-BRANCH_*.md` at `branch-init` time (Allowed/Forbidden finalized there). Paths below are indicative. Reference: `docs/spec/SPEC_EVOL_PROCESS_E2E.md`.

### ÉV1 `feat/socle-states-scoring` — foundation (NEXT)
- **Goal**: states model (signal→N opportunities + `confirmed` + `zonePolygonSource` + pré-filtres) + scoring grids 0-5 corrected + non-disponible handling (renormalization + surveillance cap) + Grilles view with hover rationale + **numeric calibration on the 3 real pilots**.
- **Allowed**: `packages/radar-domain/src/schemas/**`, `packages/radar-scoring/**`, `ui/src/lib/components/scoring/**`, `docs/spec/SPEC_EVOL_DATA_MODEL.md`, `docs/superpowers/{specs,plans}/**`.
- **Dependencies**: SOCLE (PR #17), 06V (3 pilots). **Spec**: §3, §4, §10.

### ÉV2 `feat/radar-t1-signals`
- **Goal**: signal feed + qualification statuses + separated value/confidence sort (/10 by type) + "Approfondir" action into T2.
- **Allowed**: `ui/src/lib/components/radar/**`, `api/src/routes/signals/**`.
- **Dependencies**: ÉV1. **Spec**: §2 (T1), §4 (tri).

### ÉV3 `feat/opportunites-t2-funnel`
- **Goal**: signal→N opportunities, 6-phase progressive funnel (auto/human tags), opportunity score 0-5, **global réel/simulé toggle**, multi-session memory.
- **Allowed**: `ui/src/lib/components/opportunity/**`, `api/src/routes/opportunities/**`, `packages/radar-domain/src/schemas/**`.
- **Dependencies**: ÉV1, ÉV2. **Spec**: §2 (T2), §3, §6.

### ÉV4 `feat/t0-onboarding-sources`
- **Goal**: T0 onboarding — source proposal + 2-year retro-analysis; productizes ingestion (initial treatment).
- **Allowed**: `ui/src/lib/components/onboarding/**`, `api/src/routes/sources/**`, `packages/radar-sources/**`.
- **Dependencies**: ÉV3. **Spec**: §2 (T0), §3.

### ÉV5 `feat/h2a-spike-chat` — absorbs BR-08 + BR-11
- **Goal**: spike `@sentropic/h2a` (runtime compat, surface) → V1 = `POLICY` anti-cheat + role label + simple append-only journal, **decoupled behind an interface**; global chat on `@sentropic/flow` (after its spike); graphify entity linking. Crypto signing = deferred technical report; modes/ABC/B2B2C = business hypothesis (`SPEC_EVOL_OPERATING_MODEL.md`).
- **Allowed**: `packages/radar-coordination/**`, `packages/radar-graph/**`, `ui/src/lib/chat/**`, integration glue in `api/src/services/`.
- **Dependencies**: ÉV3 (memory/journal). **Spec**: §5, §6, §11.

### ÉV6 `feat/t3-t4-consoles` — absorbs BR-05R
- **Goal**: T3 sources console (2 sub-views: qualification + deepening, absorbs BR-05R UAT backlog) + T4 jobs monitoring.
- **Allowed**: `ui/src/lib/components/console/**`, `api/src/routes/jobs/**`, `api/src/routes/sources/**`.
- **Dependencies**: ÉV4, ÉV5. **Spec**: §2 (T3/T4), §9.

### ÉV7 `feat/automation-benchmark`
- **Goal**: continuous automation (initial→recurrent→deepening treatments) + per-stage agent benchmark (Fair Benchmarking rule).
- **Allowed**: `api/src/services/scheduler/**`, `packages/radar-scoring/**`, `docs/spec/**`.
- **Dependencies**: ÉV6. **Spec**: §9 (steps 6-7).

## 4) Scope policy (inherited from sentropic `rules/MASTER.md`)

- Every branch declares **Allowed / Forbidden / Conditional Paths** in its `plan/NN-BRANCH_*.md`.
- Scope exceptions require `BRxx-EXn` with rationale + impact + rollback strategy.
- Default forbidden in any branch: `Makefile`, `docker-compose*.yml`, `rules/**`, `plan/NN-BRANCH_*.md` (other branches), `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`.
- Cross-repo work (e.g., `../poc-k8s/`) requires an explicit exception declared in the branch file.

## 5) Scheduling

**Done (foundation):**
```
BR-00 ─▶ BR-01 ─┬─▶ BR-02 ─┐
                ├─▶ BR-03 ─┤
                └─▶ BR-05 ─┤
                           ├─▶ BR-04(review) ─▶ 06V ─▶ SOCLE(PR#17)
                           ▼
                     (spikes inform 06V + ÉV1)
```

**Evolution track (post-SOCLE):**
```
SOCLE ─▶ ÉV1 ─▶ ÉV2 ─▶ ÉV3 ─┬─▶ ÉV4 ─▶ ÉV6 ─▶ ÉV7 ─▶ BR-12
                            └─▶ ÉV5 ─────────┘
        BR-09 (auth) ┐
        BR-10 (carte)┴─ parallelizable, plug into ÉV3+ when needed
```

## 6) References

- `docs/spec/input/VISION.md` — client vision (immutable input).
- `docs/spec/input/PROMPT.md` — expert analyst prompt (immutable input).
- `docs/spec/input/PROCESS.md` — operational pipeline (immutable input).
- `docs/spec/SPEC_INTENT_SCAFFOLDING.md` — initial scaffolding request.
- `docs/spec/SPEC_EVOL_SCAFFOLDING.md` — validated scaffolding design (current).
- `../sentropic/rules/MASTER.md` — source of inspiration for our own `rules/MASTER.md`.
- `../poc-k8s/contracts/README.md` — K8s tenant contract.
