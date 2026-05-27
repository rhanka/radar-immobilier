# UAT ÉV1–ÉV7 — default decisions & escalations log

> Autonomous drumbeat (ÉV2→ÉV7). Genuine design choices were taken with a **sensible
> default** to keep moving; the risky/uncertain ones are listed here for an **intermediate
> UAT review**. Nothing here blocks the build — it's the agenda for the human pass.
> This file is carried + appended on each évolution branch and merged with it.

## Process defaults (apply to all ÉV2–ÉV7)
- **Reviews**: per-task spec + code-quality subagent reviews are the gate. External
  opus/agy/codex spec reviews are reserved for foundational specs (socle, ÉV1) — skipped here.
- **Merges**: merge to `main` per évolution (or per coherent sub-part) once the gate is green.
- **Demo data**: each new view is seeded from the 3 real pilots + minimal synthetic rows
  where a feed/funnel needs volume; synthetic rows are flagged `mode: "simulation"` (or
  evidence `verification: "simulé"`) so the real/sim boundary stays honest.
- **No new external deps** without logging here first.

## Escalations / default decisions to confirm at UAT

### ÉV2 — Radar T1 (signals feed)
- **D1** New dedicated **"Signaux (T1)"** demo view rather than reworking the existing "radar"
  demo view (keeps the merged demo intact). → confirm whether the legacy "radar" view should
  later be folded into / replaced by this one.
- **D2** Value and confidence shown as **two separate sortable columns** (never multiplied,
  per spec §4.2). Default sort = by value desc.
- **D3** **"Approfondir"** sets the signal status to `à-approfondir` (in-memory journal, no
  persistence — ÉV3) and deep-links to the **Grilles** view. Full signal→specific-dossiers
  filtering is deferred to ÉV3 (the funnel) — for now Grilles shows all pilot dossiers.
- **D4** Demo signals = **one real `Signal` per pilot** (`sig-h609-4`/`sig-u521-h521`/`sig-h143`,
  type `residential-rezoning`/`cptaq`-mix, value from `SIGNAL_TYPE_VALUES`) **+ 2-3 synthetic
  signals** flagged `mode: "simulation"` to populate the feed and exercise the real/sim filter.

### ÉV3 — Opportunités T2
- **D5** **Supersede** the existing `OpportunityFunnel` (the `"opportunity"` demo view) rather
  than add a 7th view: rework that view to render the dossier through the 6 phases AND show the
  `aggregate(d.axes, WEIGHTS)` honest score (partial/cap/ScoreHover). This resolves the legacy
  `scoreGlobal` contradiction (final-review follow-up) in one move. → confirm at UAT we're happy
  dropping the old raw `scoreGlobal` display.
- **D6** **Global réel/sim toggle** lives in a shared store (`ui/src/lib/state/mode.ts`) + a
  switch in the top bar/NavMenu; views (Signaux, Opportunités) read it and apply `filterRealMode`.
  Default = "réel" (simulations hidden) so the demo opens honest; toggling shows simulated rows.
- **D7** **signal→N linking**: Approfondir (from Signaux) navigates to Opportunités with a
  `selectedSignalId` filter; the view shows the dossiers whose `signalId` matches (1 per pilot
  today). Synthetic/simulation signals → "aucun dossier qualifié pour l'instant".
- **D8** **6-phase funnel** rendered from the existing `evidence[]` phases
  (signal→ancrage→contraintes→marché→contexte→scoring) with per-item provenance badges
  (fait/hypothèse/non-disponible/simulé). **Multi-session memory/timeline**: rendered as an
  evidence-date-ordered timeline (no persistent journal — DB deferred to the ÉV3 migration or later);
  log if a real timeline field is needed.

### ÉV4 — T0 onboarding
- **D9** The onboarding **source catalogue reuses `ui/src/lib/source-review/sourceEvaluations`**
  (88-row inventory, tiers/access/cost/recommendation) rather than a new dataset — single source
  of truth. Presented as a **selectable onboarding checklist** grouped by recommendation
  (build-now / qualify-access-now / build-later / manual). → confirm grouping at UAT.
