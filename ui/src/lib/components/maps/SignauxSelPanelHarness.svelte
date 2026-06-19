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
  import {
    createSelectionBucketState,
    setFocus,
    toggleSelection,
    type SelectionBucketState,
    type SelectionKey,
  } from "$lib/maps/selection-bucket.js";

  export let selectedCity: CityMapEntry | null = null;
  export let detailNodes: GraphSignalNode[] = [];
  export let selectionState: SelectionBucketState = createSelectionBucketState();

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
  {selectionState}
  onToggleKey={toggleBucketKey}
/>
