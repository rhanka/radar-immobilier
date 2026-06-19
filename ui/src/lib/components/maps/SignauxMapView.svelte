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
  import SignalPdfOverlay from "$lib/components/maps/SignalPdfOverlay.svelte";
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
    type SignalEvidence,
  } from "$lib/signals/graph-signal-detail-client.js";
  import {
    fetchGeoZones,
    type GeoZoneFeature,
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
  import {
    navigateToGeoRoute,
    type GeoRoute,
  } from "$lib/router/router.js";
  import {
    decorateLotsWithSignalProjection,
    fallbackZoneCode,
    opacityForSelectionKey,
    withCityFallbackZone,
  } from "$lib/maps/signaux-map-geo.js";
  import type { GeoJsonGeometry } from "$lib/maps/cadastre-geojson-source.js";
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

  export let geoRoute: GeoRoute | null = null;

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
  let geoNotices: string[] = [];
  let zonesResponse: GeoZonesResponse | null = null;
  let lotsResponse: LotsResponse | null = null;
  let activeDocument: SignalDocRef | null = null;
  let activeEvidence: { title: string; evidence: SignalEvidence } | null = null;
  let displayedLots: LotFeatureCollection = EMPTY_LOTS;

  // ── Cache multi-villes : types vus + nœuds par ville ──────────────────────
  /** Accumule les types de nœuds vus au fil des villes cliquées. */
  let knownNodeTypes: string[] = [];
  /** Cache des nœuds détail par ville slug (pour recoloration aplats filtrée). */
  const detailCache = new Map<string, GraphSignalNode[]>();
  const cityBoundaryBySlug = new Map<string, GeoJsonGeometry>();
  let appliedGeoRouteKey: string | null = null;
  let pendingRouteZoneKey: string | null = null;

  // ── Filtre GLOBAL (axes combinables) ──────────────────────────────────────
  /** Clé active = combinaison des toggles actifs : "", "z", "m", "p", "z|m", etc. */
  let activeSubsetKey = "z"; // défaut : zonageOnly ON

  /**
   * Restaure la clé filtre depuis l'URL au chargement.
   * Le filtre est stocké dans geoRoute.state.filters["subset"] en tant que tableau de valeurs.
   * Ex : filters={"subset":["z","m"]} → subsetKey="z|m"
   */
  function subsetKeyFromRoute(route: GeoRoute | null): string {
    if (!route) return "z";
    const values = route.state.filters["subset"] ?? [];
    return values.length > 0 ? values.join("|") : "z";
  }

  function handleFilterChange(
    subsetKey: string,
  ): void {
    activeSubsetKey = subsetKey;
    // Persiste le filtre dans l'URL (remplace sans ajouter à l'historique)
    const currentRoute = geoRoute;
    if (currentRoute) {
      const subsetValues = subsetKey ? subsetKey.split("|") : [];
      const newFilters = subsetValues.length > 0 ? { subset: subsetValues } : {};
      const newState = { ...currentRoute.state, filters: newFilters };
      if (currentRoute.level === "zone") {
        navigateToGeoRoute(
          { level: "zone", citySlug: currentRoute.citySlug, zoneKey: currentRoute.zoneKey, state: newState },
          { replace: true },
        );
      } else if (currentRoute.level === "city") {
        navigateToGeoRoute(
          { level: "city", citySlug: currentRoute.citySlug, state: newState },
          { replace: true },
        );
      } else {
        navigateToGeoRoute(
          { level: "region", state: newState },
          { replace: true },
        );
      }
    }
    updateFillColors();
  }

  function buildDisplayedLots(): LotFeatureCollection {
    return lotsResponse
      ? decorateLotsWithSignalProjection(
          lotsResponse.featureCollection,
          zonesResponse?.featureCollection.features ?? [],
          detailNodes,
        )
      : EMPTY_LOTS;
  }

  function hasSelectedKind(kind: string): boolean {
    if (selectionState.focusedKey?.startsWith(`${kind}:`)) return true;
    for (const key of selectionState.selectedKeys) {
      if (key.startsWith(`${kind}:`)) return true;
    }
    return false;
  }

  // ── Données réactives ──────────────────────────────────────────────────────
  $: allEntries = buildCityMapEntries(graphItems);
  $: displayedLots = buildDisplayedLots();

  $: activeGeoLevel = hasSelectedKind("zone")
    ? "Zone"
    : selectedCity
      ? "Ville"
      : "Province";

  /** True si la ville sélectionnée a des zones géo configurées (pas juste un fallback vide). */
  $: zonesConfigured = !!(
    zonesResponse &&
    zonesResponse.zoneCount > 0 &&
    zonesResponse.featureCollection.features.length > 0
  );

  $: if (geoRoute && allEntries.length > 0) {
    void applyGeoRoute(geoRoute);
  }

  $: if (pendingRouteZoneKey && selectedCity && zonesResponse) {
    applyPendingRouteZone();
  }

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
    const expr: unknown[] = ["match", ["get", "citySlug"]];
    const activeCitySlug = selectedCity?.municipality.slug ?? null;
    for (const entry of entries) {
      const key = makeKey("municipality", entry.municipality.slug);
      const contextualOpacity = activeCitySlug
        ? (entry.municipality.slug === activeCitySlug ? 0.06 : 0.1)
        : 0.75;
      expr.push(
        entry.municipality.slug,
        activeCitySlug
          ? contextualOpacity
          : opacityForSelectionKey(selectionState, key, 0.75),
      );
    }
    expr.push(activeCitySlug ? 0.08 : 0.75);
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

  type MapLayerEvent = {
    features?: Array<{ properties?: Record<string, unknown> }>;
    originalEvent?: { stopPropagation?: () => void };
  };

  function cacheCityBoundaries(geojson: unknown): void {
    const features = (geojson as { features?: unknown[] }).features;
    if (!Array.isArray(features)) return;

    for (const feature of features) {
      const record = feature as {
        geometry?: GeoJsonGeometry | null;
        properties?: Record<string, unknown>;
      };
      const citySlug = readString(record.properties?.citySlug);
      if (citySlug && record.geometry) {
        cityBoundaryBySlug.set(citySlug, record.geometry);
      }
    }
  }

  function readString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }

  function registerGeoLayerInteractions(m: {
    on: (event: string, layer: string, handler: (e: MapLayerEvent) => void) => void;
    getCanvas: () => HTMLCanvasElement;
  }): void {
    m.on("click", "selected-zones-fill", (e) => {
      const props = e.features?.[0]?.properties;
      const citySlug = readString(props?.citySlug);
      const code = readString(props?.code);
      if (!citySlug || !code) return;
      e.originalEvent?.stopPropagation?.();
      toggleMapSelection(makeKey("zone", `${citySlug}/${code}`));
    });

    m.on("click", "selected-lots-fill", (e) => {
      const props = e.features?.[0]?.properties;
      const noLot = readString(props?.noLot);
      const citySlug = readString(props?.citySlug) ?? selectedCity?.municipality.slug;
      if (!noLot || !citySlug) return;
      e.originalEvent?.stopPropagation?.();
      toggleMapSelection(makeKey("lot", `${citySlug}/${noLot}`));
    });

    m.on("mouseenter", "selected-zones-fill", () => {
      m.getCanvas().style.cursor = "pointer";
    });
    m.on("mouseleave", "selected-zones-fill", () => {
      m.getCanvas().style.cursor = "";
    });
    m.on("mouseenter", "selected-lots-fill", () => {
      m.getCanvas().style.cursor = "pointer";
    });
    m.on("mouseleave", "selected-lots-fill", () => {
      m.getCanvas().style.cursor = "";
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
        cacheCityBoundaries(polygonsData);

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
          if (selectedCity?.municipality.slug === props.citySlug) return;
          if (entry) void selectCity(entry);
        });

        m.on("mousemove", "cities-fill", (e) => {
          const props = e.features?.[0]?.properties as { citySlug?: string } | undefined;
          m.getCanvas().style.cursor =
            selectedCity?.municipality.slug === props?.citySlug ? "" : "pointer";
        });
        m.on("mouseleave", "cities-fill", () => {
          m.getCanvas().style.cursor = "";
        });

        mapReady = true;
        // Injecter les couleurs si les données API sont déjà chargées
        if (allEntries.length > 0) updateFillColors();
        updateGeoLayers();
        registerGeoLayerInteractions(m);
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
  async function selectCity(
    entry: CityMapEntry,
    options: { syncUrl?: boolean } = {},
  ): Promise<void> {
    const syncUrl = options.syncUrl ?? true;
    if (selectedCity?.municipality.slug === entry.municipality.slug) {
      return;
    }
    if (syncUrl) {
      // Conserver le filtre actif dans la nouvelle route ville
      const subsetValues = activeSubsetKey ? activeSubsetKey.split("|") : [];
      navigateToGeoRoute({
        level: "city",
        citySlug: entry.municipality.slug,
        state: {
          mode: geoRoute?.state.mode ?? "signal",
          filters: subsetValues.length > 0 ? { subset: subsetValues } : {},
        },
      });
    }
    selectedCity = entry;
    detailNodes = [];
    detailError = null;
    detailLoading = true;
    geoNotices = [];
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
      if (!res.ok && res.nodes.length === 0) {
        // 404 — ville sans signaux graphify (état vide honnête)
        detailNodes = [];
        detailError = null;
        return;
      }
      detailNodes = res.nodes;
      // Alimenter le cache multi-villes et accumuler les types connus
      detailCache.set(entry.municipality.slug, res.nodes);
      const newTypes = res.nodes.map((n) => n.type);
      knownNodeTypes = Array.from(new Set([...knownNodeTypes, ...newTypes])).sort();
      // Ne pas auto-focaliser le 1er signal : l'utilisateur choisit lui-même
      // quel signal ouvrir (clic dans le panneau droit). L'auto-focus créait
      // un paradoxe accordéon : le 1er clic sur un signal pré-focusé le fermait
      // au lieu de l'ouvrir, rendant le détail inaccessible.
      // Recolorer les aplats avec les nouvelles données en cache
      updateFillColors();
      updateGeoLayers();
    } catch (e) {
      console.warn("Signal detail load failed:", e);
      detailError = "Donnée indisponible pour les signaux de cette ville.";
    } finally {
      detailLoading = false;
    }
  }

  function clearSelection(): void {
    selectedCity = null;
    pendingRouteZoneKey = null;
    detailNodes = [];
    detailError = null;
    geoError = null;
    geoNotices = [];
    zonesResponse = null;
    lotsResponse = null;
    activeDocument = null;
    activeEvidence = null;
    selectionState = createSelectionBucketState();
    updateFillColors();
    updateGeoLayers();
  }

  /**
   * Clic sur le segmented-control Province / Ville / Zone.
   * Province → clearSelection (retour vue globale)
   * Ville → désélectionner les zones/lots mais conserver la ville sélectionnée
   * Zone → sélectionner la première zone disponible (si zones configurées)
   */
  function handleGeoLevelClick(level: string): void {
    if (level === activeGeoLevel) return;
    if (level === "Province") {
      clearSelection();
    } else if (level === "Ville") {
      if (!selectedCity) return;
      // Effacer toutes les sélections zone/lot, conserver la ville
      selectionState = createSelectionBucketState();
      updateFillColors();
      updateGeoLayers();
    } else if (level === "Zone") {
      if (!selectedCity) return;
      const zones = zonesResponse?.featureCollection.features ?? [];
      if (zones.length === 0) return; // zones non configurées — rien à faire
      const firstZone = zones[0];
      const key = zoneSelectionKey(firstZone);
      selectBucketKey(key);
      syncRouteForSelectionKey(key);
    }
  }

  function toggleBucketKey(key: SelectionKey): void {
    // #9 fix — l'accordéon pilote le FOCUS (ouvre/ferme le détail), pas la
    // sélection multi. On bascule le focus : si l'item est déjà focusé on le
    // referme (null), sinon on le focalise (key). La sélection est assurée
    // pour la cohérence carte (opacité zones/lots), mais ne pilote pas le détail.
    const isFocused = selectionState.focusedKey === key;
    if (isFocused) {
      // Re-clic sur l'item focusé → referme le détail, conserve la sélection.
      selectionState = setFocus(selectionState, null);
    } else {
      // Clic sur un autre item → l'ajouter aux sélectionnés si absent, puis focaliser.
      if (!selectionState.selectedKeys.has(key)) {
        selectionState = toggleSelection(selectionState, key);
      }
      selectionState = setFocus(selectionState, key);
    }
    syncRouteForSelectionKey(key);
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

  function openEvidence(payload: { title: string; evidence: SignalEvidence }): void {
    activeEvidence = payload;
    // Ferme le doc overlay si ouvert pour éviter deux overlays superposés
    activeDocument = null;
  }

  function closeEvidence(): void {
    activeEvidence = null;
  }

  function zoneSelectionKey(zone: GeoZoneFeature): SelectionKey {
    return makeKey("zone", `${zone.properties.citySlug}/${zone.properties.code}`);
  }

  function lotSelectionKey(noLot: string, citySlug = selectedCity?.municipality.slug): SelectionKey | null {
    if (!citySlug) return null;
    return makeKey("lot", `${citySlug}/${noLot}`);
  }

  function toggleMapSelection(key: SelectionKey): void {
    const wasSelected = selectionState.selectedKeys.has(key);
    selectionState = toggleSelection(selectionState, key);
    selectionState = setFocus(selectionState, wasSelected ? null : key);
    if (!wasSelected) syncRouteForSelectionKey(key);
    updateFillColors();
    updateGeoLayers();
  }

  function routeKey(route: GeoRoute): string {
    if (route.level === "region") return `region:${route.region}:${route.state.mode}`;
    if (route.level === "city") return `city:${route.citySlug}:${route.state.mode}`;
    return `zone:${route.citySlug}:${route.zoneKey}:${route.state.mode}`;
  }

  async function applyGeoRoute(route: GeoRoute): Promise<void> {
    const key = routeKey(route);
    if (appliedGeoRouteKey === key) return;
    appliedGeoRouteKey = key;

    if (route.level === "region") {
      clearSelection();
      return;
    }

    const entry = allEntries.find(
      (item) => item.municipality.slug === route.citySlug,
    );
    if (!entry) return;

    await selectCity(entry, { syncUrl: false });

    if (route.level === "zone") {
      pendingRouteZoneKey = route.zoneKey;
      applyPendingRouteZone();
    } else {
      pendingRouteZoneKey = null;
    }
  }

  function selectBucketKey(key: SelectionKey): void {
    if (!selectionState.selectedKeys.has(key)) {
      selectionState = toggleSelection(selectionState, key);
    }
    selectionState = setFocus(selectionState, key);
    updateFillColors();
    updateGeoLayers();
  }

  function applyPendingRouteZone(): void {
    if (!pendingRouteZoneKey || !selectedCity || !zonesResponse) return;
    const citySlug = selectedCity.municipality.slug;
    const zone = zonesResponse.featureCollection.features.find(
      (feature) =>
        feature.properties.citySlug === citySlug &&
        feature.properties.code === pendingRouteZoneKey,
    );
    if (!zone) return;
    selectBucketKey(makeKey("zone", `${citySlug}/${zone.properties.code}`));
    pendingRouteZoneKey = null;
  }

  function syncRouteForSelectionKey(key: SelectionKey): void {
    const parsed = parseKey(key);
    if (!parsed || parsed.kind !== "zone") return;
    const separatorIndex = parsed.id.indexOf("/");
    if (separatorIndex <= 0 || separatorIndex === parsed.id.length - 1) return;
    const citySlug = parsed.id.slice(0, separatorIndex);
    const zoneKey = parsed.id.slice(separatorIndex + 1);
    navigateToGeoRoute({
      level: "zone",
      citySlug,
      zoneKey,
      state: { mode: geoRoute?.state.mode ?? "signal" },
    });
  }

  function buildZoneOpacityExpression(
    zones = zonesResponse?.featureCollection.features ?? EMPTY_ZONES.features,
  ): ExpressionSpecification {
    const expr: unknown[] = ["match", ["get", "code"]];
    for (const zone of zones) {
      const key = zoneSelectionKey(zone);
      expr.push(
        zone.properties.code,
        opacityForSelectionKey(selectionState, key, 0.42),
      );
    }
    expr.push(selectionState.selectedKeys.size > 0 ? 0.5 : 0.42);
    return expr as ExpressionSpecification;
  }

  function buildLotOpacityExpression(
    lots: LotFeatureCollection = displayedLots,
  ): ExpressionSpecification {
    const expr: unknown[] = ["match", ["get", "noLot"]];
    const citySlug = selectedCity?.municipality.slug;
    for (const lot of lots.features) {
      const noLot = lot.properties.noLot;
      const key = lotSelectionKey(noLot, lot.properties.citySlug ?? citySlug);
      expr.push(
        noLot,
        key ? opacityForSelectionKey(selectionState, key, 0.36) : 0.36,
      );
    }
    expr.push(selectionState.selectedKeys.size > 0 ? 0.5 : 0.36);
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
    const lots = lotsResponse
      ? decorateLotsWithSignalProjection(
          lotsResponse.featureCollection,
          zones.features,
          detailNodes,
        )
      : EMPTY_LOTS;

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
            "missing",
            "#475569",
            "#94a3b8",
          ],
          "fill-opacity": buildZoneOpacityExpression(zones.features),
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
            ["==", ["get", "signalProjection"], "direct"],
            "#dc2626",
            ["==", ["get", "signalProjection"], "inherited"],
            "#f59e0b",
            ["all", ["==", ["get", "multifamilial4plus"], true], ["==", ["get", "tod"], true]],
            "#e67e22",
            ["==", ["get", "multifamilial4plus"], true],
            "#27ae60",
            ["==", ["get", "tod"], true],
            "#2980b9",
            "#64748b",
          ],
          "fill-opacity": buildLotOpacityExpression(lots),
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

    m.setPaintProperty("selected-zones-fill", "fill-opacity", buildZoneOpacityExpression(zones.features));
    m.setPaintProperty("selected-lots-fill", "fill-opacity", buildLotOpacityExpression(lots));
  }

  async function loadGeoForCity(citySlug: string): Promise<void> {
    geoLoading = true;
    geoError = null;
    geoNotices = [];
    zonesResponse = null;
    lotsResponse = null;
    updateGeoLayers();
    const errors: string[] = [];
    const notices: string[] = [];
    const [zonesResult, lotsResult] = await Promise.allSettled([
        fetchGeoZones(citySlug, { fallback: "lots", limit: 500 }),
        fetchLots(citySlug, { limit: 500 }),
      ]);

    if (zonesResult.status === "fulfilled") {
      const entry = allEntries.find((item) => item.municipality.slug === citySlug);
      const withFallback = withCityFallbackZone(zonesResult.value, {
        citySlug,
        cityName: entry?.municipality.name ?? citySlug,
        geometry: cityBoundaryBySlug.get(citySlug) ?? null,
      });
      zonesResponse = withFallback.response;
      if (withFallback.created) {
        notices.push(
          cityBoundaryBySlug.has(citySlug)
            ? `Zones non configurées : fallback ${fallbackZoneCode(citySlug)} sur le contour ville.`
            : `Zones non configurées : fallback ${fallbackZoneCode(citySlug)} sans géométrie disponible.`,
        );
      } else if (zonesResult.value.resolutionStatus === "fallback") {
        notices.push("Zones dérivées des lots : géométrie officielle non configurée.");
      }
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
      if (!lotsResult.value.ok || lotsResult.value.source === "none") {
        notices.push(
          lotsResult.value.reason
            ? `Lots non configurés : ${lotsResult.value.reason}`
            : "Lots non configurés pour cette ville.",
        );
      } else if (lotsResult.value.featureCollection.features.length === 0) {
        notices.push("Lots configurés, mais aucun lot dans la réponse.");
      }
    } else {
      console.warn("Lots load failed:", lotsResult.reason);
      errors.push("Lots : donnée indisponible.");
    }

    geoError = errors.length > 0 ? errors.join(" · ") : null;
    geoNotices = notices;
    geoLoading = false;
    updateGeoLayers();

    // 2.4 — Ville sans zones configurées → bascule par défaut sur le 1er lot.
    const noZones =
      !zonesResponse ||
      zonesResponse.zoneCount === 0 ||
      zonesResponse.featureCollection.features.length === 0;
    const firstLot = lotsResponse?.featureCollection.features[0] ?? null;
    if (noZones && firstLot && selectedCity?.municipality.slug === citySlug) {
      const key = lotSelectionKey(
        firstLot.properties.noLot,
        firstLot.properties.citySlug ?? citySlug,
      );
      if (key) selectBucketKey(key);
    }
  }

  // ── Chargement API ─────────────────────────────────────────────────────────
  async function load() {
    loading = true;
    loadError = null;
    try {
      const res = await fetchGraphSignalsByCity();
      graphItems = res.cities;
    } catch (e) {
      console.warn("Signals by city load failed:", e);
      loadError = "Données des signaux indisponibles.";
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    // Restaurer le filtre depuis l'URL au premier chargement
    const initialSubsetKey = subsetKeyFromRoute(geoRoute);
    if (initialSubsetKey !== activeSubsetKey) {
      activeSubsetKey = initialSubsetKey;
    }
    void load();
    void initMap();
  });
