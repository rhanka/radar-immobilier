# Lot 2c — migration fixtures -> S3

Réf : `docs/spec/SPEC_PERSISTENCE_S3_FIRST.md` §3.

Branche : `feat/s3-lot2c-migrate-fixtures`. Migre les ~50 villes « golden »
(`PV_FIXTURES`) vers l'objet-store CAS **sans réseau** : on encode le `pvText`
(texte extrait pdftotext, pas le PDF original) en bytes `text/plain`, on
construit le `RawDocumentRecord` (`buildRawDocumentRecord`) et on écrit le
`raw/.../cas/<sha>.txt` + son sidecar `.meta.json`. Idempotent (HEAD-skip).

**Honnêteté (anti-invention §0.2)** : la meta étiquette explicitement que c'est
le TEXTE EXTRAIT migré d'une fixture, PAS le PDF source. Le worker live
backfillera le `raw/` PDF original au prochain refresh.

## Scope

### Allowed
- `api/src/services/sources/migrate-fixtures-to-s3.ts`
- `api/src/services/sources/migrate-fixtures-to-s3.test.ts`
- `BRANCH.md`

### Forbidden
- `packages/radar-sources/src/sources/proces-verbaux-parser.ts`
- `packages/radar-sources/src/sources/*.fixture.ts`
- `packages/radar-sources/src/sources/proces-verbaux-generic.ts`
- `api/src/services/sources/pv-seed.ts`

## Plan

### Lot 2c — migration fixtures -> S3
- [x] test-first (RED) : MemoryStore, N fixtures → 2N objets (raw + meta),
      chaque meta parse en `RawDocumentRecord`, `storageKey` en `raw/.../cas/...`
- [x] test-first (RED) : idempotence — 2e appel `migrated=0 skipped=N`, store inchangé
- [x] `migrateFixturesToS3(store, fixtures, { now })` : encode `pvText`, build
      record, put raw + meta honnête (mode « texte extrait »), HEAD-skip
- [x] gate : `npx vitest run api/src/services/sources/` (83) + `npx vitest run api/src` (493) verts
- [x] gate : `npx tsc --noEmit -p api/tsconfig.json` 0 erreur
- [x] gate : `harness verify --category static` + `--category unit` PASS
