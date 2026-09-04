<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type {
    BasemapSpec,
    GeoLayerSpec,
    GeoMapHandle,
    GeoViewport,
    MountGeoMap,
  } from "@sentropic/geo-map-engine";
  import {
    mountGeoEngine,
    resolveDsTokens,
  } from "$lib/maps/geo-engine-adapter.js";

  export let mount: MountGeoMap<HTMLElement>;
  export let basemap: BasemapSpec;
  export let layers: readonly GeoLayerSpec[];
  export let viewport: GeoViewport;
  export let tokenRoles: readonly string[];

  let host: HTMLDivElement;
  let handle: GeoMapHandle | null = null;

  onMount(() => {
    handle = mountGeoEngine(mount, host, {
      basemap,
      layers,
      viewport,
      tokens: resolveDsTokens(host, tokenRoles),
      renderer: "2d",
    });
  });

  onDestroy(() => {
    handle?.destroy();
    handle = null;
  });
</script>

<div
  bind:this={host}
  class="relative h-full w-full overflow-hidden"
  data-testid="signaux-geo-engine-canvas"
></div>
