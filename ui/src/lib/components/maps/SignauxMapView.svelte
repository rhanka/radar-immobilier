<script lang="ts">
  /**
   * SignauxMapView — Vue Signaux (maille Québec→villes) — WP A.1.
   *
   * Carte du Québec avec les villes prioritisées colorées par le nb de signaux
   * de changements de zonage sur 6 mois (fenêtre glissante).
   *
   * Rendu : MapLibre GL + couche GeoJSON de cercles (bubble choroplèthe).
   * NOTICE polygones : les limites polygonales des municipalités du Québec ne
   * sont pas encore intégrées dans ce projet (source A11 StatCan / Données
   * Québec non encore téléchargée). La choroplèthe utilise donc des disques
   * de rayon proportionnel au compteur. Pour des aplats polygonaux réels il
   * faudra intégrer le fichier `lcsd000b21a_e.zip` (StatCan 2021) ou
   * l'API WFS de Données Québec.
   *
   * Source des données : GET /api/graph-signals/by-city — compte les nœuds
   * Signal + DesignationEvent par ville depuis graph_nodes (graphify pipeline,
   * ~197 villes).
   *
   * Anti-invention : seules les villes avec au moins un nœud Signal ont un
   * compteur > 0. Toutes les autres villes affichent 0. Aucun signal n'est
   * inventé. Couleurs dérivées des comptes réels de l'API.
   */
  import { onMount, onDestroy } from "svelte";
  import { Map as MapIcon, Radio, RefreshCw, AlertTriangle } from "@lucide/svelte";
  import { Badge, Alert } from "@sentropic/design-system-svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import {
    buildCityMapEntries,
    signalCountTier,
    type CityMapEntry,
  } from "$lib/maps/maps-data.js";
  import type { SignalCityItem } from "$lib/signals/signals-by-city-client.js";
  import {
    fetchGraphSignalsByCity,
  } from "$lib/signals/graph-signals-by-city-client.js";
  import {
    fetchGraphSignalDetail,
    type GraphSignalNode,
  } from "$lib/signals/graph-signal-detail-client.js";

  // ── State ──────────────────────────────────────────────────────────────────
  let selectedCity: CityMapEntry | null = null;
  let loading = true;
  let loadError: string | null = null;
  let apiItems: SignalCityItem[] = [];

  // ── Détail ville sélectionnée ──────────────────────────────────────────────
  let detailLoading = false;
  let detailError: string | null = null;
  let detailNodes: GraphSignalNode[] = [];

  // ── Données réactives ──────────────────────────────────────────────────────
  $: allEntries = buildCityMapEntries(apiItems);

  // ── Compteurs globaux ──────────────────────────────────────────────────────
  $: totalSignals = allEntries.reduce((s, e) => s + e.signalCount6m, 0);
  $: citiesWithSignals = allEntries.filter((e) => e.signalCount6m > 0).length;

  // ── MapLibre ───────────────────────────────────────────────────────────────
  let mapContainer: HTMLDivElement;
  let mapInstance: unknown = null; // maplibregl.Map — typé large pour éviter la dépendance au build
  let mapReady = false;

  /**
   * Couleur hex pour le rendu MapLibre selon le nb de signaux.
   * Correspond à la même échelle 4-tiers que signalCountTier().
   */
  function signalCountColor(count: number): string {
    if (count === 0) return "#cbd5e1"; // slate-300
    if (count <= 2) return "#fbbf24"; // amber-400
    if (count <= 5) return "#f97316"; // orange-500
    return "#ef4444"; // red-500
  }

  /**
   * Rayon du cercle en pixels selon le nb de signaux (bubble map).
   * Plus le nb est grand, plus le disque est grand — rendu "aplat" visible.
   */
  function signalCountRadius(count: number): number {
    if (count === 0) return 8;
    if (count <= 2) return 14;
    if (count <= 5) return 20;
    return 28;
  }

  /** Type minimal FeatureCollection (points uniquement) — @types/geojson non requis. */
  interface CityFeature {
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { slug: string; name: string; mrc: string; count: number; color: string; radius: number };
  }
  interface CityFeatureCollection {
    type: "FeatureCollection";
    features: CityFeature[];
  }

  /** Construit un GeoJSON FeatureCollection à partir des entrées de villes. */
  function buildGeoJsonSource(entries: CityMapEntry[]): CityFeatureCollection {
    return {
      type: "FeatureCollection",
      features: entries.map((e) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [e.municipality.lon, e.municipality.lat] as [number, number],
        },
        properties: {
          slug: e.municipality.slug,
          name: e.municipality.name,
          mrc: e.municipality.mrc ?? "",
          count: e.signalCount6m,
          color: signalCountColor(e.signalCount6m),
          radius: signalCountRadius(e.signalCount6m),
        },
      })),
    };
  }

  /** Met à jour la source GeoJSON si la carte est prête. */
  function updateMapSource(): void {
    if (!mapInstance || !mapReady || allEntries.length === 0) return;
    const m = mapInstance as {
      getSource: (id: string) => { setData: (data: CityFeatureCollection) => void } | undefined;
    };
    const src = m.getSource("cities");
    if (src) {
      src.setData(buildGeoJsonSource(allEntries));
    }
  }

  // Met à jour la carte quand les données changent
  $: if (mapReady && allEntries.length > 0) {
    updateMapSource();
  }

  async function initMap(): Promise<void> {
    if (!mapContainer) return;
    try {
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
              id: "osm-background",
              type: "raster",
              source: "osm-tiles",
              paint: { "raster-opacity": 0.6 },
            },
          ],
        },
        center: [-73.5, 45.7],
        zoom: 7,
        maxBounds: [[-85, 41], [-55, 63]],
      });

      m.on("load", () => {
        // Source GeoJSON villes (cercles)
        m.addSource("cities", {
          type: "geojson",
          data: buildGeoJsonSource(allEntries),
        });

        // Couche disques remplis (choroplèthe bubble)
        m.addLayer({
          id: "cities-fill",
          type: "circle",
          source: "cities",
          paint: {
            "circle-radius": ["get", "radius"],
            "circle-color": ["get", "color"],
            "circle-opacity": 0.75,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#fff",
          },
        });

        // Couche labels (nom de ville si count > 0 ou hover)
        m.addLayer({
          id: "cities-label",
          type: "symbol",
          source: "cities",
          layout: {
            "text-field": ["get", "name"],
            "text-size": 11,
            "text-offset": [0, 1.5],
            "text-anchor": "top",
            "text-optional": true,
          },
          paint: {
            "text-color": "#334155",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1,
          },
          filter: [">", ["get", "count"], 0],
        });

        // Interaction clic
        m.on("click", "cities-fill", (e) => {
          const features = e.features;
          if (!features || features.length === 0) return;
          const props = features[0].properties as {
            slug: string;
            name: string;
            mrc: string;
            count: number;
          };
          const entry = allEntries.find((e) => e.municipality.slug === props.slug);
          if (entry) void selectCity(entry);
        });

        m.on("mouseenter", "cities-fill", () => {
          m.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", "cities-fill", () => {
          m.getCanvas().style.cursor = "";
        });

        mapReady = true;
        // Injecter les données si déjà chargées
        if (allEntries.length > 0) updateMapSource();
      });

      mapInstance = m;
    } catch (err) {
      console.error("MapLibre init error", err);
    }
  }

  onDestroy(() => {
    if (mapInstance) {
      (mapInstance as { remove: () => void }).remove();
      mapInstance = null;
    }
  });

  // ── Ville sélectionnée ─────────────────────────────────────────────────────
  async function selectCity(entry: CityMapEntry): Promise<void> {
    if (selectedCity?.municipality.slug === entry.municipality.slug) {
      selectedCity = null;
      detailNodes = [];
      detailError = null;
      return;
    }
    selectedCity = entry;
    detailNodes = [];
    detailError = null;
    detailLoading = true;
    try {
      const res = await fetchGraphSignalDetail(entry.municipality.slug);
      detailNodes = res.nodes;
    } catch (e) {
      detailError = e instanceof Error ? e.message : "Erreur chargement détail";
    } finally {
      detailLoading = false;
    }
  }

  // ── Aperçu de ville dans la liste (hover) ─────────────────────────────────
  let hoveredSlug: string | null = null;

  // ── Chargement API ─────────────────────────────────────────────────────────
  async function load() {
    loading = true;
    loadError = null;
    try {
      const res = await fetchGraphSignalsByCity();
      // Adapter le format graph (signalCount) vers le format SignalCityItem (designationEventCount)
      // pour réutiliser buildCityMapEntries sans modifier maps-data.ts.
      apiItems = res.cities.map((c) => ({
        citySlug: c.citySlug,
        designationEventCount: c.signalCount,
        generatedAt: null,
      }));
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Erreur de chargement";
      apiItems = [];
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
    void initMap();
  });
