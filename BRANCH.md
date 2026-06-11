# Lot 2b — manifeste de run

Réf : `docs/spec/SPEC_PERSISTENCE_S3_FIRST.md` §1.1 (manifeste), §5 (pipeline).

Branche : `feat/s3-lot2b-run-manifest`. Ajoute le **manifeste de run** (axe
transaction-time / enregistrement de commit du modèle S3-first) et un chemin
« scrape une ville → SCW » testable en mémoire, sans réseau ni Postgres.

Le manifeste est écrit EN DERNIER dans un run : `runs/{source}/{runId}/manifest.jsonl`,
une ligne JSON par doc vu (`{ sha256, sourceUrl, casKey, status: "new"|"seen",
publishedAt? }`). Présence du manifeste ⇒ tout ce qu'il référence (CAS + sidecar)
existe déjà.

## Scope

### Allowed
- `api/src/services/sources/run-manifest.ts`
- `api/src/services/sources/run-manifest.test.ts`
- `api/src/services/sources/recueil.ts`
- `api/src/services/sources/recueil.test.ts`
- `BRANCH.md`

### Forbidden
- `packages/radar-sources/src/sources/proces-verbaux-parser.ts`
- `packages/radar-sources/src/sources/*.fixture.ts`

## Plan

### Lot 2b — manifeste de run
- [x] `run-manifest.ts` : `writeRunManifest(store, { source, runId, entries })` écrit
      `runs/{source}/{runId}/manifest.jsonl` en JSONL (1 objet/ligne, pas un tableau),
      `publishedAt` omis si absent ; helper `manifestKey(source, runId)`.
- [x] `recueil.ts` : `runId?` optionnel dans `RecueilOptions` (défaut dérivé de
      `fetchedAt` → `${fetchedAt.replace(/[:.]/g,"")}-r`), statut `new`/`seen`
      capturé sur le HEAD-skip, exposé via `RecueilSuccess.manifestEntries`
      (extension additive — signature publique inchangée).
- [x] wrapper `runRecueilWithManifest(...)` : sur run réussi, écrit le manifeste
      en dernier ; sur échec, aucun manifeste (run partiel non committé).
- [x] test-first (RED→GREEN) : 1 ligne/doc statut `new` au 1er run ; 2e run
      contenu identique → statut `seen` (HEAD-skip), aucun nouvel objet `raw/cas`.
- [x] gate : `tsc --noEmit` 0 erreur ; `api/src` + `packages/radar-sources`
      1151 verts (7 skipped préexistants), dont 7 nouveaux tests.
