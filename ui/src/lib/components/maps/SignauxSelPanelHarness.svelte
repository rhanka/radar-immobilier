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
  import {
    DEFAULT_ZONE_KIND_FILTER,
    type ZoneKindFilter,
  } from "$lib/maps/zone-kind-filter.js";
  import {
    DEFAULT_ZONE_MILLESIME_FILTER,
    type ZoneMillesimeFilter,
  } from "$lib/maps/zone-millesime-filter.js";

  export let selectedCity: CityMapEntry | null = null;
  export let detailNodes: GraphSignalNode[] = [];
  export let unfilteredSignalCount = 0;
  export let detailError: string | null = null;
  export let selectionState: SelectionBucketState = createSelectionBucketState();
  export let zonesResponse: GeoZonesResponse | null = null;
  export let lotsResponse: LotsResponse | null = null;

  // Miroir des filtres DONNÉES du parent (SignauxMapView) : l'état vit ici et
  // les en-têtes des accordéons remontent le nouveau filtre par callback.
  export let lotFilter: EvalLotFilter = DEFAULT_EVAL_FILTER;
  export let zoneKindFilter: ZoneKindFilter = DEFAULT_ZONE_KIND_FILTER;
  export let zoneMillesimeFilter: ZoneMillesimeFilter = DEFAULT_ZONE_MILLESIME_FILTER;
  // m7 / m8 — passe-plat du callback d'ouverture de source (viewer partagé) pour
  // que les tests observent le payload (règlement PDF / source de zone).
  export let onOpenSource: (payload: {
    title: string;
    sourceUrl: string | null;
    rawRef?: string | null;
    page?: number | null;
  }) => void = () => {};

  function handleLotFilterChange(next: EvalLotFilter): void {
    lotFilter = next;
  }

  function handleZoneKindFilterChange(next: ZoneKindFilter): void {
    zoneKindFilter = next;
  }

  function handleZoneMillesimeFilterChange(next: ZoneMillesimeFilter): void {
    zoneMillesimeFilter = next;
  }

  // Mirror of SignauxMapView.toggleBucketKey (#9 accordion logic). Le guard R1
  // (lot sélectionnable seulement si sa zone est active) vit côté prod dans
  // `resolveLotListClickR1` (geo-level-navigation) et est couvert par son test
  // unitaire (chemin de prod) ; ce mirror garde la logique focus/sélection.
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
  {selectionState}
  {zonesResponse}
  {lotsResponse}
  {lotFilter}
  onLotFilterChange={handleLotFilterChange}
  {zoneKindFilter}
  onZoneKindFilterChange={handleZoneKindFilterChange}
  {zoneMillesimeFilter}
  onZoneMillesimeFilterChange={handleZoneMillesimeFilterChange}
  onToggleKey={toggleBucketKey}
  {onOpenSource}
/>
