<script lang="ts">
  /**
   * GeoView — Vue Géo (G3 WP géo-intégration).
   *
   * Affiche les zones de zonage + lots + opportunités sur une carte MapLibre.
   * Couches :
   *   - Zones (polygones choroplèthes par catégorie d'opportunité)
   *   - Lots (polygones, teinte distincte)
   *   - Opportunités (points cercles par catégorie)
   *
   * Sélecteur de ville → charge les FeatureCollections via /api/geo/features/:city.
   * Empty-state FR si aucune donnée.
   * Panneau détail au clic sur une feature.
   *
   * Loi 25 : zonage public, aucune PII.
   * Ne modifie pas SignauxMapView ni EvaluationMapView.
   */
  import { onMount, onDestroy } from "svelte";
  import { MapPin, RefreshCw, Layers, Info, X, ChevronDown } from "@lucide/svelte";
  import { Badge } from "@sentropic/design-system-svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import {
    fetchGeoCities,
    fetchGeoFeatures,
    type GeoCityInfo,
    type GeoJsonFeature,
  } from "./geo-client.js";
  import {
    GEO_CATEGORIES,
    GEO_CATEGORY_MAP,
    GEO_CATEGORY_DEFAULT_COLOR,
    getCategoryColor,
    getCategoryLabel,
    GEO_ZONE_DETAIL_SCHEMA,
    GEO_LOT_DETAIL_SCHEMA,
    GEO_OPPORTUNITE_DETAIL_SCHEMA,
    type GeoDetailSchema,
  } from "./geo-categories.js";

  // ── State global ───────────────────────────────────────────────────────────
  let cities: GeoCityInfo[] = [];
  let citiesLoading = true;
  let citiesError: string | null = null;
  let selectedCity: string = "";

  // Données géo pour la ville sélectionnée
  let zonesCount = 0;
  let lotsCount = 0;
  let oppsCount = 0;
  let dataLoading = false;
  let dataError: string | null = null;

  // Panneau détail
  let selectedFeature: GeoJsonFeature | null = null;
  let selectedSchema: GeoDetailSchema | null = null;

  // Légende
  let showLegend = true;

  // ── MapLibre ───────────────────────────────────────────────────────────────
  let mapContainer: HTMLDivElement;
  let mapInstance: unknown = null;
  let mapReady = false;

  // ── Chargement villes ──────────────────────────────────────────────────────
  async function loadCities(): Promise<void> {
    citiesLoading = true;
    citiesError = null;
    try {
      const res = await fetchGeoCities();
      cities = res.cities;
      // Pré-sélectionner la première ville avec des zones ou des résolutions
      const first = cities.find((c) => c.zoneCount > 0 || c.signalCount > 0);
      if (first) selectedCity = first.citySlug;
    } catch (e) {
      citiesError = e instanceof Error ? e.message : "Erreur chargement villes";
    } finally {
      citiesLoading = false;
    }
  }

  // ── Chargement données géo ─────────────────────────────────────────────────
  async function loadGeoData(citySlug: string): Promise<void> {
    if (!citySlug || !mapReady) return;
    dataLoading = true;
    dataError = null;
    selectedFeature = null;
    try {
      const res = await fetchGeoFeatures(citySlug);
      zonesCount = res.zoneCount;
      lotsCount = res.lotCount;
      oppsCount = res.opportuniteCount;
      updateMapLayers(res.zones, res.lots, res.opportunites);
    } catch (e) {
      dataError = e instanceof Error ? e.message : "Erreur chargement données géo";
      zonesCount = 0;
      lotsCount = 0;
      oppsCount = 0;
    } finally {
      dataLoading = false;
    }
  }

  // ── MapLibre layer management ──────────────────────────────────────────────
  function updateMapLayers(
    zones: { type: string; features: GeoJsonFeature[] },
    lots: { type: string; features: GeoJsonFeature[] },
    opportunites: { type: string; features: GeoJsonFeature[] },
  ): void {
    if (!mapInstance) return;
    const m = mapInstance as {
      getSource: (id: string) => { setData: (d: unknown) => void } | undefined;
      addSource: (id: string, spec: unknown) => void;
      addLayer: (spec: unknown) => void;
      getLayer: (id: string) => unknown;
      on: (event: string, id: string, cb: (e: unknown) => void) => void;
      fitBounds: (bounds: [[number, number], [number, number]], opts: unknown) => void;
    };

    const LAYERS = [
      { id: "geo-zones-fill", source: "geo-zones" },
      { id: "geo-zones-outline", source: "geo-zones" },
      { id: "geo-lots-fill", source: "geo-lots" },
      { id: "geo-lots-outline", source: "geo-lots" },
      { id: "geo-opps-circle", source: "geo-opps" },
    ];

    // Mettre à jour ou créer les sources
    function upsertSource(id: string, data: unknown): void {
      const existing = m.getSource(id);
      if (existing) {
        existing.setData(data);
      } else {
        m.addSource(id, { type: "geojson", data });
      }
    }

    upsertSource("geo-zones", zones);
    upsertSource("geo-lots", lots);
    upsertSource("geo-opps", opportunites);

    // Construire la colorisation catégorie pour les zones
    // MapLibre expression : ["match", ["get", "category"], cat1, color1, cat2, color2, ..., default]
    const catMatchExpression: unknown[] = ["match", ["get", "category"]];
    for (const cat of GEO_CATEGORIES) {
      catMatchExpression.push(cat.id, cat.color);
    }
    catMatchExpression.push(GEO_CATEGORY_DEFAULT_COLOR);

    // Ajouter les couches si pas encore présentes
    if (!m.getLayer("geo-zones-fill")) {
      m.addLayer({
        id: "geo-zones-fill",
        type: "fill",
        source: "geo-zones",
        paint: {
          "fill-color": catMatchExpression,
          "fill-opacity": 0.45,
        },
      });
    }

    if (!m.getLayer("geo-zones-outline")) {
      m.addLayer({
        id: "geo-zones-outline",
        type: "line",
        source: "geo-zones",
        paint: {
          "line-color": catMatchExpression,
          "line-width": 1.5,
          "line-opacity": 0.8,
        },
      });
    }

    if (!m.getLayer("geo-lots-fill")) {
      m.addLayer({
        id: "geo-lots-fill",
        type: "fill",
        source: "geo-lots",
        paint: {
          "fill-color": "#7c3aed",
          "fill-opacity": 0.25,
        },
      });
    }

    if (!m.getLayer("geo-lots-outline")) {
      m.addLayer({
        id: "geo-lots-outline",
        type: "line",
        source: "geo-lots",
        paint: {
          "line-color": "#7c3aed",
          "line-width": 1,
          "line-opacity": 0.6,
        },
      });
    }

    if (!m.getLayer("geo-opps-circle")) {
      m.addLayer({
        id: "geo-opps-circle",
        type: "circle",
        source: "geo-opps",
        filter: ["!=", ["geometry-type"], ""],
        paint: {
          "circle-radius": 6,
          "circle-color": catMatchExpression,
          "circle-opacity": 0.85,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });
    }

    // Recalibrer l'expression couleur sur les couches existantes
    try {
      const fillLayer = m.getLayer("geo-zones-fill");
      if (fillLayer) {
        // déjà déclaré via addLayer + setData source — la couleur est déjà câblée
      }
    } catch {
      // ignoré — MapLibre met à jour via setData sur la source
    }

    // Fitter la bbox si la ville a des zones
    if (zones.features.length > 0) {
      fitMapToBounds(zones.features);
    } else if (lots.features.length > 0) {
      fitMapToBounds(lots.features);
    }
  }

  function fitMapToBounds(features: GeoJsonFeature[]): void {
    if (!mapInstance || features.length === 0) return;
    const m = mapInstance as {
      fitBounds: (b: [[number, number], [number, number]], opts: unknown) => void;
    };

    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;

    function processCoords(coords: unknown): void {
      if (!Array.isArray(coords)) return;
      if (typeof coords[0] === "number") {
        const [lon, lat] = coords as number[];
        if (lon < minLon) minLon = lon;
        if (lat < minLat) minLat = lat;
        if (lon > maxLon) maxLon = lon;
        if (lat > maxLat) maxLat = lat;
      } else {
        for (const sub of coords) processCoords(sub);
      }
    }

    for (const f of features) {
      if (f.geometry?.coordinates) processCoords(f.geometry.coordinates);
    }

    if (
      minLon !== Infinity &&
      minLat !== Infinity &&
      maxLon !== -Infinity &&
      maxLat !== -Infinity
    ) {
      m.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 40, maxZoom: 16 });
    }
  }

  // ── Init MapLibre ──────────────────────────────────────────────────────────
  async function initMap(): Promise<void> {
    if (!mapContainer) return;
    const maplibre = (await import("maplibre-gl")).default;
    const m = new maplibre.Map({
      container: mapContainer,
      style: {
        version: 8,
        sources: {
          "osm-tiles": {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          {
            id: "osm-layer",
            type: "raster",
            source: "osm-tiles",
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      },
      center: [-73.5, 45.55], // Québec centré par défaut
      zoom: 9,
    });

    m.on("load", () => {
      mapInstance = m;
      mapReady = true;
      // Enregistrer les clics sur les couches
      m.on("click", "geo-zones-fill", (e: unknown) => {
        const ev = e as { features?: Array<{ properties: Record<string, unknown>; geometry: unknown }> };
        if (ev.features?.[0]) {
          selectedFeature = {
            type: "Feature",
            geometry: ev.features[0].geometry as GeoJsonFeature["geometry"],
            properties: ev.features[0].properties,
          };
          selectedSchema = GEO_ZONE_DETAIL_SCHEMA;
        }
      });
      m.on("click", "geo-lots-fill", (e: unknown) => {
        const ev = e as { features?: Array<{ properties: Record<string, unknown>; geometry: unknown }> };
        if (ev.features?.[0]) {
          selectedFeature = {
            type: "Feature",
            geometry: ev.features[0].geometry as GeoJsonFeature["geometry"],
            properties: ev.features[0].properties,
          };
          selectedSchema = GEO_LOT_DETAIL_SCHEMA;
        }
      });
      m.on("click", "geo-opps-circle", (e: unknown) => {
        const ev = e as { features?: Array<{ properties: Record<string, unknown>; geometry: unknown }> };
        if (ev.features?.[0]) {
          selectedFeature = {
            type: "Feature",
            geometry: ev.features[0].geometry as GeoJsonFeature["geometry"],
            properties: ev.features[0].properties,
          };
          selectedSchema = GEO_OPPORTUNITE_DETAIL_SCHEMA;
        }
      });
      // Charger les données si une ville est déjà sélectionnée
      if (selectedCity) {
        void loadGeoData(selectedCity);
      }
    });

    m.on("error", (e: unknown) => {
      const err = e as { error?: { message?: string } };
      console.warn("[GeoView] MapLibre error:", err.error?.message ?? e);
    });
  }

  // ── Réactivité ville sélectionnée ─────────────────────────────────────────
  $: if (selectedCity && mapReady) {
    void loadGeoData(selectedCity);
  }

  // ── Cycle de vie ──────────────────────────────────────────────────────────
  onMount(async () => {
    await loadCities();
    await initMap();
  });

  onDestroy(() => {
    if (mapInstance) {
      (mapInstance as { remove: () => void }).remove();
      mapInstance = null;
    }
  });

  // ── Helpers UI ─────────────────────────────────────────────────────────────
  function cityLabel(slug: string): string {
    return slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("-");
  }

  function renderFieldValue(
    key: string,
    value: unknown,
    kind: string,
  ): string {
    if (value === null || value === undefined || value === "") return "—";
    if (kind === "number") return Number(value).toLocaleString("fr-CA");
    if (kind === "date") {
      const d = new Date(String(value));
      return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-CA");
    }
    if (key === "category") return getCategoryLabel(String(value));
    return String(value);
  }

  function featureTitle(feature: GeoJsonFeature, schema: GeoDetailSchema): string {
    if (schema.titleKey) {
      const val = feature.properties[schema.titleKey];
      if (val !== null && val !== undefined) return String(val);
    }
    const kind = feature.properties["featureKind"];
    if (kind === "zone") return "Zone";
    if (kind === "lot") return "Lot";
    return "Signal";
  }

  const LAYER_LABELS = [
    { color: GEO_CATEGORY_DEFAULT_COLOR, label: "Zone (non classifiée)" },
    ...GEO_CATEGORIES.filter((c) => !c.level).slice(0, 6).map((c) => ({
      color: c.color,
      label: c.labelFr,
    })),
    { color: "#7c3aed", label: "Lots cadastraux" },
  ];
</script>

<ViewLayout controlsWidth="w-72" stickyControlsFooter>
  <!-- Bande de contrôles gauche -->
  <svelte:fragment slot="controls">
    <div class="flex flex-col gap-4 p-4">
      <div class="flex items-center gap-2">
        <Layers class="h-4 w-4 text-teal-600 shrink-0" aria-hidden="true" />
        <span class="text-sm font-semibold text-slate-800">Vue Géo</span>
      </div>

      <!-- Sélecteur de ville -->
      <div>
        <label for="geo-city-select" class="mb-1 block text-xs font-medium text-slate-600">
          Municipalité
        </label>
        {#if citiesLoading}
          <div class="flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw class="h-3 w-3 animate-spin" aria-hidden="true" />
            Chargement...
          </div>
        {:else if citiesError}
          <p class="text-xs text-red-500">{citiesError}</p>
        {:else if cities.length === 0}
          <p class="text-xs text-slate-400 italic">
            Aucune ville avec données géo disponibles.
          </p>
        {:else}
          <div class="relative">
            <select
              id="geo-city-select"
              bind:value={selectedCity}
              class="w-full appearance-none rounded-md border border-slate-200 bg-white py-2 pl-3 pr-8 text-sm text-slate-800 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="" disabled>Choisir une ville…</option>
              {#each cities as city}
                <option value={city.citySlug}>
                  {cityLabel(city.citySlug)}
                  {#if city.zoneCount > 0}
                    ({city.zoneCount} zones)
                  {:else if city.signalCount > 0}
                    ({city.signalCount} signaux)
                  {/if}
                </option>
              {/each}
            </select>
            <ChevronDown
              class="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
          </div>
        {/if}
      </div>

      <!-- Compteurs données -->
      {#if selectedCity && !dataLoading}
        <div class="rounded-md border border-slate-100 bg-slate-50 p-3 text-xs">
          <p class="mb-2 font-medium text-slate-700">Données chargées</p>
          <div class="space-y-1">
            <div class="flex justify-between">
              <span class="text-slate-500">Zones</span>
              <span class="font-semibold text-slate-800">{zonesCount}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Lots</span>
              <span class="font-semibold text-slate-800">{lotsCount}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Opportunités</span>
              <span class="font-semibold text-slate-800">{oppsCount}</span>
            </div>
          </div>
          {#if zonesCount === 0 && lotsCount === 0 && oppsCount === 0}
            <p class="mt-2 text-slate-400 italic text-xs">
              Aucune donnée géoréférencée pour cette ville.
            </p>
          {/if}
        </div>
      {:else if dataLoading}
        <div class="flex items-center gap-2 text-xs text-slate-500">
          <RefreshCw class="h-3 w-3 animate-spin" aria-hidden="true" />
          Chargement…
        </div>
      {/if}

      {#if dataError}
        <p class="rounded-md bg-red-50 p-2 text-xs text-red-600">{dataError}</p>
      {/if}
    </div>
  </svelte:fragment>

  <!-- Légende -->
  <svelte:fragment slot="controls-footer">
    <div class="border-t border-slate-100 bg-white p-3">
      <button
        type="button"
        class="mb-2 flex w-full items-center justify-between text-xs font-medium text-slate-600 hover:text-slate-800"
        on:click={() => (showLegend = !showLegend)}
      >
        <span>Légende</span>
        <ChevronDown
          class={`h-3.5 w-3.5 shrink-0 transition-transform ${showLegend ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {#if showLegend}
        <div class="space-y-1.5">
          {#each LAYER_LABELS as item}
            <div class="flex items-center gap-2">
              <span
                class="h-3 w-5 shrink-0 rounded-sm"
                style={`background:${item.color};opacity:0.7`}
              ></span>
              <span class="text-xs text-slate-600 truncate">{item.label}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </svelte:fragment>

  <!-- Zone principale : carte + panneau détail -->
  <div class="relative flex h-full flex-1 overflow-hidden">
    <!-- Carte MapLibre -->
    <div bind:this={mapContainer} class="flex-1 h-full bg-slate-100">
      {#if !mapReady}
        <div class="flex h-full items-center justify-center text-slate-400 text-sm">
          <RefreshCw class="h-5 w-5 animate-spin mr-2" aria-hidden="true" />
          Initialisation de la carte…
        </div>
      {/if}
    </div>

    <!-- Empty-state si pas de ville sélectionnée et carte prête -->
    {#if mapReady && !selectedCity && !citiesLoading}
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div class="pointer-events-auto max-w-sm rounded-xl border border-slate-200 bg-white/90 p-6 shadow-lg text-center">
          <MapPin class="mx-auto mb-3 h-8 w-8 text-teal-500" aria-hidden="true" />
          <p class="text-sm font-semibold text-slate-800 mb-1">Aucune ville sélectionnée</p>
          {#if cities.length === 0}
            <p class="text-xs text-slate-500">
              Aucune donnée géoréférencée n'est encore disponible.<br />
              Les zones et lots seront affichés dès que le pipeline
              d'acquisition géo aura peuplé la base.
            </p>
          {:else}
            <p class="text-xs text-slate-500">
              Sélectionnez une municipalité dans le panneau de gauche
              pour afficher les zones, lots et opportunités.
            </p>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Empty-state si ville sélectionnée mais aucune donnée -->
    {#if mapReady && selectedCity && !dataLoading && zonesCount === 0 && lotsCount === 0 && oppsCount === 0 && !dataError}
      <div class="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
        <div class="pointer-events-auto rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 shadow text-center">
          <Info class="mx-auto mb-1 h-5 w-5 text-amber-500" aria-hidden="true" />
          <p class="text-xs font-medium text-amber-800">
            Aucune donnée géo disponible pour {cityLabel(selectedCity)}.
          </p>
          <p class="text-xs text-amber-700 mt-0.5">
            La couche de zonage vectorielle n'a pas encore été acquise pour cette ville.
          </p>
        </div>
      </div>
    {/if}

    <!-- Panneau de détail -->
    {#if selectedFeature && selectedSchema}
      <div class="absolute right-0 top-0 bottom-0 w-80 overflow-y-auto bg-white shadow-xl border-l border-slate-200 flex flex-col">
        <!-- En-tête panneau -->
        <div class="flex items-center justify-between border-b border-slate-100 p-4 bg-slate-50">
          <div>
            <p class="text-xs text-slate-500 uppercase tracking-wide font-medium">
              {#if selectedFeature.properties["featureKind"] === "zone"}
                Zone de zonage
              {:else if selectedFeature.properties["featureKind"] === "lot"}
                Lot cadastral
              {:else}
                Opportunité
              {/if}
            </p>
            <p class="text-sm font-semibold text-slate-900 mt-0.5 truncate">
              {featureTitle(selectedFeature, selectedSchema)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Fermer le panneau"
            on:click={() => { selectedFeature = null; selectedSchema = null; }}
            class="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
          >
            <X class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <!-- Badge catégorie -->
        {#if selectedFeature.properties["category"]}
          {@const catColor = getCategoryColor(String(selectedFeature.properties["category"]))}
          {@const catLabel = getCategoryLabel(String(selectedFeature.properties["category"]))}
          <div class="px-4 pt-3">
            <span
              class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
              style={`background:${catColor}`}
            >
              {catLabel}
            </span>
          </div>
        {/if}

        <!-- Champs de détail -->
        <div class="flex-1 divide-y divide-slate-50 px-4 py-2">
          {#each selectedSchema.fields as field}
            {@const val = selectedFeature.properties[field.key]}
            {#if val !== null && val !== undefined && val !== ""}
              <div class="py-2.5">
                <p class="text-xs text-slate-400 font-medium">{field.labelFr}</p>
                {#if field.kind === "url"}
                  <a
                    href={String(val)}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-sm text-teal-600 hover:underline break-all"
                  >{String(val)}</a>
                {:else}
                  <p class="text-sm text-slate-800 mt-0.5">
                    {renderFieldValue(field.key, val, field.kind)}
                  </p>
                {/if}
              </div>
            {/if}
          {/each}
        </div>

        <!-- Footer Loi 25 -->
        <div class="border-t border-slate-100 p-3">
          <p class="text-xs text-slate-400 italic">
            Données de zonage publiques — aucune PII (Loi 25).
          </p>
        </div>
      </div>
    {/if}
  </div>
</ViewLayout>

<style>
  :global(.maplibregl-ctrl-attrib) {
    font-size: 10px;
  }
</style>
