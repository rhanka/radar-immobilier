# Lot 2 (a) — Persistance S3-first : recueil écrit CAS + meta.json

Réf : `docs/spec/SPEC_PERSISTENCE_S3_FIRST.md` §1.1, §8 (lot 2).

Branche : `feat/s3-lot2-recueil-writer`. Le **vrai** builder de clé en usage
(`rawStorageKey` dans `@radar/sources`, via `buildRawDocumentRecord`) mettait la
date de fetch dans la clé → dédup impossible. Migré en CAS + chaque objet raw
gagne un sidecar `meta.json` auto-descriptif.

## Scope

### Allowed
- `packages/radar-sources/src/RawDocument.ts`
- `packages/radar-sources/src/RawDocument.test.ts`
- `api/src/services/sources/recueil.ts`
- `api/src/services/sources/recueil.test.ts`
- `api/src/routes/sources.test.ts`
- `BRANCH.md`

### Forbidden
- `packages/radar-sources/src/sources/*.fixture.ts`
- `packages/radar-sources/src/sources/proces-verbaux-parser.ts`

## Plan

### Lot 2a — recueil CAS + meta.json
- [x] `rawStorageKey` → CAS `raw/{source}/cas/{sha}.{ext}` (sans date) ; `fetchedAt` retiré du calcul de clé ; `rawMetaKey` ajouté
- [x] `runRecueil` écrit le sidecar `meta.json` (RawDocumentRecord) à côté du raw, idempotent (HEAD-skip)
- [x] tests : RawDocument (dédup multi-jours), recueil (raw+meta), assertions route sources migrées en CAS
- [x] gate : typecheck 0, radar-sources 657 + api 486 verts

### Lot 2b (suite) — manifeste de run `runs/{source}/{runId}/manifest.jsonl`
- [ ] (PR suivante)
