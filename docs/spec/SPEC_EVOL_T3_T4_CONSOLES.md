# SPEC_EVOL — ÉV6 T3/T4 consoles — brief

> **Status**: EVOL — évolution ÉV6 (`feat/t3-t4-consoles`). Default decisions D15–D17 in
> `UAT_EV2_EV7_ESCALATIONS.md`. Parent `SPEC_EVOL_PROCESS_E2E.md` §2 (T3/T4). English code; French UI.

## 1. Goal
A **"Console"** operations view with tabs covering **T3 sources console** (qualification + deep-dive)
and **T4 jobs monitoring**. T3 reuses the existing source inventory + source-review components; T4 is a
demo jobs board.

## 2. Scope (default decisions)
- **One DemoView `"console"` with 3 tabs** (D15): "Qualification (T3)", "Approfondissement (T3)", "Jobs (T4)".
- **T3 Qualification** (D16): status board over `sourceEvaluations` (read-only) grouped by `recommendation`
  — counts per group + a table of sources with access/cost chips + a short status. Reuse the `RECOMMENDATION`/
  access/cost label maps already in the repo.
- **T3 Deep-dive** (D16): pick a source → render its detail. Reuse the existing
  `ui/src/lib/components/source-review/SourceDeepDive.svelte` (and/or `RecommendationBoard`) if it plugs in
  with the available data; otherwise a thin local detail panel. Do NOT edit `ui/src/lib/source-review/**`.
- **T4 Jobs** (D17): `ui/src/lib/jobs/jobs-data.ts` — `Job = { id, type: "ingestion"|"scan"|"scoring"|"backfill",
  status: "queued"|"running"|"done"|"failed", sourceRef, startedAt, durationMs?, mode: "real"|"simulation" }`;
  `demoJobs: Job[]` (a realistic spread incl. some simulation rows); pure helper `countsByStatus(jobs)` +
  `filterJobsByMode(jobs, appMode)` (reuse `filterRealMode` from `@radar/scoring` for the real/sim global mode).
  A **JobsBoard** tab: status summary chips (queued/running/done/failed counts) + a jobs table
  (type, source, status badge, startedAt, duration, mode badge). Demo stub — no real orchestration.

## 3. Files (indicative)
- `ui/src/lib/jobs/jobs-data.ts` (+ test), optional `ui/src/lib/console/console-data.ts` (T3 status helper over sourceEvaluations) (+ test).
- `ui/src/lib/components/console/ConsoleView.svelte` (tabs host) + `QualificationTab.svelte` / `DeepDiveTab.svelte` / `JobsTab.svelte`.
- `ui/src/lib/demo/views.ts` (+ `"console"`), `NavMenu.svelte` (item), `App.svelte` (branch).

## 4. Acceptance
1. "Console" view with 3 working tabs (Qualification / Deep-dive / Jobs).
2. T3 Qualification: sources grouped by recommendation with counts + access/cost chips.
3. T3 Deep-dive: a source detail renders (reused component or thin panel).
4. T4 Jobs: status summary + jobs table; respects the global réel/sim toggle (simulation jobs hidden in real mode); clearly a demo stub.
5. Wired as a demo view; other views intact; gate green (typecheck/lint/test-ui/build).

## 5. Out of scope (escalation)
Real job orchestration/scheduler + live source qualification workflow — deferred to a server-side build (D17).
