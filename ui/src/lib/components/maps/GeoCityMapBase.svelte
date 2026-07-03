<script lang="ts" context="module">
  import type { LngLatBoundsTuple } from "$lib/maps/geometry-bounds.js";
  import type { GeoJsonGeometry } from "$lib/maps/cadastre-geojson-source.js";

  /** Une entrée du segmented-control de drill (Province / Ville / Zone …). */
  export interface GeoSegment {
    /** Libellé affiché ET identité du segment (passé à `onSegmentClick`). */
    label: string;
    /** Désactive le segment (style grisé + `disabled`). */
    disabled?: boolean;
    /** `aria-label` optionnel (sinon `label`). */
    ariaLabel?: string;
  }

  /** Légende paramétrable (overlay carte). `null` ⇒ pas de légende rendue. */
  export interface GeoMapLegend {
    title: string;
    items: { color: string; label: string }[];
  }

  /** Collection GeoJSON minimale acceptée par les couches zone/lot. */
  export interface GeoJsonFeatureCollectionLike {
    type: "FeatureCollection";
    features: unknown[];
  }

  /**
   * Données + peinture des couches spécialisées zone/lot. La COULEUR et
   * l'OPACITÉ sont fournies par le consommateur (expressions MapLibre) ; le socle
   * ne porte que l'échafaudage (source + couche + interactions). Les contours
   * (couleur/épaisseur) sont fixes côté socle.
   */
  export interface GeoLayersInput {
    zones: GeoJsonFeatureCollectionLike;
    lots: GeoJsonFeatureCollectionLike;
    /** `fill-color` des zones (posée à la création de la couche). */
    zoneFillColor: unknown;
    /** `fill-opacity` des zones (posée à la création ET à chaque sync). */
    zoneFillOpacity: unknown;
    /** `fill-color` des lots (posée à la création ET à chaque sync). */
    lotFillColor: unknown;
    /** `fill-opacity` des lots (posée à la création ET à chaque sync). */
    lotFillOpacity: unknown;
    /** `line-color` du contour de lot (posée à la création ET à chaque sync). */
    lotLineColor: unknown;
  }

  /**
   * API impérative du socle, livrée au parent via `onReady` une fois la carte
   * chargée. Le parent garde la POLITIQUE (quoi cadrer, quelles couches peindre) ;
   * le socle fournit la MÉCANIQUE liée à l'instance MapLibre.
   */
  export interface GeoCityMapApi {
    /** Vol caméra centré (clic ville, etc.). */
    flyTo(options: { center: [number, number]; zoom: number; duration: number }): void;
    /** Cadre la caméra sur une bbox WGS-84 (repli flyTo si bbox dégénérée). */
    fitMapToBounds(
      bounds: LngLatBoundsTuple,
      options?: { maxZoom?: number; duration?: number },
    ): void;
    /**
     * C9 — restaure le CADRAGE INITIAL (centre + zoom du primo-chargement),
     * capturé une fois la carte chargée. Retour Province / désélection.
     * Retourne false si aucun viewport initial n'a pu être capturé.
     */
    resetToInitialView(options?: { duration?: number }): boolean;
    /** (Re)peint les couches zone/lot à partir des données + expressions fournies. */
    syncGeoLayers(input: GeoLayersInput): void;
    /** Géométrie du contour municipal mis en cache au chargement (ou `null`). */
    getCityBoundary(slug: string): GeoJsonGeometry | null;
    /** `true` si un contour municipal est en cache pour ce slug. */
    hasCityBoundary(slug: string): boolean;
    /**
     * Élément monté sous le ThemeProvider, pour résoudre les tokens DS des
     * expressions de paint (`getComputedStyle`). C'est le conteneur de carte.
     */
    readonly themeElement: HTMLElement | null;
  }
</script>

