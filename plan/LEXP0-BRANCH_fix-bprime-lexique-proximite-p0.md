# LEXP0 — fix/bprime-lexique-proximite-p0

## Objectif

Corriger 4 bugs lexicaux mesurés par l'audit NLP (docs/reports/audit/AUDIT_METHODES_CLASSIFICATION_LEXICALE.md).
Trajectoire villes vue B : 170 → 171 → 173, rappel Steve ≥6/10 = 10/10 à chaque étape.

## Corrections (dans l'ordre)

1. **Garde completeReform** — test empêchant de brancher l'axe `r` sur `completeReform`
2. **Fenêtre de proximité** — `completeReform` passe d'adjacence à ≤30 car. + synonymes
3. **Réordonnancement instrumentFromSignal** — `refonte` avant `ppcmoi`
4. **C2 pluriels + apostrophe** — `s?` sur 9 termes + normalisation `'`/`'` → espace

## Allowed paths

- `packages/radar-domain/src/signals/b-prime.ts`
- `packages/radar-domain/src/signals/b-prime.test.ts`
- `api/src/services/graph/vivier-v2.ts`
- `api/src/services/graph/vivier-v2.test.ts`
- `api/src/services/graph/graph-store.ts` (UNIQUEMENT `foldText`, `RESIDENTIEL_MARKERS_RE`, `classifyResidentielPertinence`)
- `api/src/services/graph/bprime-recette.test.ts`
- `api/src/services/graph/bprime-recette.fixture.ts` (si besoin)
- `ui/src/lib/signals/graph-signal-filter.ts`
- `ui/src/lib/signals/graph-signal-filter.test.ts`
- `plan/LEXP0-BRANCH_fix-bprime-lexique-proximite-p0.md`

## Forbidden paths (INTOUCHABLES)

- `ZONAGE_CATEGORIES` / `isMulti4Plus` / `deriveEtape` (graph-store.ts) / `isPrecoceSignal`
- `api/src/services/graph/legacy-filter-a-golden.test.ts`
- Tout fichier de l'axe A legacy (z|m|p)
- `graph-store.ts:deriveEtape` inline normalization

## Contraintes

- Golden A byte-invariant
- Rosemère ne revient PAS dans B
- Steve 10/10 conservé à chaque étape
- Commits atomiques ≤150 lignes via `make commit`
- ENV=test-lexp0 + ports dédiés (jamais 5301/8801/1101)
- Pas de push, pas de merge
