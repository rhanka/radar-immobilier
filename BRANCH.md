# Lot 1 — Persistance S3-first : geler l'anti-pattern + 2 bugs

Réf : `docs/spec/SPEC_PERSISTENCE_S3_FIRST.md` §1, §7 (bugs #1, #2), §8 (lot 1).

Branche : `feat/s3-lot1-cas-shard`. Objectif : corriger les 2 bugs de fondation
avant d'écrire le premier vrai objet sur SCW S3 — aucune logique métier nouvelle.

## Scope

### Allowed
- `api/src/storage/object-store.ts`
- `api/src/storage/s3-object-store.ts`
- `api/src/storage/object-store.test.ts`
- `api/src/services/scrape-status/store.ts`
- `api/src/services/scrape-status/store.test.ts`
- `api/src/routes/scrape-status.ts`
- `api/src/routes/scrape-status.test.ts`
- `api/src/services/scrape-status/derive.test.ts`
- `BRANCH.md`

### Forbidden
- `packages/radar-sources/src/sources/*.fixture.ts`
- `packages/radar-sources/src/sources/proces-verbaux-parser.ts`
- `packages/radar-sources/src/sources/proces-verbaux-generic.ts`

## Plan

### Lot 1 — CAS + sharding
- [x] `rawObjectKey` → `casObjectKey`/`casMetaKey` (CAS pur `raw/{city}/{source}/cas/{sha}.{ext}`, sans date) ; suppression de `rawObjectKey` (0 appelant)
- [x] `ObjectStore.list(prefix)` (port optionnel) + implémentation S3 `ListObjectsV2` paginée
- [x] `scrape-status` shardé `state/{city}/{source}.json` (un écrivain/clé) — fin du read-modify-write global
- [x] appelants ajustés (`routes/scrape-status` ré-agrège via `readAll`) + mocks de test dotés de `list`
- [x] gate : typecheck 0, unit verts
