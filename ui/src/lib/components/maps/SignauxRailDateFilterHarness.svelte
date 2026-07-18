<script lang="ts">
  /**
   * m2 — Test harness for SignauxRail's DATE-RANGE filter pipeline.
   *
   * Reproduces the parent (SignauxMapView) contract for the displayed list:
   * projection of the live key, then the DATE lens (first display filter), then
   * the B exclusions. The date range flows out of SignauxRail's DateRangeFilter
   * and back into the SAME composition the parent uses for `filteredDetailNodes`.
   * Lets a component test drive the preset buttons and assert the visible count
   * moves — the "the date filter really reduces the list" requirement.
   */
  import SignauxRail from "./SignauxRail.svelte";
  import type { CityMapEntry } from "$lib/maps/maps-data.js";
  import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
  import {
    modeFromSubsetKey,
    projectNodesForVivierKey,
  } from "$lib/signals/vivier-view-mode.js";
  import {
    applyVivierBExclusions,
    DEFAULT_VIVIER_B_EXCLUSIONS,
    type VivierBExclusions,
  } from "$lib/signals/vivier-b-display-filter.js";
  import {
    defaultDateRange,
    filterNodesByEtapeDate,
    type SignalDateRange,
  } from "$lib/signals/signal-date-filter.js";

  export let entries: CityMapEntry[] = [];
  export let detailNodes: GraphSignalNode[] = [];
  export let initialSubsetKey = "vivier-v2";

  let activeKey = initialSubsetKey;
  let exclusions: VivierBExclusions = { ...DEFAULT_VIVIER_B_EXCLUSIONS };
  let dateRange: SignalDateRange = defaultDateRange();

  function handleFilterChange(key: string): void {
    activeKey = key;
  }
  function handleExclusionsChange(next: VivierBExclusions): void {
    exclusions = next;
  }
  function handleDateRangeChange(next: SignalDateRange): void {
    dateRange = next;
  }

  // Parity with SignauxMapView.filteredDetailNodes: projection of the live key,
  // then the date lens, then (mode B) the display exclusions. (Ranking omitted —
  // it does not change the count under test.)
  $: projected = projectNodesForVivierKey(detailNodes, null, activeKey).nodes;
  $: dated = filterNodesByEtapeDate(projected, dateRange);
  $: visible =
    modeFromSubsetKey(activeKey) === "b"
      ? applyVivierBExclusions(dated, exclusions)
      : dated;
</script>

<span data-testid="visible-count">{visible.length}</span>
<SignauxRail
  {entries}
  {initialSubsetKey}
  {exclusions}
  {dateRange}
  onFilterChange={handleFilterChange}
  onExclusionsChange={handleExclusionsChange}
  onDateRangeChange={handleDateRangeChange}
/>
