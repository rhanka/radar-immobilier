# Rapport Muse — Ouverture L3 : page publiée qui lit les paniers

## Résultat

L3 est livré dans le workspace `tmp/artefacts-ouv-l3` (branche `feat/artefacts-ouverture-l3`).
La page publiée sert un vrai ensemble HTML/CSS/JS de la release épinglée et appelle
trois lectures paniers du lecteur courant via H5. Les corrections 1, 2 et 3 de la
relecture Astra sont intégrées. Aucun commit effectué. Aucun shell ni test lancé.
Aucun fichier hors workspace modifié.

### CSP, sous-ressources et appel H5 (correction 1)

- `api/src/artifacts/content-isolation.ts` : CSP étendue aux fichiers de la
  release tout en conservant l'isolation :
  `script-src 'self'` + hash de l'exemple, `style-src 'self'`,
  `img-src 'self' data:`, `connect-src 'self'`, `worker-src 'none'`,
  `frame-ancestors 'none'`, `object-src 'none'`. Autres headers inchangés.
- `api/src/artifacts/release-files.ts` (nouveau) : seam `ReleaseFileProvider`
  (`getFile`), implémentation mémoire pour les preuves, `normalizeReleasePath`
  (blocage `..`), `contentTypeForPath`, `injectGrantIntoHtml` (les `src`/`href`
  relatifs de la page portent `?grant=...`, les URL absolues, `data:`, ancres et
  `/__reader/` restent intactes), constante `RELEASE_CSP`.
  Mécanisme JS publié → H5 (documenté dans l'en-tête du module) :
  lecture du `grant` dans l'URL, `fetch` vers `/__reader/api/...` avec
  l'en-tête `x-preview-grant`, puis `history.replaceState`.
- `api/src/artifacts/content-serve.ts` :
  - Nouveaux chemins `/__reader/api/baskets.*` (capacité `signals.protected-read`,
    coercition `limit`/`reveal`, erreurs `ClassificationError` mappées par
    `classificationFailure` : 400/403/409 ; autres erreurs → 503).
  - Nouveau `POST /__reader/renew` (grant présenté + cookie session, revalidation
    autorité, nouveau grant ou 401).
  - Nouveau service de fichiers : `GET *` résout `(artifactId, releaseId)` du
    grant (onglet ancien → release épinglée, pas de fuite de release récente),
    sert via `releaseFiles`, refuse les corps avec marqueurs de credentials
    (404), réécrit le HTML avec le grant, sinon repli sur l'exemple pour
    `/` et `/index.html` (compatibilité des tests existants).

### Trousseau de signature des curseurs (correction 2)

- `api/src/artifacts/reader-cursor-keyring.ts` (nouveau) : chargement de
  `classification.cursorKeyring` depuis l'environnement, persistant entre
  instances et après redémarrage. Secret de 32 octets minimum (base64, base64url
  ou hex), identifiant `[A-Za-z0-9_-]{1,64}`. Configuration absente ou invalide
  → `undefined` (fermé : les recherches restent en `transport_unavailable` au
  lieu de signer avec une clé éphémère).

### Raccordement API

- `api/src/index.ts` : construction de `readerContent` (`createReaderContentApp`
  + `createBasketReadOperation` + `resolveReaderCursorKeyring`) et passage à
  `createApp`. L'autorité durable (releases/ACL, candidat A6) et le fournisseur
  durable de fichiers (PG/S3, activation `@sentropic/artifacts`) restent des
  points d'extension explicites, à `undefined` (fermé par défaut, jamais de
  fixture en production). Aucune intégration de `@sentropic/artifacts 0.2.3`.
- Fichiers non touchés : `packages/artifacts-host/src/{activation,admission,commit-policy,facade}.ts`,
  `packages/immo-mcp`.

## Runtime choisi

Montage dans l'API (même processus, même DB et même object store), recommandé
pour sa simplicité : le pont paniers a besoin de `db`, `store` et du trousseau,
disponibles dans `api/src/index.ts` sans nouveau déploiement ni réseau
interne. Le listener standalone `content-reader-server.ts` reste fixture-only
(sans DB) et n'est pas le chemin L3. Dépendances du montage : DB PostgreSQL
(lectures paniers), object store S3 (cartes de classification), secrets H5 et
trousseau (voir variables). Le routage `contentGate` précède l'auth applicative ;
`/api/*`, workers et `/embed` restent refusés sur les hôtes de contenu.

## Variables (noms uniquement, aucune valeur)