<script lang="ts">
  /**
   * GeoCityMapBase — SOCLE carto partagé des vues « ville » (Signaux, Source…).
   *
   * Noyau réutilisable extrait de SignauxMapView (iso-comportement) :
   *  - init MapLibre (fond OSM) + source `municipalities.geojson`
   *  - couche choroplèthe `cities-fill` dont la COULEUR/OPACITÉ sont des PROPS
   *  - segmented-control de drill Province / Ville / Zone (paramétrable)
   *  - primitives caméra (flyTo / fitBounds) exposées via `onReady`
   *  - échafaudage des couches spécialisées zone/lot (données + paint en entrée)
   *  - légende paramétrable (overlay), désactivée par défaut
   *
   * Le socle NE porte AUCUNE logique métier (signal, score, filtre) : le parent
   * calcule les expressions de couleur/opacité et les passe en props / via
   * `syncGeoLayers`.
   */
  import { onMount, onDestroy } from "svelte";
  import { isDegenerateBounds } from "$lib/maps/geometry-bounds.js";
  import { createViewportMemory } from "$lib/maps/viewport-memory.js";
  import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

  // ── Props : fond de carte ──────────────────────────────────────────────────
  /**
   * Style du fond (C10) : `"osm"` = raster OSM classique ; `"neutral-gray"` =
   * fond GRIS neutre (raster OSM désaturé et éclairci sur aplat gris) qui fait
   * ressortir zones/lots, façon carte de référence.
   */
  export let basemap: "osm" | "neutral-gray" = "osm";

  // ── Props : choroplèthe villes ─────────────────────────────────────────────
  /** Expression MapLibre `fill-color` de la couche `cities-fill` (obligatoire). */
  export let fillColorExpression: ExpressionSpecification;
  /** Expression MapLibre `fill-opacity` de `cities-fill` (optionnelle). */
  export let fillOpacityExpression: ExpressionSpecification | number | undefined =
    undefined;
  /** Couleur du contour des polygones villes. */
  export let fillOutlineColor: string = "#94a3b8";

  // ── Props : interactions ───────────────────────────────────────────────────
  /** Ville active : supprime le curseur « pointer » sur son polygone (parité). */
  export let activeCitySlug: string | null = null;
  /** Clic sur un polygone ville. */
  export let onCityClick: (citySlug: string) => void = () => {};
  /** Clic sur un aplat zone (couche `selected-zones-fill`). */
  export let onZoneClick: (zone: { citySlug: string; code: string }) => void =
    () => {};
  /** Clic sur un aplat lot (couche `selected-lots-fill`). */
  export let onLotClick: (lot: { noLot: string; citySlug: string | null }) => void =
    () => {};

  // ── Props : drill segmenté + légende ───────────────────────────────────────
  /** Segments du drill (Province / Ville / Zone …). Vide ⇒ pas de control. */
  export let segments: GeoSegment[] = [];
  /** Libellé du segment actif. */
  export let activeSegment: string = "";
  /** Clic sur un segment. */
  export let onSegmentClick: (label: string) => void = () => {};
  /** Légende overlay paramétrable. `null` ⇒ aucune légende rendue par le socle. */
  export let legend: GeoMapLegend | null = null;
  /** C3 — couleur de l'exergue des features sélectionnées (orange fluo). */
  export let selectionHighlightColor = "#ff6d00";

  // ── Props : cycle de vie ───────────────────────────────────────────────────
  /** Appelé une fois la carte prête, avec l'API impérative du socle. */
  export let onReady: (api: GeoCityMapApi) => void = () => {};

  // ── État MapLibre interne ──────────────────────────────────────────────────
  let mapContainer: HTMLDivElement;
  let mapInstance: unknown = null;
  let mapReady = false;
  const cityBoundaryBySlug = new Map<string, GeoJsonGeometry>();
  // C9 — mémoire du cadrage initial (capturé au `load`, restauré à la demande).
  const viewportMemory = createViewportMemory();
  // C6 — id de la feature survolée par source (feature-state hover).
  const hoveredFeatureIdBySource = new Map<string, number | string>();

  // Vue par défaut : Québec (cible commune Signaux / Source).
  const INITIAL_CENTER: [number, number] = [-73.5, 45.7];
  const INITIAL_ZOOM = 7;
  const MAX_BOUNDS: [[number, number], [number, number]] = [
    [-85, 41],
    [-55, 63],
  ];

  type MapLayerEvent = {
    features?: Array<{ properties?: Record<string, unknown> }>;
    originalEvent?: { stopPropagation?: () => void };
  };

  function readString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }

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

  // ── Choroplèthe villes : application réactive de la peinture ───────────────
  function applyCitiesFillPaint(): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      getLayer: (id: string) => unknown;
      setPaintProperty: (layer: string, prop: string, value: unknown) => void;
    };
    if (!m.getLayer("cities-fill")) return;
    m.setPaintProperty("cities-fill", "fill-color", fillColorExpression);
    if (fillOpacityExpression !== undefined) {
      m.setPaintProperty("cities-fill", "fill-opacity", fillOpacityExpression);
    }
  }

  // Réapplique la peinture choroplèthe quand les expressions changent.
  $: if (mapReady && (fillColorExpression || fillOpacityExpression)) {
    applyCitiesFillPaint();
  }

  // ── Primitives caméra (exposées via l'API) ─────────────────────────────────
  function flyTo(options: {
    center: [number, number];
    zoom: number;
    duration: number;
  }): void {
    if (!mapInstance || !mapReady) return;
    (
      mapInstance as {
        flyTo: (o: {
          center: [number, number];
          zoom: number;
          duration: number;
        }) => void;
      }
    ).flyTo(options);
  }

  function fitMapToBounds(
    bounds: LngLatBoundsTuple,
    options: { maxZoom?: number; duration?: number } = {},
  ): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      fitBounds: (
        b: LngLatBoundsTuple,
        opts: { padding: number; duration: number; maxZoom?: number },
      ) => void;
      flyTo: (o: {
        center: [number, number];
        zoom: number;
        duration: number;
      }) => void;
    };
    const duration = options.duration ?? 600;
    if (isDegenerateBounds(bounds)) {
      m.flyTo({ center: bounds[0], zoom: 14, duration });
      return;
    }
    m.fitBounds(bounds, {
      padding: 40,
      duration,
      maxZoom: options.maxZoom ?? 15,
    });
  }

  /**
   * C9 — restaure le cadrage du primo-chargement (même centre, même zoom).
   * No-op (false) si la carte n'est pas prête ou si rien n'a été capturé.
   */
  function resetToInitialView(options: { duration?: number } = {}): boolean {
    if (!mapInstance || !mapReady) return false;
    const initial = viewportMemory.initial();
    if (!initial) return false;
    (
      mapInstance as {
        flyTo: (o: {
          center: [number, number];
          zoom: number;
          duration: number;
        }) => void;
      }
    ).flyTo({
      center: initial.center,
      zoom: initial.zoom,
      duration: options.duration ?? 800,
    });
    return true;
  }

  function getCityBoundary(slug: string): GeoJsonGeometry | null {
    return cityBoundaryBySlug.get(slug) ?? null;
  }

  function hasCityBoundary(slug: string): boolean {
    return cityBoundaryBySlug.has(slug);
  }

  // ── Couches spécialisées zone/lot (échafaudage paramétré) ──────────────────
  function registerGeoLayerInteractions(m: {
    on: (
      event: string,
      layer: string,
      handler: (e: MapLayerEvent) => void,
    ) => void;
    getCanvas: () => HTMLCanvasElement;
  }): void {
    m.on("click", "selected-zones-fill", (e) => {
      const props = e.features?.[0]?.properties;
      const citySlug = readString(props?.citySlug);
      const code = readString(props?.code);
      if (!citySlug || !code) return;
      e.originalEvent?.stopPropagation?.();
      onZoneClick({ citySlug, code });
    });

    m.on("click", "selected-lots-fill", (e) => {
      const props = e.features?.[0]?.properties;
      const noLot = readString(props?.noLot);
      if (!noLot) return;
      e.originalEvent?.stopPropagation?.();
      onLotClick({ noLot, citySlug: readString(props?.citySlug) });
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

    // C6 — survol : pose `feature-state.hover` sur la feature sous le curseur
    // (les sources sont créées avec generateId). Les expressions de peinture
    // du consommateur (hover-paint) réagissent à cet état — teinte accentuée,
    // blanc → gris clair. Les LOTS priment visuellement : quand le curseur est
    // sur un lot, la zone en dessous n'est pas marquée survolée.
    registerHoverState("selected-zones-fill", "selected-zones");
    registerHoverState("selected-lots-fill", "selected-lots");
  }

  /** C6 — câble mousemove/mouseleave d'une couche vers feature-state.hover. */
  function registerHoverState(layerId: string, sourceId: string): void {
    const m = mapInstance as {
      on: (
        event: string,
        layer: string,
        handler: (e: { features?: Array<{ id?: number | string }> }) => void,
      ) => void;
    };
    m.on("mousemove", layerId, (e) => {
      const id = e.features?.[0]?.id;
      if (id === undefined) return;
      if (hoveredFeatureIdBySource.get(sourceId) === id) return;
      clearHoverState(sourceId);
      setHoverFeatureState(sourceId, id, true);
      hoveredFeatureIdBySource.set(sourceId, id);
    });
    m.on("mouseleave", layerId, () => {
      clearHoverState(sourceId);
    });
  }

  function setHoverFeatureState(
    sourceId: string,
    id: number | string,
    hover: boolean,
  ): void {
    (
      mapInstance as {
        setFeatureState: (
          target: { source: string; id: number | string },
          state: { hover: boolean },
        ) => void;
      }
    ).setFeatureState({ source: sourceId, id }, { hover });
  }

  /** Efface l'état hover courant d'une source (souris sortie / data resync). */
  function clearHoverState(sourceId: string): void {
    const previous = hoveredFeatureIdBySource.get(sourceId);
    if (previous === undefined) return;
    try {
      setHoverFeatureState(sourceId, previous, false);
    } catch {
      // Source retirée entre-temps : rien à nettoyer.
    }
    hoveredFeatureIdBySource.delete(sourceId);
  }

  function syncGeoLayers(input: GeoLayersInput): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      getLayer: (id: string) => unknown;
      getSource: (id: string) => { setData?: (data: unknown) => void } | undefined;
      addSource: (id: string, source: unknown) => void;
      addLayer: (layer: unknown) => void;
      setPaintProperty: (layer: string, prop: string, value: unknown) => void;
    };

    const { zones, lots } = input;

    const zoneSource = m.getSource("selected-zones");
    if (zoneSource?.setData) {
      // C6 — les ids générés changent avec la donnée : purge l'état hover.
      clearHoverState("selected-zones");
      zoneSource.setData(zones);
    } else if (!zoneSource) {
      // generateId : requis pour le feature-state hover (C6).
      m.addSource("selected-zones", { type: "geojson", data: zones, generateId: true });
    }
    if (!m.getLayer("selected-zones-fill")) {
      m.addLayer({
        id: "selected-zones-fill",
        type: "fill",
        source: "selected-zones",
        paint: {
          "fill-color": input.zoneFillColor,
          "fill-opacity": input.zoneFillOpacity,
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
    // C3 — exergue ORANGE FLUO de la zone sélectionnée (contour épais, façon
    // référence). Filtre data-driven sur la propriété décorée `isSelected`.
    if (!m.getLayer("selected-zones-highlight")) {
      m.addLayer({
        id: "selected-zones-highlight",
        type: "line",
        source: "selected-zones",
        filter: ["==", ["get", "isSelected"], true],
        paint: {
          "line-color": selectionHighlightColor,
          "line-width": 3.5,
          "line-opacity": 1,
        },
      });
    }

    const lotSource = m.getSource("selected-lots");
    if (lotSource?.setData) {
      // C6 — les ids générés changent avec la donnée : purge l'état hover.
      clearHoverState("selected-lots");
      lotSource.setData(lots);
    } else if (!lotSource) {
      // generateId : requis pour le feature-state hover (C6).
      m.addSource("selected-lots", { type: "geojson", data: lots, generateId: true });
    }
    if (!m.getLayer("selected-lots-fill")) {
      m.addLayer({
        id: "selected-lots-fill",
        type: "fill",
        source: "selected-lots",
        paint: {
          "fill-color": input.lotFillColor,
          "fill-opacity": input.lotFillOpacity,
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
          "line-color": input.lotLineColor,
          "line-width": 0.4,
          "line-opacity": 0.35,
        },
      });
    }
    // C3 — exergue ORANGE FLUO du lot sélectionné (au-dessus des contours).
    if (!m.getLayer("selected-lots-highlight")) {
      m.addLayer({
        id: "selected-lots-highlight",
        type: "line",
        source: "selected-lots",
        filter: ["==", ["get", "isSelected"], true],
        paint: {
          "line-color": selectionHighlightColor,
          "line-width": 3,
          "line-opacity": 1,
        },
      });
    }

    m.setPaintProperty(
      "selected-zones-fill",
      "fill-opacity",
      input.zoneFillOpacity,
    );
    m.setPaintProperty("selected-lots-fill", "fill-color", input.lotFillColor);
    m.setPaintProperty(
      "selected-lots-fill",
      "fill-opacity",
      input.lotFillOpacity,
    );
    m.setPaintProperty(
      "selected-lots-outline",
      "line-color",
      input.lotLineColor,
    );
  }

  function buildApi(): GeoCityMapApi {
    return {
      flyTo,
      fitMapToBounds,
      resetToInitialView,
      syncGeoLayers,
      getCityBoundary,
      hasCityBoundary,
      get themeElement() {
        return mapContainer ?? null;
      },
    };
  }

  // ── Init MapLibre ──────────────────────────────────────────────────────────
  async function initMap(): Promise<void> {
    if (!mapContainer) return;
    try {
      const maplibre = (await import("maplibre-gl")).default;
      // C10 — fond « neutral-gray » : aplat gris + raster OSM DÉSATURÉ
      // (saturation -1) et éclairci, pour faire ressortir zones/lots façon
      // carte de référence. Aucune dépendance tuiles supplémentaire.
      const baseLayers =
        basemap === "neutral-gray"
          ? [
              {
                id: "neutral-background",
                type: "background" as const,
                paint: { "background-color": "#e8eaed" },
              },
              {
                id: "osm-background",
                type: "raster" as const,
                source: "osm-tiles",
                paint: {
                  "raster-opacity": 0.45,
                  "raster-saturation": -1,
                  "raster-brightness-min": 0.35,
                },
              },
            ]
          : [
              {
                id: "osm-background",
                type: "raster" as const,
                source: "osm-tiles",
                paint: { "raster-opacity": 0.6 },
              },
            ];
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
          layers: baseLayers,
        },
        center: INITIAL_CENTER,
        zoom: INITIAL_ZOOM,
        maxBounds: MAX_BOUNDS,
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

        // Couche aplat fill choroplèthe (couleur/opacité pilotées par les props)
        m.addLayer({
          id: "cities-fill",
          type: "fill",
          source: "cities-polygons",
          paint: {
            "fill-color": fillColorExpression,
            ...(fillOpacityExpression !== undefined
              ? { "fill-opacity": fillOpacityExpression }
              : {}),
            "fill-outline-color": fillOutlineColor,
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

        // Couche labels sur les polygones
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

        // Interaction clic sur les aplats villes
        m.on("click", "cities-fill", (e) => {
          const features = e.features;
          if (!features || features.length === 0) return;
          const props = features[0].properties as { citySlug?: string };
          const citySlug = readString(props?.citySlug);
          if (!citySlug) return;
          onCityClick(citySlug);
        });

        m.on("mousemove", "cities-fill", (e) => {
          const props = e.features?.[0]?.properties as
            | { citySlug?: string }
            | undefined;
          m.getCanvas().style.cursor =
            activeCitySlug === props?.citySlug ? "" : "pointer";
        });
        m.on("mouseleave", "cities-fill", () => {
          m.getCanvas().style.cursor = "";
        });

        mapReady = true;
        // C9 — capture le cadrage du primo-chargement (restauré au retour
        // Province / à la désélection via resetToInitialView).
        const center = m.getCenter();
        viewportMemory.captureOnce({
          center: [center.lng, center.lat],
          zoom: m.getZoom(),
        });
        applyCitiesFillPaint();
        registerGeoLayerInteractions(m);
        onReady(buildApi());
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

  onMount(() => {
    void initMap();
  });
</script>

<div class="relative h-full w-full overflow-hidden">
  <div bind:this={mapContainer} class="absolute inset-0"></div>

  {#if segments.length > 0 || $$slots["overlay-top-left"]}
    <div
      class="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col gap-2"
    >
      {#if segments.length > 0}
        <div
          class="inline-flex w-fit overflow-hidden rounded border border-slate-200 bg-white/95 text-xs shadow-sm"
        >
          {#each segments as seg (seg.label)}
            <button
              type="button"
              class={`px-2.5 py-1 font-semibold transition-colors ${
                activeSegment === seg.label
                  ? "bg-slate-900 text-white"
                  : seg.disabled
                    ? "text-slate-300 cursor-not-allowed"
                    : "text-slate-600 hover:bg-slate-100 cursor-pointer"
              }`}
              aria-pressed={activeSegment === seg.label}
              aria-label={seg.ariaLabel ?? seg.label}
              disabled={seg.disabled}
              onclick={() => onSegmentClick(seg.label)}
            >
              {seg.label}
            </button>
          {/each}
        </div>
      {/if}
      <slot name="overlay-top-left" />
    </div>
  {/if}

  <!-- C1 — légendes posées SUR LA CARTE par le consommateur (blocs multiples,
       ex. Zonage au-dessus de Lots) : slot bottom-left, complémentaire de la
       prop `legend` (vue Sources). -->
  {#if $$slots["overlay-bottom-left"]}
    <div class="absolute bottom-3 left-3 z-10 flex max-w-xs flex-col gap-2">
      <slot name="overlay-bottom-left" />
    </div>
  {/if}

  {#if legend}
    <div
      class="absolute bottom-3 left-3 z-10 max-w-xs rounded border border-slate-200 bg-white/95 px-3 py-2 shadow-sm"
    >
      <p
        class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400"
      >
        {legend.title}
      </p>
      <ul class="space-y-1">
        {#each legend.items as item (item.label)}
          <li class="flex items-center gap-2 text-xs text-slate-600">
            <span
              class="h-3 w-3 rounded-sm border border-slate-300 shrink-0"
              style="background-color: {item.color};"
            ></span>
            {item.label}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if !mapReady}
    <div
      class="absolute inset-0 flex items-center justify-center bg-slate-100"
    >
      <span class="text-xs text-slate-400">Chargement de la carte…</span>
    </div>
  {/if}

  <slot />
</div>
