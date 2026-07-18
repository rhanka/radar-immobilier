<script lang="ts">
  /**
   * Test harness for SignauxRail's B filter pipeline.
   *
   * Reproduces the parent (SignauxMapView) contract for the Vivier B displayed
   * list, WITHOUT MapLibre or the API: the B key (rail axes) and the display
   * exclusions both flow out of SignauxRail and back into the SAME projection +
   * exclusion composition the parent uses for `filteredDetailNodes`. Lets a
   * component test exercise the rail-checkbox → visible-count loop (m1.4/m1.7)
   * end-to-end through real Svelte reactivity.
   *
   * m1.7 — Also mirrors `selectedCityLiveCount` (SignauxMapView) so a test can
   * assert the RAIL BADGE for `selectedSlug` tracks `visible.length` (axes +
   * exclusions), not the static bulk count from `entries`.
   */
  import SignauxRail from "./SignauxRail.svelte";
  import type { CityMapEntry } from "$lib/maps/maps-data.js";
  import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
  import { projectNodesForVivierKey } from "$lib/signals/vivier-view-mode.js";
  import {
    applyVivierBExclusions,
    DEFAULT_VIVIER_B_EXCLUSIONS,
    type VivierBExclusions,
  } from "$lib/signals/vivier-b-display-filter.js";

  export let entries: CityMapEntry[] = [];
  export let detailNodes: GraphSignalNode[] = [];
  export let initialSubsetKey = "vivier-v2";
  /** Ville sélectionnée dont le badge du rail doit suivre `visible.length`. */
  export let selectedSlug: string | null = null;

  let activeKey = initialSubsetKey;
  let exclusions: VivierBExclusions = { ...DEFAULT_VIVIER_B_EXCLUSIONS };

  function handleFilterChange(key: string): void {
    activeKey = key;
  }
  function handleExclusionsChange(next: VivierBExclusions): void {
    exclusions = next;
  }

  // Parity with SignauxMapView.filteredDetailNodes (mode B): projection of the
  // live composed key, then the display exclusions. (Ranking omitted — it does
  // not change the count under test.)
  $: visible = applyVivierBExclusions(
    projectNodesForVivierKey(detailNodes, null, activeKey).nodes,
    exclusions,
  );

  // Parity with SignauxMapView.selectedCityLiveCount: available as soon as a
  // city is selected (this harness has no async loading state to guard).
  $: selectedCityLiveCount = selectedSlug !== null ? visible.length : null;
</script>

<span data-testid="visible-count">{visible.length}</span>
<SignauxRail
  {entries}
  {initialSubsetKey}
  {exclusions}
  {selectedSlug}
  {selectedCityLiveCount}
  onFilterChange={handleFilterChange}
  onExclusionsChange={handleExclusionsChange}
/>
