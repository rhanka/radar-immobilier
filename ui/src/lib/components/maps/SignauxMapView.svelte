<script lang="ts">
  /**
   * SignauxMapView — Vue Signaux Phase 1 — layout 3 colonnes.
   *
   * Layout ws-shell (graphify) :
   *   RAIL (menu gauche w-80) | CANVAS (carte MapLibre) | SEL (panneau droit w-80)
   *
   * - Rail gauche : SignauxRail (recherche + facets + accordéon natif)
   * - Canvas : MapLibre GL aplats choroplèthe + flyTo au clic ville
   * - Sel droit : SignauxSelPanel (détail ville + nœuds par type)
   * - Légende épinglée en bas du rail (slot controls-footer ViewLayout)
   *
   * Garde-fous Phase 1 :
   *  - NE swap PAS MapLibre
   *  - NE touche PAS API/OIDC/PG/geo
   *  - NE déclenche PAS l'activation zonage-au-zoom (Phase 2)
   */
  import { onMount, onDestroy } from "svelte";
  import { RefreshCw } from "@lucide/svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import SignauxRail from "$lib/components/maps/SignauxRail.svelte";
  import SignauxSelPanel from "$lib/components/maps/SignauxSelPanel.svelte";
  import {
    buildCityMapEntries,
    type CityMapEntry,
  } from "$lib/maps/maps-data.js";
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
  let graphItems: { citySlug: string; signalCount: number; subsetCounts: Record<string, number> }[] = [];

  // ── Détail ville sélectionnée ──────────────────────────────────────────────
  let detailLoading = false;
  let detailError: string | null = null;
  let detailNodes: GraphSignalNode[] = [];

  // ── Cache multi-villes : types vus + nœuds par ville ──────────────────────
  /** Accumule les types de nœuds vus au fil des villes cliquées. */
  let knownNodeTypes: string[] = [];
  /** Cache des nœuds détail par ville slug (pour recoloration aplats filtrée). */
  const detailCache = new Map<string, GraphSignalNode[]>();

  // ── Filtre GLOBAL (axes combinables) ──────────────────────────────────────
  /** Clé active = combinaison des toggles actifs : "", "z", "m", "p", "z|m", etc. */
  let activeSubsetKey = "z"; // défaut : zonageOnly ON

  function handleFilterChange(
    subsetKey: string,
  ): void {
    activeSubsetKey = subsetKey;
    updateFillColors();
  }

  // ── Données réactives ──────────────────────────────────────────────────────
  $: allEntries = buildCityMapEntries(graphItems);

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
   * selon le compte actif exact (subsetCounts[activeSubsetKey]).
   */
  function buildFillColorExpression(
    entries: CityMapEntry[],
  ): ExpressionSpecification {
    const expr: unknown[] = ["match", ["get", "citySlug"]];
    for (const e of entries) {
      const count = (e.subsetCounts[activeSubsetKey] ?? 0);
      expr.push(e.municipality.slug, signalCountColor(count));
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

  /**
   * Effectue un flyTo sur la carte vers la ville sélectionnée.
   * Utilise les coordonnées WGS-84 du centroïde (MunicipalityT.lon/lat).
   */
  function flyToCity(entry: CityMapEntry): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      flyTo: (options: { center: [number, number]; zoom: number; duration: number }) => void;
    };
    m.flyTo({
      center: [entry.municipality.lon, entry.municipality.lat],
      zoom: 12,
      duration: 800,
    });
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
      // Deuxième clic sur la même ville : désélectionne
      selectedCity = null;
      detailNodes = [];
      detailError = null;
      return;
    }
    selectedCity = entry;
    detailNodes = [];
    detailError = null;
    detailLoading = true;

    // flyTo sur la carte (centroïde de la ville)
    flyToCity(entry);

    try {
      const res = await fetchGraphSignalDetail(entry.municipality.slug);
      detailNodes = res.nodes;
      // Alimenter le cache multi-villes et accumuler les types connus
      detailCache.set(entry.municipality.slug, res.nodes);
      const newTypes = res.nodes.map((n) => n.type);
      knownNodeTypes = Array.from(new Set([...knownNodeTypes, ...newTypes])).sort();
      // Recolorer les aplats avec les nouvelles données en cache
      updateFillColors();
    } catch (e) {
      detailError = e instanceof Error ? e.message : "Erreur chargement détail";
    } finally {
      detailLoading = false;
    }
  }

  function clearSelection(): void {
    selectedCity = null;
    detailNodes = [];
    detailError = null;
  }

  // ── Chargement API ─────────────────────────────────────────────────────────
  async function load() {
    loading = true;
    loadError = null;
    try {
      const res = await fetchGraphSignalsByCity();
      graphItems = res.cities;
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Erreur de chargement";
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
    void initMap();
  });
</script>

<ViewLayout controlsWidth="w-80" stickyControlsFooter selWidth="w-80">
  <!-- ── RAIL gauche : recherche + facets + accordéon villes ─────────────── -->
  <svelte:fragment slot="controls">
    {#if loadError}
      <div class="px-4 py-2 text-xs text-red-600 border-b border-red-100 bg-red-50">
        {loadError} — données indisponibles, compteurs à 0.
      </div>
    {/if}
    <SignauxRail
      entries={allEntries}
      selectedSlug={selectedCity?.municipality.slug ?? null}
      {detailNodes}
      {knownNodeTypes}
      {loading}
      {detailLoading}
      onSelectCity={selectCity}
      onRefresh={load}
      onFilterChange={handleFilterChange}
    />
  </svelte:fragment>

  <!-- Légende choroplèthe épinglée en bas du rail -->
  <svelte:fragment slot="controls-footer">
    <div class="p-4">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Légende — signaux / ville</p>
      <ul class="space-y-1">
        {#each [
          { color: "#ef4444", label: "6+ signaux" },
          { color: "#f97316", label: "3–5 signaux" },
          { color: "#fbbf24", label: "1–2 signaux" },
          { color: "#e2e8f0", label: "Aucun signal (0)" },
        ] as item (item.label)}
          <li class="flex items-center gap-2 text-xs text-slate-600">
            <span class="h-3 w-3 rounded-sm border border-slate-300 shrink-0" style="background-color: {item.color};"></span>
            {item.label}
          </li>
        {/each}
      </ul>
    </div>
  </svelte:fragment>

  <!-- ── CANVAS : carte MapLibre ──────────────────────────────────────────── -->
  <div class="relative h-full w-full overflow-hidden">
    <div bind:this={mapContainer} class="absolute inset-0"></div>
    {#if !mapReady}
      <div class="absolute inset-0 flex items-center justify-center bg-slate-100">
        <span class="text-xs text-slate-400">Chargement de la carte…</span>
      </div>
    {/if}
  </div>

  <!-- ── SEL droit : panneau de sélection ville ───────────────────────────── -->
  <svelte:fragment slot="sel">
    <SignauxSelPanel
      {selectedCity}
      {detailNodes}
      {detailLoading}
      {detailError}
      onClear={clearSelection}
    />
  </svelte:fragment>
</ViewLayout>
