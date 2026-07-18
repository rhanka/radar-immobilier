<script lang="ts">
  import SignauxRail from "$lib/components/maps/SignauxRail.svelte";

  // Minimal parent contract: a city reconcile returns the canonical B mode key.
  // SignauxRail must not reset its owned live axes when that key is unchanged.
  let initialSubsetKey = "vivier-v2";
  let emitted: string[] = [];
  function onFilterChange(key: string) { emitted = [...emitted, key]; }
  function reconcileCity() { initialSubsetKey = "vivier-v2"; }
</script>

<button id="reconcile-city" on:click={reconcileCity}>Reconcile city</button>
<span id="initial-key">{initialSubsetKey}</span>
<span id="emitted">{emitted.join(",")}</span>
<SignauxRail {initialSubsetKey} {onFilterChange} />