</script>

<ViewLayout controlsWidth="w-80" stickyControlsFooter selWidth="w-80">
  <!-- ── RAIL gauche : recherche + facets + accordéon villes ─────────────── -->
  <svelte:fragment slot="controls">
    {#if loadError}
      <div class="px-4 py-2 text-xs text-red-600 border-b border-red-100 bg-red-50">
        {loadError} — aucun compteur n’est affiché pour éviter un faux zéro.
      </div>
    {/if}
    <SignauxRail
      entries={allEntries}
      selectedSlug={selectedCity?.municipality.slug ?? null}
      {detailNodes}
      {knownNodeTypes}
      {loading}
      dataUnavailable={loadError !== null}
      {detailLoading}
      initialSubsetKey={activeSubsetKey}
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
    <div class="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col gap-2">
      <div class="inline-flex w-fit overflow-hidden rounded border border-slate-200 bg-white/95 text-xs shadow-sm">
        {#each ["Province", "Ville", "Zone"] as level (level)}
          {@const isZoneDisabled = level === "Zone" && selectedCity !== null && !zonesConfigured}
          <button
            type="button"
            class={`px-2.5 py-1 font-semibold transition-colors ${
              activeGeoLevel === level
                ? "bg-slate-900 text-white"
                : isZoneDisabled
                  ? "text-slate-300 cursor-not-allowed"
                  : "text-slate-600 hover:bg-slate-100 cursor-pointer"
            }`}
            aria-pressed={activeGeoLevel === level}
            aria-label={isZoneDisabled ? `${level} (zones non configurées)` : level}
            disabled={isZoneDisabled}
            onclick={() => handleGeoLevelClick(level)}
          >
            {level}
          </button>
        {/each}
      </div>
      {#if selectedCity && (geoLoading || geoNotices.length > 0 || geoError)}
        <div class="max-w-sm rounded border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm">
          {#if geoLoading}
            <p class="m-0 font-semibold text-slate-500">Chargement zones/lots…</p>
          {/if}
          {#if geoError}
            <p class="m-0 text-amber-700">{geoError}</p>
          {/if}
          {#each geoNotices as notice (notice)}
            <p class="m-0 text-slate-600">{notice}</p>
          {/each}
        </div>
      {/if}
    </div>
    {#if !mapReady}
      <div class="absolute inset-0 flex items-center justify-center bg-slate-100">
        <span class="text-xs text-slate-400">Chargement de la carte…</span>
      </div>
    {/if}
    <DocumentOverlay documentRef={activeDocument} onClose={closeDocument} />
    {#if activeEvidence}
      <SignalPdfOverlay
        title={activeEvidence.title}
        sourceUrl={activeEvidence.evidence.documentUrl ?? activeEvidence.evidence.sourceUrl}
        sourceRef={activeEvidence.evidence.sourceRef}
        rawRef={activeEvidence.evidence.rawRef}
        rawObjectKey={activeEvidence.evidence.rawObjectKey}
        documentDate={activeEvidence.evidence.documentDate}
        page={activeEvidence.evidence.page}
        bbox={activeEvidence.evidence.bbox}
        excerpt={activeEvidence.evidence.excerpt ?? activeEvidence.evidence.citation}
        onClose={closeEvidence}
      />
    {/if}
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
      {activeSubsetKey}
      onClear={clearSelection}
      onToggleKey={toggleBucketKey}
      onOpenDocument={openDocument}
      onOpenEvidence={openEvidence}
    />
  </svelte:fragment>
</ViewLayout>
