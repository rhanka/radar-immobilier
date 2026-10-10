status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/date-basis-in-custom-tab@6af5a86231a80a3f3153a9959a0f053ed3e894a8
lens: behavioural-correctness-and-contract-preservation

## Reasoning

Reviewed independently, without reading other reviewers' artifacts. Confirmed HEAD is `6af5a86231a80a3f3153a9959a0f053ed3e894a8`, read PR #823 with `gh pr view 823`, and inspected the complete five-file diff `origin/main...6af5a862`. The PR is explicitly a draft awaiting design-system publication and lockfile regeneration. The prior rail-level implementation from PR #793 is removed in this diff.

Inspected the actual dependency source in `tmp/ds/sentropic-design-system-svelte-0.35.1.tgz`, including `TimeRangePicker.svelte`, `MenuPopover.svelte`, and `RadioGroup.svelte`. Tarball SHA-256: `1f589fc3d688f160786a47b9327b2f2f25a57b9a81d87550c46db155c47d85b5`.

- **Placement and Svelte interoperability:** `ui/src/lib/components/maps/SignauxRail.svelte:429` defines the sole date-basis `RadioGroup` inside the named `customExtra` snippet passed to `TimeRangePicker`. The DS renders that snippet only in the Custom branch, directly before the From/To bounds. No separate radio remains in the rail or Relative tab. The component tests use the real DS, with no DS mock, and demonstrate that the legacy-mode consumer successfully passes the snippet to the runes component, renders it in the intended branch, and handles radio changes.
- **Draft lifecycle:** `SignauxRail.svelte:96` keeps a separate `draftDateBasis`; `handleTimeRangePickerOpen(true)` reseeds it from the current applied prop on each open. Selecting a radio only changes that draft. `handleTimeRangePick` at line 103 forwards the draft only for an absolute range. In the supplied DS, `onApply` is the sole absolute-range commit path; Cancel only closes the panel. `MenuPopover.svelte:106` and `:113` likewise handle outside pointer-down and Escape by setting `open = false`, without calling the range callback. The DS reports the next open through `onOpenChange`, so a discarded draft cannot survive reopening. This also reads a newly applied parent basis rather than retaining the initial mount value.
- **Relative presets:** `SignauxRail.svelte:104` explicitly passes `"document"` for every relative range, regardless of the previously applied or staged choice. The tests cover all four presets and switching from a custom acquisition period to a relative preset. `dateBasisForTimeRange` in `ui/src/lib/signals/signal-date-filter.ts:18` independently enforces the same rule in the parent.
- **Atomic parent update and reload:** `ui/src/lib/components/maps/SignauxMapView.svelte:611` receives both values in one handler, normalizes the range, computes the civil-date window, and applies `dateBasisForTimeRange` before calling `syncFilterRoute` and `load`, once each. The old independent basis handler and prop are removed. The route echo does not require a second bulk reload: `applyGeoRoute` at line 1874 compares the already-applied period, basis, and exclusions before its conditional `load`; `sameTimeRange` compares civil dates for custom ranges, so URL serialization dropping time-of-day does not create a false period change. The existing local selection reconciliation and map update remain in the handler.
- **Caller compatibility:** Searching `ui`, `api`, and `packages` found no remaining `onDateBasisChange` or `handleDateBasisChange`. The production `SignauxRail` caller supplies the combined handler at `SignauxMapView.svelte:2482`; the other callers are filter-focused harnesses that do not supply the removed callback.
- **URL and API contracts:** The router, date helpers, API client, and API route are unchanged by the target diff. `ui/src/lib/router/geo-filter-state.ts:108` still reads `acquisition` and legacy `scrap` as the internal `"scrap"` value; line 169 still writes `filter.dateBasis=acquisition` only for custom acquisition periods, omitting the basis for document dates and relative presets. `SignauxMapView.svelte:2426` still passes the applied basis through `signalDocumentDateWindow`; `ui/src/lib/signals/graph-signals-by-city-client.ts:60` still serializes acquisition as `dateBasis=scrap`. `api/src/routes/graph-signals.ts:891` still consumes that exact API spelling.
- **Portal and CSS:** `SignauxRail.svelte:155` retains the existing portal action, which moves the actual popover under the closest theme root, with a body fallback. The snippet moves with that panel. DS outside-click containment uses its retained panel reference and `composedPath`/`contains`, so leaving the rail does not turn a radio interaction into an outside click. Focus trapping also retains a reference to the panel content. Removing the former `.vivier-panel .signals-date-basis .st-choice` font override is consistent with the new location: after portaling, that ancestor selector could not style these controls anyway. The DS radio group supplies its own styling and horizontal wrapping. No new portal or styling regression is demonstrated.

Validation performed through Make only, using the supplied test environment and installed DS build:

```text
make test-ui SCOPE=src/lib/components/maps/SignauxRail.test.ts ENV=test-date-basis-custom-tab
32 tests passed; 1 file passed; exit 0.

make test-ui SCOPE='src/lib/router/geo-filter-state.test.ts src/lib/router/router.test.ts src/lib/signals/signal-date-filter.test.ts src/lib/signals/graph-signals-by-city-client.test.ts' ENV=test-date-basis-custom-tab
39 tests passed; 4 files passed; exit 0.
```

The 71 passing tests include custom-tab placement before the date fields, absence from the rail and Relative tab, deferred application, a single combined callback, Cancel/reopen reseeding, acquisition restoration, relative defaults, URL round-trips and legacy URL acceptance, and API query serialization. Escape/outside-click discard and the parent's single-reload route were checked by tracing the actual implementation; the existing tests do not directly exercise those complete paths. No browser visual run or full map/API integration run was performed, so this review does not claim pixel-level or end-to-end verification.

## Findings

None. No blocking or non-blocking behavioral defect survived code inspection and the targeted tests. The untested interaction paths above are verification limits, not demonstrated failures.

## Verdict

**GO** for behavioral correctness and contract preservation with the supplied DS 0.35.1 build.

This verdict does not establish clean-install or merge readiness: the PR's declared draft prerequisite remains publication of the required DS release, followed by lockfile regeneration and CI verification. The unpublished dependency and intentionally unchanged lockfile were treated as the stated review context, not as a newly discovered behavioral regression.
