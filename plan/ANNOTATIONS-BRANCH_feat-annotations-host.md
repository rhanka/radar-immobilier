# Feature: Immo annotations host

## Objective
- [ ] Implement the immo host against M1 and remove active legacy annotation code.

## Scope / Guardrails
- [x] Isolated worktree `tmp/annotations-host`, branch `feat/annotations-host`.
- [x] Make-only, Docker-first; `ENV` last; no real imports or root UAT mutation.
- [x] Shared model and storage remain Sentropic/cluster-mesh responsibilities.
- [x] No copy of deleted notes; existing backups expire unchanged.
- [x] Tests use `test-annotations-host`; optional browser `e2e-annotations-host`.
- [x] Ports: API 8897, UI 5397, mail UI 1197, PG 5597, S3 9197, Obscura 9297, SMTP 1097.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `api/src/services/annotations/**`, `api/src/routes/annotations*`, `api/src/app.ts`, `api/annotations-host.mk`.
- [x] Allowed Paths: `api/src/db/{schema,migrate}.ts`, `api/src/db/scripts/backfill-0009-tracking.ts`, `api/src/services/prospect/marks-service.ts`, `api/src/routes/prospect-marks*`.
- [x] Allowed Paths: `api/tests/**`, `api/drizzle/0014_annotations_host.sql`, `api/drizzle/meta/_journal.json`.
- [x] Allowed Paths: `packages/radar-domain/src/**`, `packages/immo-mcp/{src/auth-context.ts,README.md}`.
- [x] Allowed Paths: legacy `ui/src/lib/collab/**`, `ui/src/lib/components/collab/**`, prospect client and tests, lot/signal panels and tests, `ui/e2e-qa/**`.
- [x] Allowed Paths: `api/package.json`, `package-lock.json`, `vendor/comments-m1/**`, `docs/spec/SPEC_EVOL_ANNOTATIONS_HOST.md`, this plan.
- [x] Forbidden Paths: `Makefile`, `docker-compose*.yml`, `rules/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, other branch plans, other repositories.
- [x] Conditional Paths: deployment/restore/docs prescriptions only after an evidenced blocking need.
- [x] Exceptions require rationale, impact and rollback in Feedback Loop.

## Feedback Loop
- [x] ANNOTATIONS-D1: latest owner decision accepts M1 without waiting for formal freeze; cluster-mesh owns storage/API.
- [x] ANNOTATIONS-D2: M1 declares but does not deliver M2/M3 runtime; synthetic seams never enable a production fallback.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; sequential writes; independent design reviewers read only.

## UAT Management (in orchestration context)
- [x] Root UAT remains unchanged; operational adoption requires integrated module qualification.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read rules, reference specs, owner decisions and exact M1 surfaces.
- [ ] Lot 1 — Reconcile independent design reviews and pin the shared contract.
- [ ] Lot 2 — Implement explicit host membership, capabilities and resource resolver.
- [ ] Lot 3 — Compose the canonical module and prepare synthetic Steve units.
- [ ] Lot 4 — Remove legacy domain/API/UI/MCP consumers and adapt retained tests.
- [ ] Lot 5 — Guard migration/retirement and document operational eradication.
- [ ] Lot 6 — Run scoped tests, static checks, build and independent review.
- [ ] Lot 7 — Commit selective atomic changes and provide evidence plus bounded M2/M3 handoff.
