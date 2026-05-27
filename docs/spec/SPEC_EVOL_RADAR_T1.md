# SPEC_EVOL — ÉV2 Radar T1 (signals feed) — brief

> **Status**: EVOL — évolution ÉV2 (`feat/radar-t1-signals`). Builds on ÉV1's `Signal`
> entity + `SIGNAL_TYPE_VALUES`. Default decisions logged in `UAT_EV2_EV7_ESCALATIONS.md`.
> Parent: `SPEC_EVOL_PROCESS_E2E.md` §2 (T1), §4.2 (tri). All new code/text English; UI French.

## 1. Goal
A **"Signaux (T1)"** demo view: the triage feed of upstream signals. Surfaces each `Signal`
with its **/10 value AND confidence shown separately** (never multiplied — VISION §6 / spec
§4.2), its qualification **status**, type, bylaw/zone and `detectedAt`; **sortable** by value
or by confidence; **filterable** by status; with an **"Approfondir"** action per signal.

## 2. Data model (reuse ÉV1, no schema change expected)
- Uses ÉV1 `Signal` (`@radar/domain`): `id, type, value, confidence, status, sourceRefs,
  detectedAt, bylaw?, zone?, mode`.
- A demo source `ui/src/lib/demo/radar-t1-signals.ts`: builds `Signal[]` — one **real** signal
  per pilot (mode `real`, value from `SIGNAL_TYPE_VALUES[type]`) + 2-3 **synthetic** signals
  (mode `simulation`) to give the feed volume + exercise the real/sim filter (`filterRealMode`).
- If a helper to derive value/confidence from a signal is useful, put it in `ui/src/lib/scoring`
  (no domain change). Only touch `@radar/domain` if a missing field is discovered (log it).

## 3. View behaviour
- **Table/list** of signals: columns type (label), bylaw·zone, value /10 (bar/number),
  confidence badge (Haute/Moyenne/Faible), status chip, detectedAt. French copy.
- **Sort controls**: by value (default desc) and by confidence — two independent toggles,
  not a combined product.
- **Status filter**: nouveau · à-approfondir · écarté · surveillance (+ "tous").
- **Real/sim toggle**: a switch using `filterRealMode` to hide simulation signals (honest
  provenance); default = show all, badge simulation rows.
- **"Approfondir"** button: sets the signal's status to `à-approfondir` (local in-memory; the
  persistent journal is ÉV3) and navigates to the **Grilles** view (deep-link). Full
  signal→specific-dossier filtering deferred to ÉV3.

## 4. Wiring
- Add `"signaux"` to `DemoView` (`ui/src/lib/demo/views.ts`); NavMenu item (lucide `Radio`/
  `ListFilter` icon, label "Signaux (T1)"); App.svelte branch rendering `<SignalsT1View>`.

## 5. Acceptance
1. The view lists ≥5 signals (3 real pilots + synthetic), value & confidence as separate columns.
2. Sorting by value and by confidence both work and are independent (no multiplication).
3. Status filter + real/sim filter (`filterRealMode`) work; simulation rows are badged.
4. "Approfondir" flips status to `à-approfondir` and navigates to Grilles.
5. Wired as a demo view; other views still build; gate green (typecheck/lint/test-ui/build).

## 6. Out of scope (later évolutions)
Persistent journal/status (ÉV3), signal→specific-dossier funnel filtering (ÉV3), automated
signal ingestion (ÉV4/ÉV7).
