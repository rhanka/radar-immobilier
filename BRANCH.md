# Lot 3 — Villes config-only (débloque immo_subagents)

Réf : `docs/spec/SPEC_PERSISTENCE_S3_FIRST.md` §3, §8.

Branche : `feat/s3-lot3-config-only`. Découple config↔fixture : une ville peut
être ajoutée **config-only** (`{ config }` sans `pvText`) ; le worker la fetch
en live → S3. Plus besoin de fixture par ville. immo_subagents authore des
configs, pas du contenu.

## Scope

### Allowed
- `packages/radar-sources/src/sources/proces-verbaux-generic.ts`
- `api/src/services/sources/pv-seed.ts`
- `api/src/services/sources/pv-seed-config-only.test.ts`
- `BRANCH.md`

### Forbidden
- `packages/radar-sources/src/sources/proces-verbaux-parser.ts`
- `packages/radar-sources/src/sources/*.fixture.ts`

## Plan

### Lot 3 — config-only
- [x] `PvCityEntry.pvText` / `.sourceUrl` optionnels (villes config-only)
- [x] `toPvFixtures()` pure : filtre les entrées sans `pvText` ; `PV_FIXTURES = toPvFixtures(ALL_PV_CITIES)` (seed ne casse pas sur config-only)
- [x] test-first : golden gardée, config-only ignorée, jamais de fixture vide
- [x] gate : typecheck 0, api + radar-sources 1145 verts