- `ARTIFACTS_CONTENT_BASE`
- `ARTIFACTS_READER_GRANT_SECRET`
- `ARTIFACTS_READER_SESSION_SECRET`
- `ARTIFACTS_READER_ISSUER`
- `ARTIFACTS_READER_AUDIENCE`
- `ARTIFACTS_READER_TIER`
- `CLASSIFICATION_CURSOR_SECRET`
- `CLASSIFICATION_CURSOR_KEY_ID`

## Tests (non lancés, à lancer par l'agent de test)

Conventions : anglais, vitest, layout `api/src/artifacts/*.test.ts`.

- `reader-operations-baskets.test.ts` : les trois opérations existent, `workspaceId`
  explicite requis, UUID invalide refusé.
- `reader-responses-baskets.test.ts` : les trois contrats existants acceptés,
  corps malformés ou avec champs d'autorité refusés.
- `reader-baskets.test.ts` : propagation du `readerSub` vérifié, paniers distincts
  par lecteur, workspace étranger/révoqué/vide refusé (`workspace_not_authorized`),
  réponse d'un autre workspace refusée.
- `release-files.test.ts` : normalisation et blocage traversal, types de contenu
  du set publié, isolation par `(artifactId, releaseId)`, injection du grant sur
  sous-ressources relatives uniquement, CSP avec `self` + hash exemple + `none`.
- `reader-cursor-keyring.test.ts` : chargement depuis l'environnement, fermé si
  absent, première page puis continuation après redémarrage avec le même secret,
  refus avec un autre secret.
- `content-serve-baskets.test.ts` (acceptation) : un vrai set HTML/CSS/JS publié
  est servi (HTML réécrit avec grant, JS/CSS avec bons types, CSP `self`) et son
  appel `baskets.search.v1` via `x-preview-grant` réussit ; deux lecteurs voient
  leurs paniers respectifs ; workspace étranger refusé en 403.

Commandes à lancer (depuis la racine du dépôt) :

- `npx vitest run api/src/artifacts/reader-operations-baskets.test.ts`
- `npx vitest run api/src/artifacts/reader-responses-baskets.test.ts`
- `npx vitest run api/src/artifacts/reader-baskets.test.ts`
- `npx vitest run api/src/artifacts/release-files.test.ts`
- `npx vitest run api/src/artifacts/reader-cursor-keyring.test.ts`
- `npx vitest run api/src/artifacts/content-serve-baskets.test.ts`
- Puis suites voisines : `npx vitest run api/src/artifacts/content-serve.test.ts api/src/artifacts/reader-operations.test.ts api/src/artifacts/reader-responses.test.ts api/src/artifacts/content-isolation.test.ts`
- `npx tsc --noEmit -p api/tsconfig.json`

## Découpage en commits proposés (≤150 lignes, titres anglais ≤72 chars, sans corps ni trailer)

1. `feat(reader): add basket operations to reader API`
   (`reader-operations.ts`, `reader-operations-baskets.test.ts`)
2. `feat(reader): validate basket responses with existing contracts`
   (`reader-responses.ts`, `reader-responses-baskets.test.ts`)
3. `feat(reader): bridge H5 reader to basket services`
   (`reader-baskets.ts`, `reader-baskets.test.ts`)
4. `feat(reader): load persistent cursor keyring from env`
   (`reader-cursor-keyring.ts`, `reader-cursor-keyring.test.ts`)
5. `feat(reader): serve pinned release files with grant rewrite`
   (`release-files.ts`, `release-files.test.ts`)
6. `feat(reader): allow release sub-resources in content CSP`
   (`content-isolation.ts`)
7. `feat(reader): serve releases and basket reads with renewal`
   (`content-serve.ts`)
8. `feat(api): mount basket reader content in API`
   (`index.ts`)
9. `test(reader): cover published basket page acceptance`
   (`content-serve-baskets.test.ts`)
10. `docs(l3): add published basket page report`
    (`RAPPORT-MUSE-OUV-L3.md`)

## Points d'extension laissés ouverts

- Autorité durable (releases/profils/ACL par artefact) : brancher une
  implémentation `AuthorityReader` adossée au stock hôte une fois le candidat A6
  réceptionné, à la place de `authority: undefined` dans `api/src/index.ts`.
- Fichiers durables (PG/S3) : implémenter `ReleaseFileProvider` contre le stockage
  hôte et l'injecter comme `releaseFiles`, après qualification de l'activation
  `@sentropic/artifacts` (0.2.3 non intégré ici).
- Révocation partagée et tickets multi-processus : brancher le store A6 dès
  réception, sans changer les routes ci-dessus.