- **D10** **Initial vs recurrent treatment** = explanatory panel: initial = **2-year retro-analysis**
  (backfill window default 24 months + illustrative expected-signal estimate); recurrent = daily scan.
  Numbers are **illustrative defaults**, flagged in-UI (not a forecast).
- **D11** **"Lancer l'onboarding" CTA is a demo stub** (no real ingestion/job) — shows a confirmation
  summary of selected sources + window. Real ingestion/job orchestration is ÉV6/ÉV7. Main ÉV4 escalation.
- **D12** New `DemoView "onboarding"`, placed FIRST in the nav (T0 precedes T1). Default = all
  `build-now` sources pre-checked.

### ÉV5 — h2a spike + chat
- **SPIKE RESULT**: `@sentropic/h2a` (npm **0.8.0**, source `../a2a-cli/packages/h2a`) and
  `@sentropic/flow` (**0.1.1**) exist and are installable. BUT h2a is **Node-oriented** (ed25519
  signing, append-only journal, key handling) — not a clean browser/SPA dependency, and socle §11
  explicitly **defers crypto for V1**. So a hard dependency in the demo UI is not warranted now.
- **D13 (default, per socle §11)** ÉV5 V1 = a **decoupled coordination interface** in the UI that
  mirrors h2a's *concepts* without the dep: `Role` (PRINCIPAL = human, CONDUCTOR/AGENT = AI), a
  `POLICY` (anti-cheat / disclaimer summary), and a **simple in-memory append-only journal** of
  decisions (no crypto, no persistence). Modeled so a real `@sentropic/h2a` adapter can slot behind
  the interface later (server-side).
- **ESCALATION (ÉV5 → UAT)**: real `@sentropic/h2a`/`@sentropic/flow` integration (signed
  ENGAGEMENT/MANDATE artifacts, ed25519, persistent journal) is **deferred** — it needs a
  **server-side coordination service**, not the browser demo. Confirm at UAT whether/when to build it.
- **D14** The "Coordination / Chat" demo view: a side-panel chat where the human (PRINCIPAL) issues
  instructions; each decision/message **appends to the journal** (who/role/action/at). The chat is a
  **stub** (no real LLM call) — canned/echo assistant turns labelled clearly. Reuse the existing
  `@sentropic/chat-ui` ChatPanel pattern (see `RadarChatPanel.svelte`) if clean; else a simple panel.

### ÉV6 — T3/T4 consoles
- **D15** ONE new DemoView **"console"** with **tabs** (Qualification T3 · Deep-dive T3 · Jobs T4)
  rather than 2-3 separate nav items — the nav already has 8 entries. → confirm at UAT.
- **D16** T3 reuses `sourceEvaluations` (read-only): the **Qualification** tab is a status board
  grouped by `recommendation` (counts + per-source access/cost chips); the **Deep-dive** tab reuses
  the existing `SourceDeepDive`/`RecommendationBoard` source-review components if they plug in cleanly,
  else a thin local rendering.
- **D17** T4 **Jobs** are **demo stubs** — `ui/src/lib/jobs/jobs-data.ts` fixtures (type
  ingestion|scan|scoring|backfill, status queued|running|done|failed, source ref, startedAt, duration,
  mode real/sim). No real orchestration/scheduler (ties to ÉV4 D11). ESCALATION: real job orchestration
  + scheduler deferred to a server-side build (UAT decision).

### ÉV7 — automation + benchmark
- **D18** One new DemoView **"automatisation"** (last). Three **treatment cadence cards** — initial
  (rétro-analyse 2 ans, one-shot), récurrent (scan quotidien), approfondissement (à la demande par
  opportunité) — descriptive, illustrative cadences.
- **D19** A **connectors** list = **stub** (sources/MCP connectors as "à venir / non connecté") — no
  real connection. ESCALATION: real automation scheduler + connectors deferred to a server-side build
  (ties to D11/D17).
- **D20** A **per-stage agent benchmark recap** reusing the existing `ui/src/lib/demo/benchmark-data.ts`
  (the honest 4-track agent comparison) — a compact recap (per agent/stage), not a re-implementation;
  link/refer to the existing Comparaison view. Fair-benchmarking rule respected (no fabricated wins).
