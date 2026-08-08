<script lang="ts">
  /**
   * Test harness for SignauxSelPanel.
   *
   * Reproduces the parent (SignauxMapView) contract for selection state:
   * `selectionState` is owned here and mutated by reassignment inside
   * `toggleBucketKey`, exactly like the real parent. This lets a component
   * test exercise the click → focus → detail-card reactivity loop in
   * isolation (no MapLibre, no API).
   */
  import SignauxSelPanel from "./SignauxSelPanel.svelte";
  import type { CityMapEntry } from "$lib/maps/maps-data.js";
  import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
  import type { GeoZonesResponse } from "$lib/maps/geo-zones-client.js";
  import type { LotsResponse } from "$lib/maps/lots-client.js";
  import {
    createSelectionBucketState,
    setFocus,
    toggleSelection,
    type SelectionBucketState,
    type SelectionKey,
  } from "$lib/maps/selection-bucket.js";
  import {
    DEFAULT_EVAL_FILTER,
    type EvalLotFilter,
  } from "$lib/maps/eval-lot-filters.js";

  export let selectedCity: CityMapEntry | null = null;
  export let detailNodes: GraphSignalNode[] = [];
  export let unfilteredSignalCount = 0;
  export let detailError: string | null = null;
  export let vivierBMode = false;
  export let selectionState: SelectionBucketState = createSelectionBucketState();
  export let zonesResponse: GeoZonesResponse | null = null;
  export let lotsResponse: LotsResponse | null = null;

  // Miroir du filtre LOTS du parent (SignauxMapView) : l'état vit ici et
  // l'en-tête de l'accordéon Lots remonte le nouveau filtre par callback. (Les
  // filtres de couche ZONE — bucket Zones — ont été retirés, 01KZGM07 item 1.)
  export let lotFilter: EvalLotFilter = DEFAULT_EVAL_FILTER;
  // m7 — passe-plat du callback d'ouverture de source (viewer partagé) pour
  // que les tests observent le payload (règlement PDF).
  export let onOpenSource: (payload: {
    title: string;
    sourceUrl: string | null;
    rawRef?: string | null;
    page?: number | null;
  }) => void = () => {};

  function handleLotFilterChange(next: EvalLotFilter): void {
    lotFilter = next;
  }

  // Mirror of SignauxMapView.toggleBucketKey (#9 accordion logic).
  function toggleBucketKey(key: SelectionKey): void {
    const isFocused = selectionState.focusedKey === key;
    if (isFocused) {
      selectionState = setFocus(selectionState, null);
    } else {
      if (!selectionState.selectedKeys.has(key)) {
        selectionState = toggleSelection(selectionState, key);
      }
      selectionState = setFocus(selectionState, key);
    }
  }
</script>

<SignauxSelPanel
  {selectedCity}
  {detailNodes}
  {unfilteredSignalCount}
  {detailError}
  {vivierBMode}
  {selectionState}
  {zonesResponse}
  {lotsResponse}
  {lotFilter}
  onLotFilterChange={handleLotFilterChange}
  onToggleKey={toggleBucketKey}
  {onOpenSource}
/>
