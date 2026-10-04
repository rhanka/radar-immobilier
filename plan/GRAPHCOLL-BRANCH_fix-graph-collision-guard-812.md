# Fix: cross-city graph node id collision guard (GH #812)

## Objective
Step (a) of `docs/spec/reports/dossier-villes-ecart/DOSSIER_DECISION_VILLES_ECART_2026-10-04.md` §6
(owner decision D3(a), 2026-10-04): stop one city from overwriting another city's `graph_nodes`
row on `ON CONFLICT (id)`, report every skipped id, and let `run-job.yaml` run the repair jobs in
preprod first. The structural fix (D2 option C, PK `(city_slug, id)`) is a separate change.

## Scope / Guardrails
- Make-only workflow, `ENV=<env>` last; tests on `ENV=test-gcg812`.
- 0 Python. No cluster, bucket or DB action from this branch; no workflow dispatch.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/graph/graph-store.ts`, `api/src/services/graph/graph-store.test.ts`
  - `api/src/scripts/project-graph-from-s3.ts`, `api/src/scripts/recover-document-dates.ts`
  - `deploy/k8s/32-graph-projection-only-job.yaml`, `deploy/k8s/graph-projection-preprod/job.yaml`
  - `docs/spec/SPEC_EVOL_DOCUMENT_DATES.md`
  - `plan/GRAPHCOLL-BRANCH_fix-graph-collision-guard-812.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths**:
  - `.github/workflows/run-job.yaml` — exception BR812-EX1.

## Feedback Loop
- BR812-EX1 (`.github/workflows/run-job.yaml`): reason — the dossier §6 step (a) requires a
  preprod target for the existing repair jobs and a refresh/backup pre-check for `projection`;
  impact — new `target` input (default `prod`, prod path unchanged except the projection pre-check
  and served-image pin); rollback — revert the commit.
- attention: `document-date-recovery-validate` (Makefile, forbidden here) does not render the new
  preprod projection manifest; a follow-up may extend it.
- attention: the preprod SA has no `pods/log`; the run cannot print the preprod Job log.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Guard**: `setWhere city_slug IS NOT DISTINCT FROM excluded.city_slug` on both node
  upserts; `RETURNING id` → `crossCityCollisions` (id + owner city); structured log
  `graph-store:cross-city-id-collision`; aggregated in projection and recovery reports.
  - [x] Pure test `idsSkippedByCityGuard`; DB-bound tests (same-city update, other city untouched +
    reported, owner no longer refused by the provenance guard, pure upsert, null scope).
- [x] **Lot 2 — run-job target**: `target` prod|preprod, preprod credential + namespace pre-flight,
  preprod projection manifest, projection pre-check, rendered-namespace assertion.
- [x] **Lot 3 — Docs**: `SPEC_EVOL_DOCUMENT_DATES.md` Production run (preprod usage, collisions).
