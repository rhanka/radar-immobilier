# LEXP0 — fix/bprime-lexique-proximite-p0

## Objective

Correct the three defects established by the divergent double consensus while preserving the validated lexical fixes. The owner removed the proximity-window change because it only introduces unilateral `oui → indetermine` risk.

## Corrections (dans l'ordre)

- [x] **Garde completeReform** — prevents axis `r` from branching on `completeReform`.
- [x] **Remove proximity window** — restores adjacent `refonte|revision complete` matching; owner decision.
- [x] **Normalize apostrophes** — make all four production folds byte-identical for ASCII U+0027 and typographic U+2019.
- [x] **Reorder instrumentFromSignal** — `refonte` remains before `ppcmoi`.
- [x] **C2 plurals** — retain the nine plural residential markers.
- [x] **Verification** — production replay 7,221 nodes / 724 cities: strict B 174 / 327; Steve 10/10; Rosemère 0/11; parity 0 across 724 × 8; golden A 9 API + 25 UI; lint 0. Repository-baseline typecheck remains blocked outside this lot (SignalPdfOverlay + immo-mcp deps).

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
- ENV=test-lexfix + dedicated ports (never 5301/8801/1101)
- Pas de push, pas de merge
