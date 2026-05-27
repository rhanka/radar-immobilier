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
### ÉV4 — T0 onboarding
### ÉV5 — h2a spike + chat
### ÉV6 — T3/T4 consoles
### ÉV7 — automation + benchmark