</script>

<ViewLayout controlsWidth="w-80">
  <!-- ── Left sidebar: city list ───────────────────────────────────────────── -->
  <svelte:fragment slot="controls">
    <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <h1 class="flex items-center gap-2 text-sm font-bold text-slate-900">
        <Radio class="h-4 w-4 text-teal-600" aria-hidden="true" />
        Signaux : Villes
      </h1>
      <div class="flex items-center gap-2">
        <span class="text-xs text-slate-400">graph_nodes</span>
        <button
          type="button"
          aria-label="Actualiser"
          class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          on:click={load}
          disabled={loading}
        >
          <RefreshCw
            class={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>

    {#if loadError}
      <div class="px-4 py-2 text-xs text-red-600">
        {loadError} (compteurs affichés à 0, données indisponibles)
      </div>
    {/if}

    <!-- Compteur global -->
    <div class="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
      {#if loading}
        <span class="text-slate-400">Chargement…</span>
      {:else}
        <span class="font-semibold text-slate-700">{totalSignals}</span> signal{totalSignals !== 1 ? "s" : ""} ·
        <span class="font-semibold text-slate-700">{citiesWithSignals}</span> ville{citiesWithSignals !== 1 ? "s" : ""}
      {/if}
    </div>

    <!-- Avis absence polygones municipaux -->
    <div class="border-b border-amber-100 bg-amber-50 px-4 py-2">
      <p class="flex items-start gap-1.5 text-xs text-amber-700">
        <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Aplats circulaires (limites polygonales QC non intégrées — source StatCan A11 requise).
        </span>
      </p>
    </div>

    <!-- Liste des villes avec signaux (en premier), puis les autres -->
    <ul class="divide-y divide-slate-100 overflow-y-auto" style="max-height: calc(100vh - 220px);">
      {#each allEntries.slice(0, 40) as entry (entry.municipality.slug)}
        {@const tier = signalCountTier(entry.signalCount6m)}
        {@const isSelected = selectedCity?.municipality.slug === entry.municipality.slug}
        <li>
          <button
            type="button"
            class={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
              isSelected ? "bg-teal-50" : "hover:bg-slate-50"
            }`}
            on:click={() => selectCity(entry)}
            on:mouseenter={() => { hoveredSlug = entry.municipality.slug; }}
            on:mouseleave={() => { hoveredSlug = null; }}
          >
            <!-- Disque couleur signal -->
            <span
              class="h-3 w-3 shrink-0 rounded-full"
              style="background-color: {signalCountColor(entry.signalCount6m)};"
              aria-hidden="true"
            ></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-slate-900">
                {entry.municipality.name}
              </span>
              {#if entry.municipality.mrc}
                <span class="block truncate text-xs text-slate-400">{entry.municipality.mrc}</span>
              {/if}
            </span>
            {#if entry.signalCount6m > 0}
              <Badge tone="warning" class="shrink-0 text-xs">
                {entry.signalCount6m}
              </Badge>
            {:else}
              <span class="text-xs text-slate-300">0</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>

    <!-- Légende choroplèthe -->
    <div class="border-t border-slate-100 p-4">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Légende — signaux / ville</p>
      <ul class="space-y-1">
        {#each [
          { color: "#ef4444", label: "6+ signaux" },
          { color: "#f97316", label: "3–5 signaux" },
          { color: "#fbbf24", label: "1–2 signaux" },
          { color: "#cbd5e1", label: "Aucun signal (0)" },
        ] as item (item.label)}
          <li class="flex items-center gap-2 text-xs text-slate-600">
            <span class="h-3 w-3 rounded-full" style="background-color: {item.color};"></span>
            {item.label}
          </li>
        {/each}
      </ul>
    </div>
  </svelte:fragment>

  <!-- ── Main: carte MapLibre + détail ville ────────────────────────────────── -->
  <div class="flex h-full flex-col bg-slate-50 gap-0">
    <!-- Carte MapLibre -->
    <div class="relative flex-1 rounded-none overflow-hidden border-b border-slate-200">
      <div bind:this={mapContainer} class="absolute inset-0"></div>
      {#if !mapReady}
        <div class="absolute inset-0 flex items-center justify-center bg-slate-100">
          <span class="text-xs text-slate-400">Chargement de la carte…</span>
        </div>
      {/if}
    </div>

    <!-- Détail ville sélectionnée -->
    {#if selectedCity}
      <div class="overflow-y-auto border-t border-slate-200 bg-white p-4" style="max-height: 300px;">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <h2 class="text-base font-semibold text-slate-900">
              {selectedCity.municipality.name}
            </h2>
            {#if selectedCity.municipality.mrc}
              <p class="text-xs text-slate-400 mt-0.5">MRC : {selectedCity.municipality.mrc}</p>
            {/if}
            <p class="text-xs text-slate-500 mt-0.5">
              {selectedCity.signalCount6m} signal{selectedCity.signalCount6m !== 1 ? "s" : ""} (graph_nodes)
            </p>
          </div>
          <button
            type="button"
            class="text-xs text-slate-400 hover:text-slate-600"
            on:click={() => {
              selectedCity = null;
              detailNodes = [];
              detailError = null;
            }}
            aria-label="Fermer le détail"
          >✕</button>
        </div>

        {#if detailLoading}
          <div class="flex items-center gap-2 py-3 text-xs text-slate-400">
            <RefreshCw class="h-4 w-4 animate-spin" aria-hidden="true" />
            Chargement des signaux…
          </div>
        {:else if detailError}
          <Alert
            tone="error"
            title="Erreur de chargement du détail"
            message={detailError}
          />
        {:else if detailNodes.length === 0}
          <Alert
            tone="info"
            title="Aucun signal disponible pour cette ville."
            message="Les données sont dérivées des nœuds Signal/DesignationEvent de graph_nodes. Cette ville n'a pas encore de nœuds indexés."
          />
        {:else}
          <ul class="space-y-3" aria-label="Signaux de changements de zonage">
            {#each detailNodes as node, i (node.id)}
              <li class="rounded-lg border border-teal-100 bg-teal-50 px-4 py-3">
                <p class="text-sm font-semibold text-teal-800 leading-snug">
                  {node.label}
                </p>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  {#if node.props?.reglement_number}
                    <Badge tone="info" class="text-xs font-mono">
                      Règl. {node.props.reglement_number}
                    </Badge>
                  {/if}
                  {#if node.props?.zone_ref}
                    <Badge tone="warning" class="text-xs font-mono">
                      Zone {node.props.zone_ref}
                    </Badge>
                  {/if}
                </div>
                {#if node.sourceRef}
                  <p class="mt-1.5 truncate text-xs text-teal-500" title={node.sourceRef}>
                    Source : <span class="font-mono">{node.sourceRef}</span>
                  </p>
                {/if}
                {#if node.createdAt}
                  <p class="mt-0.5 text-xs text-slate-400">
                    Créé : {new Date(node.createdAt).toLocaleDateString("fr-CA")}
                  </p>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {:else}
      <div class="flex items-center justify-center border-t border-slate-100 bg-white p-4 text-center" style="min-height: 80px;">
        <p class="text-xs text-slate-400">
          Cliquez sur un disque ou une ville pour voir ses signaux de changements de zonage.
        </p>
      </div>
    {/if}
  </div>
</ViewLayout>
