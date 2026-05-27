# SPEC_EVOL — ÉV3 Opportunités T2 (funnel) — brief

> **Status**: EVOL — évolution ÉV3 (`feat/opportunites-t2-funnel`). Builds on ÉV1
> (`@radar/scoring` aggregate + ScoreHover) + ÉV2 (Signaux T1 + Approfondir). Default
> decisions D5–D8 in `UAT_EV2_EV7_ESCALATIONS.md`. Parent `SPEC_EVOL_PROCESS_E2E.md` §2 (T2), §3, §6.
> All new code English; UI French.

## 1. Goal
The T2 **"Opportunités"** view: each dossier shown through the **6-phase progression**
(signal → ancrage → contraintes → marché → contexte → scoring) with **honest scoring** via
`aggregate(d.axes, WEIGHTS)` (score / `partial` / `recommendationCap` / per-axis `ScoreHover`),
a **global réel/sim toggle**, and **signal→N linking** (Approfondir from T1 filters here by
`signalId`). **Supersedes** the legacy `OpportunityFunnel` raw `scoreGlobal` display (D5).

## 2. Scope (default decisions)
- **Supersede `OpportunityFunnel`** (the `"opportunity"` DemoView): rework it (or replace its
  body) to (a) render the 6 phases from `dossier.evidence[]` grouped by `phase`, with provenance
  badges (`verification`: fait/hypothèse/non-disponible/simulé) + confidence; (b) show the
  `aggregate(d.axes, WEIGHTS)` result — score (or "trop mince"), `partial` badge,
  `recommendationCap` (French label), and reuse `ScoreHover` per axis. Drop the raw legacy
  `scoreGlobal` number (keep `recommendation` text). This kills the funnel↔Grilles contradiction.
- **Global réel/sim toggle** (D6): `ui/src/lib/state/mode.ts` — a tiny Svelte store
  `appMode: "real" | "simulation"` (default `"real"`). A switch in the top area toggles it.
  Signaux + Opportunités apply `filterRealMode` when `appMode === "real"`. (Grilles is config,
  unaffected.)
- **signal→N linking** (D7): Opportunités accepts a `selectedSignalId?`; when set, shows only
  dossiers with that `signalId` + a "filtré par signal X · tout afficher" reset. ÉV2's
  Approfondir now passes the signal's id (wire App.svelte to carry it).
- **Timeline** (D8): a compact evidence-date-ordered timeline per dossier (derived from
  `evidence[].date`); no persistent journal (deferred).

## 3. Files (indicative)
- `ui/src/lib/state/mode.ts` (+ test) — global mode store.
- `ui/src/lib/opportunites/funnel.ts` (+ test) — pure helpers: group evidence by phase (ordered),
  derive timeline, filter dossiers by `signalId`, apply mode filter.
- `ui/src/lib/components/opportunity/OpportunityFunnel.svelte` — reworked T2 view (phases +
  aggregate score + ScoreHover + timeline + signalId filter + mode).
- `ui/src/App.svelte` / `NavMenu.svelte` — carry `selectedSignalId` from Approfondir; mount the
  global mode switch.

## 4. Acceptance
1. Opportunités renders the 3 pilots, each with the 6 phases (from `evidence[]`) + provenance badges.
2. Each dossier shows `aggregate(d.axes, WEIGHTS)` score 3.18/3.35/2.59, `partial` badge, cap
   `qualifier-avec-expert`, and per-axis `ScoreHover` — NO raw legacy `scoreGlobal` shown.
3. Global réel/sim toggle flips `appMode`; in "real" mode `filterRealMode` hides simulated
   signals (Signaux view) — the toggle is shared, not per-view.
4. Approfondir on a T1 signal navigates to Opportunités filtered to that `signalId` (1 pilot
   dossier); a reset clears the filter; a simulation/synthetic signal shows the empty state.
5. Gate green (typecheck/lint/test-ui/build); other views unaffected.

## 5. Out of scope (later)
Persistent journal/timeline + SQL (deferred); editing/qualifying actions writing to a real store
(ÉV5/ÉV6); automated ingestion (ÉV4/ÉV7).
