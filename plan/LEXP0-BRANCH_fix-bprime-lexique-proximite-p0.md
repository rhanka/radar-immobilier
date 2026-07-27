# LEXP0 — fix/bprime-lexique-proximite-p0

## Objective

Correct the three defects established by the divergent double consensus while preserving the validated lexical fixes. The owner removed the proximity-window change because it only introduces unilateral `oui → indetermine` risk.

## Corrections (dans l'ordre)

- [x] **Garde completeReform** — prevents axis `r` from branching on `completeReform`.
- [x] **Remove proximity window** — restores adjacent `refonte|revision complete` matching; owner decision.
- [x] **Normalize apostrophes** — make all four production folds byte-identical for ASCII U+0027 and typographic U+2019.
- [x] **Reorder instrumentFromSignal** — `refonte` remains before `ppcmoi`.
- [x] **C2 plurals** — retain the nine plural residential markers.
- [x] **Re-review correction #2** — text-only `refonte` is limited to regulatory/zoning reforms; the Terrasse-Vaudreuil PIIA remains `piia`, while Sutton remains `refonte`. The fifth UI fold and the sixth municipal-name fold normalize ASCII U+0027 and U+2019.
- [x] **Apostrophe normalization impact accepted** — the production replay measured 50 `autre` → `plan_urbanisme` reclassifications; strict B remains 174 / 327. Cards change from “Instrument à préciser” to “Plan d'urbanisme” and their instrument sort key moves from 6 to 5, so they can rise only after the preceding ranking keys are tied.
- [x] **Clean static gates** — `make install`, `make typecheck` (0 errors, 7 pre-existing Svelte warnings), and `make lint` exit 0 on `ENV=test-lexfix2` with dedicated ports.
- [ ] **Stack and production replay** — rerun the API regressions, 724 × 8 parity, named corpus invariants, and the production trajectory in a serial clean stack.

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
- `ui/src/lib/signals/vivier-b-display-filter.ts` (LEXP0-EX1: closes the fifth apostrophe fold; UI display-only impact; rollback is the two-file local diff)
- `ui/src/lib/signals/vivier-b-display-filter.test.ts` (LEXP0-EX1: paired ASCII/U+2019 regression proof for the display fold)
- `radar/data-prep/fetch-municipal-polygons.ts` (LEXP0-EX2: closes the repository scan's sixth apostrophe fold; municipal-slug normalization only; rollback is the one-line local diff)
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
