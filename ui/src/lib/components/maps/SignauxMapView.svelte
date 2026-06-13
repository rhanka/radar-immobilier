<script lang="ts">
  /**
   * SignauxMapView — Vue Signaux (maille Québec→villes) — WP A.1.
   *
   * Carte du Québec avec les villes prioritisées colorées par le nb de signaux
   * de changements de zonage sur 6 mois (fenêtre glissante).
   *
   * Rendu : MapLibre GL + couche fill polygonale (choroplèthe aplats) depuis
   * municipalities.geojson (StatCan CSD 2025, 1104 villes QC).
   * Jointure par citySlug (propriété GeoJSON) ↔ API /api/graph-signals/by-city.
   *
   * Source des données : GET /api/graph-signals/by-city — compte les nœuds
   * Signal + DesignationEvent par ville depuis graph_nodes (graphify pipeline).
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
  import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

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
  let mapInstance: unknown = null;
  let mapReady = false;

  /**
   * Couleur hex pour le rendu MapLibre selon le nb de signaux.
   * Rampe séquentielle : gris neutre → jaune → orange → rouge.
   */
  function signalCountColor(count: number): string {
    if (count === 0) return "#e2e8f0"; // slate-200 (neutre)
    if (count <= 2) return "#fbbf24"; // amber-400
    if (count <= 5) return "#f97316"; // orange-500
    return "#ef4444"; // red-500
  }

  /**
   * Expression MapLibre "match" pour colorier les polygones par citySlug
   * selon le dictionnaire count → color.
   * Villes sans donnée → couleur neutre.
   */
  function buildFillColorExpression(
    entries: CityMapEntry[],
  ): ExpressionSpecification {
    const expr: unknown[] = ["match", ["get", "citySlug"]];
    for (const e of entries) {
      expr.push(e.municipality.slug, signalCountColor(e.signalCount6m));
    }
    expr.push("#e2e8f0"); // fallback pour villes sans data
    return expr as ExpressionSpecification;
  }

  /** Met à jour la peinture fill quand les données changent. */
  function updateFillColors(): void {
    if (!mapInstance || !mapReady || allEntries.length === 0) return;
    const m = mapInstance as {
      setPaintProperty: (layer: string, prop: string, value: unknown) => void;
    };
    m.setPaintProperty(
      "cities-fill",
      "fill-color",
      buildFillColorExpression(allEntries),
    );
  }

  // Met à jour la carte quand les données changent
  $: if (mapReady && allEntries.length > 0) {
    updateFillColors();
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

      m.on("load", async () => {
        // Fetch GeoJSON polygones municipaux (asset statique servi par nginx)
        let polygonsData: unknown = { type: "FeatureCollection", features: [] };
        try {
          const resp = await fetch("/municipalities.geojson");
          if (resp.ok) {
            polygonsData = await resp.json();
          } else {
            console.warn("municipalities.geojson fetch failed:", resp.status);
          }
        } catch (err) {
          console.warn("municipalities.geojson fetch error:", err);
        }

        // Source GeoJSON polygones (aplats)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        m.addSource("cities-polygons", {
          type: "geojson",
          data: polygonsData as any,
        });

        // Couche aplat fill choroplèthe
        m.addLayer({
          id: "cities-fill",
          type: "fill",
          source: "cities-polygons",
          paint: {
            "fill-color": buildFillColorExpression(allEntries),
            "fill-opacity": 0.75,
            "fill-outline-color": "#94a3b8", // slate-400
          },
        });

        // Couche contour fill (plus visible)
        m.addLayer({
          id: "cities-outline",
          type: "line",
          source: "cities-polygons",
          paint: {
            "line-color": "#64748b", // slate-500
            "line-width": 0.5,
            "line-opacity": 0.4,
          },
        });

        // Couche labels sur les polygones avec signaux
        m.addLayer({
          id: "cities-label",
          type: "symbol",
          source: "cities-polygons",
          layout: {
            "text-field": ["get", "name"],
            "text-size": 11,
            "text-anchor": "center",
            "text-optional": true,
          },
          paint: {
            "text-color": "#1e293b",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.5,
          },
          // Labels uniquement sur les villes avec signaux (données dynamiques →
          // on les active après update)
        });

        // Interaction clic sur les aplats
        m.on("click", "cities-fill", (e) => {
          const features = e.features;
          if (!features || features.length === 0) return;
          const props = features[0].properties as {
            citySlug: string;
            name: string;
            mrc: string;
          };
          const entry = allEntries.find(
            (ent) => ent.municipality.slug === props.citySlug,
          );
          if (entry) void selectCity(entry);
        });

        m.on("mouseenter", "cities-fill", () => {
          m.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", "cities-fill", () => {
          m.getCanvas().style.cursor = "";
        });

        mapReady = true;
        // Injecter les couleurs si les données API sont déjà chargées
        if (allEntries.length > 0) updateFillColors();
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

    <!-- Liste des villes avec signaux (en premier), puis les autres -->
    <ul class="divide-y divide-slate-100 overflow-y-auto" style="max-height: calc(100vh - 200px);">
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
            <!-- Carré couleur signal (aplat) -->
            <span
              class="h-3 w-3 shrink-0 rounded-sm"
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

    <!-- Légende choroplèthe aplats -->
    <div class="border-t border-slate-100 p-4">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Légende — signaux / ville</p>
      <ul class="space-y-1">
        {#each [
          { color: "#ef4444", label: "6+ signaux" },
          { color: "#f97316", label: "3–5 signaux" },
          { color: "#fbbf24", label: "1–2 signaux" },
          { color: "#e2e8f0", label: "Aucun signal (0)" },
        ] as item (item.label)}
          <li class="flex items-center gap-2 text-xs text-slate-600">
            <span class="h-3 w-3 rounded-sm border border-slate-300" style="background-color: {item.color};"></span>
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
          Cliquez sur un aplat ou une ville dans la liste pour voir ses signaux de changements de zonage.
        </p>
      </div>
    {/if}
  </div>
</ViewLayout>
