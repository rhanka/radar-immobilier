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
  import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

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

  // ── Props : cycle de vie ───────────────────────────────────────────────────
  /** Appelé une fois la carte prête, avec l'API impérative du socle. */
  export let onReady: (api: GeoCityMapApi) => void = () => {};

  // ── État MapLibre interne ──────────────────────────────────────────────────
  let mapContainer: HTMLDivElement;
  let mapInstance: unknown = null;
  let mapReady = false;
  const cityBoundaryBySlug = new Map<string, GeoJsonGeometry>();

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
