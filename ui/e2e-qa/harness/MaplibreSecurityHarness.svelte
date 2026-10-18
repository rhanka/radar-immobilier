<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Map, AttributionControl } from "maplibre-gl";
  import { GeoMap } from "@sentropic/geo-ui-svelte";
  import type { FeatureCollection } from "@sentropic/geo-core";
  import { mount as mountEngine, type GeoMapHandle } from "@sentropic/geo-map-engine";
  import { mountGeoEngine } from "$lib/maps/geo-engine-adapter.js";
  import CadastreMapView from "$lib/components/maps/CadastreMapView.svelte";
  import GeoCityMapBase, { type GeoCityMapApi } from "$lib/components/maps/GeoCityMapBase.svelte";
  import snapshot from "$lib/maps/fixtures/cadastre/delson.snapshot.json";
  import { mapCadastreCityToLayers, type CadastreRawCity } from "$lib/maps/cadastre-geojson-source.js";

  const mode = new URLSearchParams(location.search).get("mode") ?? "native";
  const hostile = 'Fixture © Provider <a href="javascript:window.__attributionProbe=1" onclick="window.__attributionProbe=2" onmouseover="window.__attributionProbe=3">probe</a><img src="invalid-fixture" onerror="window.__attributionProbe=4" onload="window.__attributionProbe=5">';
  const layers = mapCadastreCityToLayers(snapshot as unknown as CadastreRawCity);
  layers.bounds = [-73.5312, 45.3738, -73.5298, 45.3752];
  layers.center = [-73.5305, 45.3745];
  layers.lots.features = layers.lots.features.slice(0, 1);
  Object.assign(layers.lots.features[0].properties, { zoneCode: "H-12", citySlug: "delson" });
  const data = layers.lots as unknown as FeatureCollection;
  let host: HTMLDivElement;
  let native: Map | undefined;
  let engine: GeoMapHandle | undefined;
  let mounted = true;
  let generation = 0;
  let selected = "";
  let ready = false;

  function cityReady(api: GeoCityMapApi): void {
    api.syncGeoLayers({ zones: { type: "FeatureCollection", features: [] }, lots: data,
      zoneFillColor: "#2563eb", zoneFillOpacity: 0.4, lotFillColor: "#2563eb",
      lotFillOpacity: 0.8, lotLineColor: "#111827" });
    api.fitMapToBounds([[-73.5312, 45.3738], [-73.5298, 45.3752]], { duration: 0 });
    ready = true;
  }

  function createNative(): void {
    native = new Map({ container: host, center: layers.center, zoom: 17,
      attributionControl: false, style: { version: 8, sources: {
        lots: { type: "geojson", data: "/security-lots.geojson", attribution: hostile },
        osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256, attribution: '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
      }, layers: [{ id: "osm", type: "raster", source: "osm" },
        { id: "lots", type: "fill", source: "lots", paint: { "fill-color": "#2563eb", "fill-opacity": 0.8 } }] } });
    native.addControl(new AttributionControl({ compact: false }));
    native.on("load", () => { ready = true; });
    native.on("click", "lots", (event) => { selected = String(event.features?.[0]?.properties.noLot ?? ""); });
    native.on("error", (event) => console.error("Native map error", event.error));
    // A read-only inspection seam exposes the actual renderer, never substitutes it.
    (window as unknown as { __securityMap: Map }).__securityMap = native;
  }

  function createEngine(): void {
    engine = mountGeoEngine(mountEngine, host, {
      basemap: { kind: "blank", background: "surface" },
      viewport: { center: layers.center, zoom: 17, bearing: 0, pitch: 0 },
      tokens: { surface: "#f8fafc", lot: "#2563eb" },
      layers: [{ id: "layers/acceptance-lots", kind: "geojson", data,
        fill: { color: { by: "constant", token: "lot" }, opacity: { by: "constant", value: 0.8 } },
        interactivity: { idField: "noLot", select: true, hover: true } }],
      onReady: () => { ready = true; },
      onSelect: (feature) => { selected = String(feature.properties.noLot); },
      onError: (error) => console.error("Engine map error", error.message),
    });
    // Inspect only the public handle returned by the real synchronous engine mount.
    (window as unknown as { __securityEngine: GeoMapHandle }).__securityEngine = engine;
  }

  async function remount(): Promise<void> {
    native?.remove(); native = undefined; ready = false; selected = "";
    engine?.destroy(); engine = undefined;
    mounted = false;
    const { tick } = await import("svelte");
    await tick(); generation += 1; mounted = true; await tick();
    if (mode === "native") createNative();
    if (mode === "engine") createEngine();
  }
  onMount(() => {
    if (mode === "native") createNative();
    if (mode === "engine") createEngine();
  });
  onDestroy(() => { native?.remove(); engine?.destroy(); });
</script>

<h1>MapLibre security acceptance: {mode}</h1>
<button onclick={() => void remount()}>Unmount and remount map</button>
<output data-testid="generation">{generation}</output>
<output data-testid="selection">{selected}</output>
<output data-testid="ready">{ready ? "ready" : "loading"}</output>
<div class="map-frame" data-testid="map-frame">
  {#if mounted}
    {#if mode === "native" || mode === "engine"}
      <div bind:this={host} class="map-host"></div>
    {:else if mode === "cadastre"}
      <CadastreMapView citySlug="delson" {layers} />
    {:else if mode === "city" || mode === "provider"}
      <GeoCityMapBase fillColorExpression={["literal", "#2563eb"]} activeCitySlug="delson" activeZoneCode="H-12"
        basemapMode={mode === "provider" ? "satellite" : "plan"}
        onReady={cityReady} onLotClick={(lot) => { selected = String(lot.noLot); }} />
    {:else if mode === "geo"}
      <GeoMap {data} height="520px" legend={false}
        onSelect={(feature) => { selected = String(feature.properties.noLot); }} />
    {/if}
  {/if}
</div>

<style>
  .map-frame { width: 800px; height: 520px; position: relative; }
  .map-host { width: 100%; height: 100%; }
</style>
