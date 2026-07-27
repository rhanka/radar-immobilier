# LEXP0 — fix/bprime-lexique-proximite-p0

## Objective

Correct the three defects established by the divergent double consensus while preserving the validated lexical fixes. The owner removed the proximity-window change because it only introduces unilateral `oui → indetermine` risk.

## Corrections (dans l'ordre)

- [x] **Garde completeReform** — prevents axis `r` from branching on `completeReform`.
- [x] **Remove proximity window** — restores adjacent `refonte|revision complete` matching; owner decision.
- [x] **Normalize apostrophes** — make all four production folds byte-identical for ASCII U+0027 and typographic U+2019.
- [x] **Reorder instrumentFromSignal** — `refonte` remains before `ppcmoi`.
- [x] **C2 plurals** — retain the nine plural residential markers.
- [x] **Re-review correction #2 (superseded)** — its positive regulatory/zoning wording gate kept the Terrasse-Vaudreuil PIIA out of `refonte`, but caused a recall regression. Correction #3 deliberately replaces that gate. The fifth UI fold and the sixth municipal-name fold normalize ASCII U+0027 and U+2019.
- [x] **Apostrophe normalization impact accepted** — the production replay measured 50 `autre` → `plan_urbanisme` reclassifications; strict B remains 174 / 327. Cards change from “Instrument à préciser” to “Plan d'urbanisme” and their instrument sort key moves from 6 to 5, so they can rise only after the preceding ranking keys are tied.
- [x] **Re-review correction #3** — invert the free-text `refonte` rule: it remains the default and excludes only the two non-regulatory corpus forms, `refonte architecturale` (Terrasse-Vaudreuil) and `refonte des services souterrains` (Lac-Frontière). The 15 regulatory reforms removed by the positive wording gate are regression-tested from their production IDs.
- [x] **Undeclared instrument transitions measured** — the prior positive gate also caused four `refonte` → `plan_urbanisme` transitions (Dupuy, Gracefield, Vaudreuil-sur-le-Lac, Saint-Polycarpe). This degrades the `r` axis because an indeterminate residential signal is eligible there only for `rezonage` or `refonte`; all four are restored to `refonte`. Final counts are `plan_urbanisme=50`, `refonte=24`.
- [x] **MCP city slug apostrophe fold** — `citySlug` now removes both U+0027 and U+2019 before delimiter folding, with paired `L'Ange-Gardien` / `L’Ange-Gardien` coverage.
- [x] **Clean static gates** — `make install`, `make typecheck` (0 errors, 7 pre-existing Svelte warnings), and `make lint` exit 0 on `ENV=test-lexfix3` with dedicated ports.
- [x] **Frozen-production replay** — on 7,221 rows / 724 cities (SHA-256 unchanged), the result is `174 / 327`, `0 / 5,792` parity disagreements, `0 / 11` Rosemère strict signals, unchanged Golden-A IDs, the 10 named Steve-city counts, and `0` of main's 308 strict IDs lost (19 added).

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
- `packages/immo-mcp/src/raw-data.ts` (LEXP0-EX3: closes the seventh apostrophe fold in raw-data collection IDs; rollback is the one-line local diff)
- `packages/immo-mcp/src/raw-data.test.ts` (LEXP0-EX3: paired ASCII/U+2019 city-slug regression proof)
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
