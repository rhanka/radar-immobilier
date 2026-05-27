# SPEC_EVOL — ÉV4 T0 Onboarding / Sources — brief

> **Status**: EVOL — évolution ÉV4 (`feat/t0-onboarding-sources`). Default decisions D9–D12 in
> `UAT_EV2_EV7_ESCALATIONS.md`. Parent `SPEC_EVOL_PROCESS_E2E.md` §2 (T0). English code; French UI.

## 1. Goal
The **T0 "Onboarding / Sources"** view: the entry point for a new municipality. It (a) **proposes
the candidate data sources** (selectable checklist), and (b) frames the **initial treatment =
2-year retro-analysis** vs the recurrent daily scan, with a demo **"Lancer l'onboarding"** CTA.

## 2. Scope (default decisions)
- **Catalogue reuse (D9)**: the source list is `sourceEvaluations` from
  `ui/src/lib/source-review/source-evaluation-data.ts` (88 rows, `SourceEvaluation`: name, tier,
  accessMode, costLevel, recommendation, visionAlignment…). No new dataset.
- **Checklist (D9/D12)**: render sources **grouped by `recommendation`** (build-now /
  qualify-access-now / build-later / manual-*), each row a checkbox with name + tier badge +
  access/cost chips + a one-line "what it contributes" (visionAlignment label). All `build-now`
  pre-checked by default.
- **Retro-analysis panel (D10)**: an explanatory block — initial 2-year backfill (window selector,
  default 24 months) with an **illustrative** expected-signal estimate (clearly labelled
  "estimation indicative"), and the recurrent daily-scan cadence. No real forecast math.
- **CTA (D11)**: "Lancer l'onboarding" is a **demo stub** — opens a confirmation summary (count of
  selected sources by tier + chosen window); no ingestion/job is started. A note states this.
- **Wiring (D12)**: new `DemoView "onboarding"`, placed FIRST in NavMenu (T0 → T1 → …).

## 3. Files (indicative)
- `ui/src/lib/onboarding/onboarding-data.ts` (+ test) — pure helpers over `sourceEvaluations`:
  `groupByRecommendation`, `defaultSelection` (build-now ids), `summarize(selectedIds)` (counts by tier),
  `RETRO_WINDOW_MONTHS_DEFAULT = 24`, a French label map for recommendation/visionAlignment.
- `ui/src/lib/components/onboarding/OnboardingView.svelte` — checklist + retro panel + CTA + summary.
- `ui/src/lib/demo/views.ts` — add `"onboarding"`; `NavMenu.svelte` item (first); `App.svelte` branch.

## 4. Acceptance
1. The view lists the source catalogue grouped by recommendation; build-now pre-checked; toggling works.
2. Retro-analysis panel shows the 24-month default window (+ selector) and an explicitly-illustrative estimate; recurrent cadence stated.
3. "Lancer l'onboarding" shows a confirmation summary (selected count by tier + window) — clearly a demo stub, no ingestion.
4. Wired as the first demo view; other views unaffected; gate green (typecheck/lint/test-ui/build).

## 5. Out of scope (later)
Real ingestion/backfill jobs + scheduling (ÉV6 T4 jobs / ÉV7 automation); per-source connector config; persistence of the chosen onboarding set.
