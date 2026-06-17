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
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import SignauxRail from "$lib/components/maps/SignauxRail.svelte";
  import SignauxSelPanel from "$lib/components/maps/SignauxSelPanel.svelte";
  import DocumentOverlay from "$lib/components/maps/DocumentOverlay.svelte";
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
    type SignalDocRef,
  } from "$lib/signals/graph-signal-detail-client.js";
  import {
    fetchGeoZones,
    type GeoZonesResponse,
    type GeoZoneFeatureCollection,
  } from "$lib/maps/geo-zones-client.js";
  import {
    fetchLots,
    type LotFeatureCollection,
    type LotsResponse,
  } from "$lib/maps/lots-client.js";
  import {
    createSelectionBucketState,
    makeKey,
    parseKey,
    setFocus,
    toggleSelection,
    type SelectionBucketState,
    type SelectionKey,
  } from "$lib/maps/selection-bucket.js";
  import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

  const EMPTY_ZONES: GeoZoneFeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  const EMPTY_LOTS: LotFeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };

  function emptyUnconfiguredZones(citySlug: string): GeoZonesResponse {
    return {
      ok: false,
      citySlug,
      source: "none",
      resolutionStatus: "missing",
      geometryStatus: "missing",
      zoneCount: 0,
      warnings: ["geo-collection-not-configured"],
      featureCollection: EMPTY_ZONES,
    };
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let selectedCity: CityMapEntry | null = null;
  let loading = true;
  let loadError: string | null = null;
  let graphItems: { citySlug: string; signalCount: number; subsetCounts: Record<string, number> }[] = [];
  let selectionState: SelectionBucketState = createSelectionBucketState();

  // ── Détail ville sélectionnée ──────────────────────────────────────────────
  let detailLoading = false;
  let detailError: string | null = null;
  let detailNodes: GraphSignalNode[] = [];
  let geoLoading = false;
  let geoError: string | null = null;
  let zonesResponse: GeoZonesResponse | null = null;
  let lotsResponse: LotsResponse | null = null;
  let activeDocument: SignalDocRef | null = null;

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

  function buildFillOpacityExpression(
    entries: CityMapEntry[],
  ): ExpressionSpecification {
    const selectedCityKeys = selectedKeysForKind("municipality");
    const hasCitySelection = selectedCityKeys.size > 0;
    const expr: unknown[] = ["match", ["get", "citySlug"]];
    for (const entry of entries) {
      const key = makeKey("municipality", entry.municipality.slug);
      expr.push(
        entry.municipality.slug,
        hasCitySelection && !selectedCityKeys.has(key) ? 0.38 : 0.75,
      );
    }
    expr.push(hasCitySelection ? 0.38 : 0.75);
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
    m.setPaintProperty(
      "cities-fill",
      "fill-opacity",
      buildFillOpacityExpression(allEntries),
    );
  }

  // Met à jour la carte quand les données changent
  $: if (mapReady && allEntries.length > 0) {
    updateFillColors();
  }

  $: if (mapReady) {
    updateGeoLayers();
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
            "fill-opacity": buildFillOpacityExpression(allEntries),
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
        updateGeoLayers();
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
      clearSelection();
      return;
    }
    selectedCity = entry;
    detailNodes = [];
    detailError = null;
    detailLoading = true;
    const cityKey = makeKey("municipality", entry.municipality.slug);
    selectionState = createSelectionBucketState({
      selectedKeys: [cityKey],
      focusedKey: cityKey,
      expandedKeys: [cityKey],
    });
    void loadGeoForCity(entry.municipality.slug);
    updateFillColors();

    // flyTo sur la carte (centroïde de la ville)
    flyToCity(entry);

    try {
      const res = await fetchGraphSignalDetail(entry.municipality.slug);
      if (selectedCity?.municipality.slug !== entry.municipality.slug) return;
      detailNodes = res.nodes;
      // Alimenter le cache multi-villes et accumuler les types connus
      detailCache.set(entry.municipality.slug, res.nodes);
      const newTypes = res.nodes.map((n) => n.type);
      knownNodeTypes = Array.from(new Set([...knownNodeTypes, ...newTypes])).sort();
      const firstSignal = res.nodes[0] ?? null;
      if (firstSignal && selectionState.focusedKey === cityKey) {
        try {
          const firstSignalKey = makeKey("signal", firstSignal.id);
          selectionState = createSelectionBucketState({
            selectedKeys: [...selectionState.selectedKeys, firstSignalKey],
            focusedKey: firstSignalKey,
            hoveredKey: selectionState.hoveredKey,
            expandedKeys: [...selectionState.expandedKeys, firstSignalKey],
          });
        } catch {
          // Ignore malformed graph ids; the city selection remains valid.
        }
      }
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
    geoError = null;
    zonesResponse = null;
    lotsResponse = null;
    activeDocument = null;
    selectionState = createSelectionBucketState();
    updateFillColors();
    updateGeoLayers();
  }

  function toggleBucketKey(key: SelectionKey): void {
    selectionState = toggleSelection(selectionState, key);
    updateFillColors();
    updateGeoLayers();
  }

  function focusBucketKey(key: SelectionKey | null): void {
    selectionState = setFocus(selectionState, key);
  }

  function openDocument(ref: SignalDocRef): void {
    activeDocument = ref;
  }

  function closeDocument(): void {
    activeDocument = null;
  }

  function selectedKeysForKind(kind: string): Set<SelectionKey> {
    const keys = new Set<SelectionKey>();
    for (const key of selectionState.selectedKeys) {
      if (parseKey(key)?.kind === kind) keys.add(key);
    }
    return keys;
  }

  function selectedCodesForZones(): Set<string> {
    const codes = new Set<string>();
    const citySlug = selectedCity?.municipality.slug;
    if (!citySlug) return codes;
    for (const zone of zonesResponse?.featureCollection.features ?? []) {
      const code = zone.properties.code;
      if (selectionState.selectedKeys.has(makeKey("zone", `${citySlug}/${code}`))) {
        codes.add(code);
      }
    }
    return codes;
  }

  function selectedNumbersForLots(): Set<string> {
    const lotNumbers = new Set<string>();
    const citySlug = selectedCity?.municipality.slug;
    if (!citySlug) return lotNumbers;
    for (const lot of lotsResponse?.featureCollection.features ?? []) {
      const noLot = lot.properties.noLot;
      if (selectionState.selectedKeys.has(makeKey("lot", `${citySlug}/${noLot}`))) {
        lotNumbers.add(noLot);
      }
    }
    return lotNumbers;
  }

  function buildZoneOpacityExpression(): ExpressionSpecification {
    const selectedCodes = selectedCodesForZones();
    const hasZoneSelection = selectedCodes.size > 0;
    const expr: unknown[] = ["match", ["get", "code"]];
    for (const code of selectedCodes) expr.push(code, 0.62);
    expr.push(hasZoneSelection ? 0.18 : 0.38);
    return expr as ExpressionSpecification;
  }

  function buildLotOpacityExpression(): ExpressionSpecification {
    const selectedNumbers = selectedNumbersForLots();
    const hasLotSelection = selectedNumbers.size > 0;
    const expr: unknown[] = ["match", ["get", "noLot"]];
    for (const noLot of selectedNumbers) expr.push(noLot, 0.72);
    expr.push(hasLotSelection ? 0.2 : 0.42);
    return expr as ExpressionSpecification;
  }

  function updateGeoLayers(): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      getLayer: (id: string) => unknown;
      getSource: (id: string) => { setData?: (data: unknown) => void } | undefined;
      addSource: (id: string, source: unknown) => void;
      addLayer: (layer: unknown) => void;
      setPaintProperty: (layer: string, prop: string, value: unknown) => void;
    };

    const zones = zonesResponse?.featureCollection ?? EMPTY_ZONES;
    const lots = lotsResponse?.featureCollection ?? EMPTY_LOTS;

    const zoneSource = m.getSource("selected-zones");
    if (zoneSource?.setData) {
      zoneSource.setData(zones);
    } else if (!zoneSource) {
      m.addSource("selected-zones", { type: "geojson", data: zones });
    }
    if (!m.getLayer("selected-zones-fill")) {
      m.addLayer({
        id: "selected-zones-fill",
        type: "fill",
        source: "selected-zones",
        paint: {
          "fill-color": [
            "match",
            ["get", "geometryStatus"],
            "official",
            "#0f766e",
            "lot-union-fallback",
            "#f59e0b",
            "text-only",
            "#94a3b8",
            "#94a3b8",
          ],
          "fill-opacity": buildZoneOpacityExpression(),
          "fill-outline-color": "#0f172a",
        },
      });
    }
    if (!m.getLayer("selected-zones-outline")) {
      m.addLayer({
        id: "selected-zones-outline",
        type: "line",
        source: "selected-zones",
        paint: {
          "line-color": "#0f172a",
          "line-width": 1.25,
          "line-opacity": 0.5,
        },
      });
    }

    const lotSource = m.getSource("selected-lots");
    if (lotSource?.setData) {
      lotSource.setData(lots);
    } else if (!lotSource) {
      m.addSource("selected-lots", { type: "geojson", data: lots });
    }
    if (!m.getLayer("selected-lots-fill")) {
      m.addLayer({
        id: "selected-lots-fill",
        type: "fill",
        source: "selected-lots",
        paint: {
          "fill-color": [
            "case",
            ["all", ["==", ["get", "multifamilial4plus"], true], ["==", ["get", "tod"], true]],
            "#e67e22",
            ["==", ["get", "multifamilial4plus"], true],
            "#27ae60",
            ["==", ["get", "tod"], true],
            "#2980b9",
            "#64748b",
          ],
          "fill-opacity": buildLotOpacityExpression(),
          "fill-outline-color": "#ffffff",
        },
      });
    }
    if (!m.getLayer("selected-lots-outline")) {
      m.addLayer({
        id: "selected-lots-outline",
        type: "line",
        source: "selected-lots",
        paint: {
          "line-color": "#334155",
          "line-width": 0.4,
          "line-opacity": 0.35,
        },
      });
    }

    m.setPaintProperty("selected-zones-fill", "fill-opacity", buildZoneOpacityExpression());
    m.setPaintProperty("selected-lots-fill", "fill-opacity", buildLotOpacityExpression());
  }

  async function loadGeoForCity(citySlug: string): Promise<void> {
    geoLoading = true;
    geoError = null;
    zonesResponse = null;
    lotsResponse = null;
    updateGeoLayers();
    const errors: string[] = [];
    const [zonesResult, lotsResult] = await Promise.allSettled([
        fetchGeoZones(citySlug, { fallback: "lots", limit: 500 }),
        fetchLots(citySlug, { limit: 500 }),
      ]);

    if (zonesResult.status === "fulfilled") {
      zonesResponse = zonesResult.value;
    } else {
      const message =
        zonesResult.reason instanceof Error
          ? zonesResult.reason.message
          : "zones indisponibles";
      if (message.includes("geo-zones HTTP 404")) {
        zonesResponse = emptyUnconfiguredZones(citySlug);
      } else {
        errors.push(message);
      }
    }

    if (lotsResult.status === "fulfilled") {
      lotsResponse = lotsResult.value;
    } else {
      errors.push(
        lotsResult.reason instanceof Error
          ? lotsResult.reason.message
          : "lots indisponibles",
      );
    }

    geoError = errors.length > 0 ? errors.join(" · ") : null;
    geoLoading = false;
    updateGeoLayers();
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
    <DocumentOverlay documentRef={activeDocument} onClose={closeDocument} />
  </div>

  <!-- ── SEL droit : panneau de sélection ville ───────────────────────────── -->
  <svelte:fragment slot="sel">
    <SignauxSelPanel
      {selectedCity}
      {detailNodes}
      {detailLoading}
      {detailError}
      {geoLoading}
      {geoError}
      {zonesResponse}
      {lotsResponse}
      {selectionState}
      onClear={clearSelection}
      onToggleKey={toggleBucketKey}
      onFocusKey={focusBucketKey}
      onOpenDocument={openDocument}
    />
  </svelte:fragment>
</ViewLayout>
