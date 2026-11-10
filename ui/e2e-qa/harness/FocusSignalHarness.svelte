<script lang="ts">
  import { onMount } from "svelte";
  import { Map as MaplibreMap } from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";
  import SignalFocusPanel from "$lib/components/maps/SignalFocusPanel.svelte";
  import { FOCUS_CASES, type FocusCase } from "$lib/maps/focus-signal-cases.js";

  let selected: FocusCase | null = null;
  let hoveredLot: string | null = null;
  let mapEl: HTMLDivElement;

  onMount(() => {
    const map = new MaplibreMap({
      container: mapEl,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-73.516, 45.531],
      zoom: 13,
    });
    return () => map.remove();
  });
</script>

<div class="flex h-screen bg-white text-slate-900">
  <aside class="w-80 shrink-0 overflow-y-auto border-r border-slate-200 p-3">
    <p class="m-0 text-xs font-semibold text-slate-500">Signaux (données réelles MCP, 2026-11-09)</p>
    {#each FOCUS_CASES as c (c.signalId)}
      <button
        type="button"
        class="mt-2 w-full rounded-sm border px-3 py-2 text-left text-sm {selected?.signalId === c.signalId
          ? 'border-orange-400 bg-orange-50'
          : 'border-slate-200 hover:bg-slate-50'}"
        data-testid="harness-signal-{c.signalId}"
        on:click={() => (selected = c)}
      >
        <strong>{c.bylaw}</strong> · {c.cityLabel} · zone {c.zoneCode}<br />
        <span class="text-xs text-slate-500">{c.stage} · {c.stageDate} — {c.summary}</span>
      </button>
    {/each}
    <p class="mt-3 text-xs text-slate-400">
      Rail gauche et cartes de droite : inchangés dans l'artefact réel (SignauxMapView).
      Ce harnais isole le nouveau panneau focus + la carte pour la capture.
    </p>
  </aside>

  <main class="flex min-w-0 flex-1 flex-col">
    {#if selected}
      <div class="h-1/2 min-h-0 shrink-0" data-testid="harness-focus-half">
        <SignalFocusPanel
          focusCase={selected}
          {hoveredLot}
          onHoverLot={(noLot) => (hoveredLot = noLot)}
          onClose={() => (selected = null)}
        />
      </div>
    {/if}
    <div class="relative min-h-0 flex-1">
      <div bind:this={mapEl} class="absolute inset-0" data-testid="harness-map"></div>
      {#if selected}
        <p class="absolute left-3 top-3 z-10 m-0 rounded-sm bg-white/95 px-2 py-1 text-xs text-slate-700 shadow">
          Carte — {selected.cityLabel}, zone {selected.zoneCode}
          {hoveredLot ? `· lot survolé : ${hoveredLot}` : "· surlignage zones/lots : couches géo réelles de l'host (source-gap en harnais)"}
        </p>
      {/if}
    </div>
  </main>
</div>
