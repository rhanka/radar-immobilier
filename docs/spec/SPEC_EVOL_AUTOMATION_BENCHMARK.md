# SPEC_EVOL — ÉV7 Automatisation + benchmark — brief

> **Status**: EVOL — évolution ÉV7 (`feat/automation-benchmark`), the LAST of the track. Default
> decisions D18–D20 in `UAT_EV2_EV7_ESCALATIONS.md`. Parent `SPEC_EVOL_PROCESS_E2E.md` §9 (steps 6-7).
> English code; French UI. Type-only imports.

## 1. Goal
An **"Automatisation"** demo view closing the loop: it frames the **continuous treatment cadences**
(initial / recurrent / deepening), lists the **connectors** (stubbed), and gives a **per-stage agent
benchmark recap** (reusing the existing honest 4-track comparison data). Makes PROCESS §9 steps 6-7
tangible — without any real scheduler.

## 2. Scope (default decisions D18–D20)
- **Treatment cadence cards** (D18): three cards — `initial` (rétro-analyse 2 ans, one-shot au
  démarrage — ties to ÉV4 onboarding), `récurrent` (scan quotidien des sources), `approfondissement`
  (à la demande, par opportunité qualifiée). Each card: title, cadence label, one-line description,
  illustrative trigger. Pure data in `ui/src/lib/automation/automation-data.ts`.
- **Connectors list** (D19): a stub list of source/MCP connectors with a `status` (`connecté`(none yet)
  / `à venir` / `manuel`) — clearly "démo, non connecté". No real connection.
- **Benchmark recap** (D20): reuse `ui/src/lib/demo/benchmark-data.ts` (the honest 4-track agent
  comparison) — a compact per-agent/per-stage recap table (no fabricated wins; Fair-Benchmarking rule),
  with a link/pointer to the full "Comparaison des agents" view. Do NOT re-implement the comparison.

## 3. Files (indicative)
- `ui/src/lib/automation/automation-data.ts` (+ test): `TREATMENTS` (3 cadence cards), `CONNECTORS`
  (stub list), and a pure `benchmarkRecap()` deriving a compact recap from `benchmark-data.ts`.
- `ui/src/lib/components/automation/AutomationView.svelte`: the 3 cadence cards + connectors list +
  benchmark recap section. French; legacy Svelte.
- `ui/src/lib/demo/views.ts` (+ `"automatisation"`), `NavMenu.svelte` (item, last), `App.svelte` (branch).

## 4. Acceptance
1. The view shows the 3 treatment cadence cards (initial/récurrent/approfondissement).
2. A connectors list rendered as a clear **stub** (no real connection; "démo" note).
3. A per-stage agent benchmark recap derived from `benchmark-data.ts` (no fabricated values), pointing to the Comparaison view.
4. Wired as the last demo view; other views intact; gate green (typecheck/lint/test-ui/build).

## 5. Out of scope (escalation)
Real automation scheduler + live connectors (MCP/source feeds) + actual recurring runs — deferred to a
server-side build (D19; ties to D11/D17). This view is descriptive/demo only.
