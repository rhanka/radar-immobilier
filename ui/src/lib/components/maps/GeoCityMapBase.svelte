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
    /**
     * R3 — segment SUR LE CHEMIN ACTIF (surligné). Permet de garder « Zone » ON
     * quand un LOT est sélectionné (on voit les deux : zone active + lot). Si non
     * fourni, le socle retombe sur `activeSegment === label` (niveau courant seul).
     */
    active?: boolean;
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
     * Contrat « lot suivant » — RECENTRE la caméra sur un point EN GARDANT le
     * zoom courant (`easeTo({ center, zoom: getZoom() })`). JAMAIS fitBounds :
     * fitBounds change le zoom.
     */
    recenterKeepZoom(center: [number, number], options?: { duration?: number }): void;
    /**
     * C9 — restaure le CADRAGE INITIAL (centre + zoom du primo-chargement),
     * capturé une fois la carte chargée. Retour Province / désélection.
     * Retourne false si aucun viewport initial n'a pu être capturé.
     */
    resetToInitialView(options?: { duration?: number }): boolean;
    /** (Re)peint les couches zone/lot à partir des données + expressions fournies. */
    syncGeoLayers(input: GeoLayersInput): void;
    /**
     * (Re)peint l'overlay CPTAQ (aplat « zone agricole protégée ») SOUS les
     * couches zone/lot. Une FeatureCollection vide masque l'overlay — jamais de
     * removeLayer/removeSource (additif strict, aucune course de teardown).
     */
    setCptaqData(features: GeoJsonFeatureCollectionLike): void;
    /**
     * §7 R2 — EMPHASE hover/focus de l'entrée de légende « Agricole (CPTAQ) » :
     * `true` accentue l'opacité de l'aplat `cptaq-fill` UNIQUEMENT (aplat
     * temporaire même en Satellite où le repos vaut 0) ; `false` revient à
     * l'opacité de repos (0 en Satellite, valeur Plan sinon). Isolé à
     * `cptaq-fill` : aucune autre surface, aucun changement de filtre zonage.
     */
    setCptaqLegendEmphasis(active: boolean): void;
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
  import { onMount, onDestroy, tick } from "svelte";
  // §6 R2 — glyph légende = lucide `Map` (aliasé `MapIcon` pour ne PAS masquer le
  // constructeur JS `Map` utilisé dans ce fichier). `ListTree` et `Satellite` sont
  // retirés avec les deux boutons #646 ; le contrôle de fond est désormais un menu
  // DS (un seul trigger lucide `Layers`, cf. §4 R2).
  import { Check, Map as MapIcon, Ruler } from "@lucide/svelte";
  import {
    Icon,
    MenuPopover,
    MenuTriggerButton,
  } from "@sentropic/design-system-svelte";
  import { isDegenerateBounds } from "$lib/maps/geometry-bounds.js";
  import { createViewportMemory } from "$lib/maps/viewport-memory.js";
  import { isSatelliteBasemapEnabled, resolveMintUrl } from "$lib/maps/geo-sat-basemap.js";
  import {
    zoneOverlayPaint,
    surfaceFillOpacity,
    SAT_CITY_LINE_WIDTH,
    type SurfaceMode,
    ZONE_CASING_TOKEN,
    ZONE_CASING_FALLBACK,
  } from "$lib/maps/zone-overlay-style.js";
  import { resolveMapColor } from "$lib/maps/score-color-scale.js";
  import {
    buildMeasureLineData,
    buildMeasurePointsData,
    formatDistanceFr,
    lastSegmentMeters,
    totalDistanceMeters,
    type LngLatTuple,
  } from "$lib/maps/measure.js";
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
  // §3 — le contour région vient UNIQUEMENT de la couche `cities-outline`
  // (type:"line") ; le `fill-outline-color` redondant de `cities-fill` est retiré
  // (et avec lui l'ancienne prop `fillOutlineColor`, qui ne le nourrissait plus).

  // ── Props : interactions ───────────────────────────────────────────────────
  /** Ville active : supprime le curseur « pointer » sur son polygone (parité). */
  export let activeCitySlug: string | null = null;
  /** Clic sur un polygone ville. */
  export let onCityClick: (citySlug: string) => void = () => {};
  /** Clic sur un aplat zone (couche `selected-zones-fill`). */
  export let onZoneClick: (zone: { citySlug: string; code: string }) => void =
    () => {};
  /**
   * Clic sur un aplat lot (couche `selected-lots-fill`). Le payload porte la
   * `zoneCode` contenante (servie par geo) pour que le consommateur applique la
   * règle 1 (en vue ville, le clic lot RÉSOUT vers sa zone, pas de sélection lot).
   */
  export let onLotClick: (lot: {
    noLot: string;
    citySlug: string | null;
    zoneCode: string | null;
  }) => void = () => {};
  /**
   * C3 — les lots sont-ils INTERACTIFS ? `true` (défaut, parité des autres
   * consommateurs) : clic, survol (feature-state.hover) et curseur pointer
   * actifs. `false` (vue Signaux hors zone/lot actif) : les lots restent
   * VISIBLES mais PASSIFS (aucun de ces effets) ; les polygones ZONE
   * redeviennent la cible de hit/survol (cf. l'ordre de pile piloté par
   * `applyLayerOrder`). Lue RÉACTIVEMENT à l'appel des handlers (comme
   * `measureActive`), jamais capturée à l'enregistrement.
   */
  export let lotsSelectable = true;

  /**
   * R1 (01KZKFBC5BR2NB15BEEJ0AWQNG) — code de la ZONE ACTIVE. Quand une zone est
   * active, SEULS ses lots (`zoneCode === activeZoneCode`) sont sélectionnables /
   * survolables comme lots ; un clic sur un lot HORS de la zone active laisse la
   * couche zone sous-jacente sélectionner SA zone (= switch), comme au niveau
   * ville. `null` ⇒ pas de bornage (niveau ville, où `lotsSelectable` est faux).
   * Lue RÉACTIVEMENT dans les handlers (comme `lotsSelectable`).
   */
  export let activeZoneCode: string | null = null;

  // ── Props : drill segmenté + légende ───────────────────────────────────────
  /** Segments du drill (Province / Ville / Zone …). Vide ⇒ pas de control. */
  export let segments: GeoSegment[] = [];
  /** Libellé du segment actif. */
  export let activeSegment: string = "";
  /** Clic sur un segment. */
  export let onSegmentClick: (label: string) => void = () => {};
  /** Légende overlay paramétrable. `null` ⇒ aucune légende rendue par le socle. */
  export let legend: GeoMapLegend | null = null;
  /**
   * C3 — couleur d'exergue de sélection par défaut (orange fluo). Sert de base
   * aux exergues zone/lot ci-dessous (rétro-compat des consommateurs Sources /
   * Couverture qui ne pilotent pas les deux couleurs séparément).
   */
  export let selectionHighlightColor = "#ff6d00";
  /**
   * R2 (01KZKFBCBWEATSMHYP5ZPJHBM1) — couleur de l'exergue du LOT sélectionné.
   * Le LOT porte l'ORANGE ; c'est la ZONE qui vire au BRUN quand un lot est
   * sélectionné (voir `zoneHighlightColor`). Défaut = `selectionHighlightColor`.
   */
  export let lotHighlightColor = selectionHighlightColor;
  /**
   * R2 — couleur de l'exergue de la ZONE active. ORANGE zone-seule ; le
   * consommateur la passe en BRUN (#9a3412) DÈS QU'UN LOT est sélectionné → le lot
   * prend l'orange, la zone le brun, contours dissociés. Défaut = orange.
   */
  export let zoneHighlightColor = selectionHighlightColor;

  // ── Props : libellés sur les polygones (m5) ────────────────────────────────
  // Affiche le n° de lot / le n° de zone directement sur les aplats (couches
  // symbol dédiées). Désactivés par défaut (les polygones sont denses) ; le
  // consommateur porte l'état (persisté en session) et le bascule via ces props.
  /** Affiche le n° de lot (`noLot`) au centre des aplats de lot. */
  export let showLotLabels = false;
  /** Affiche le n° de zone (`code`) au centre des aplats de zone. */
  export let showZoneLabels = false;

  // ── Props : fond de carte (§5 2-modes) ─────────────────────────────────────
  /**
   * Mode de FOND : `'plan'` (défaut — aplats remplis sur OSM/neutral, STRICTEMENT
   * le comportement d'avant §5) ou `'satellite'` (imagerie + overlays zone en
   * contour/casing, cf. zoneOverlayPaint). `initMap` ne construit le fond
   * satellite QUE si ce mode vaut `'satellite'` ; sinon `sat = null` → OSM.
   * Contrainte MapLibre : `transformRequest` n'est PAS modifiable au runtime →
   * un changement de mode APRÈS montage RÉ-INITIALISE la carte (viewport
   * préservé), cf. le bloc réactif de ré-init plus bas.
   */
  export let basemapMode: "plan" | "satellite" = "plan";
  /**
   * Notifié quand le mode `'satellite'` était demandé mais que le fond satellite
   * n'a pas pu être construit (mint indisponible / erreur) → repli OSM. Le mode
   * NE retombe PAS sur plan (le consommateur reste en satellite et affiche une
   * notice de repli). No-op par défaut.
   */
  export let onBasemapFallback: () => void = () => {};
  /**
   * §2 point 2 / §5.1 — affiche le groupe de contrôle « Fond de carte »
   * (Plan / Satellite) dans les contrôles bas-droit. Le consommateur passe
   * `showBasemapControl={satelliteHostAllowed}` (prod plan-only ⇒ `false` ⇒
   * aucun groupe, pas de segmented-control dégénéré). Défaut `false` (routes
   * Plan-seulement comme SourceCoverageMap : aucun contrôle de fond).
   */
  export let showBasemapControl = false;
  /**
   * §2 point 2 / §5.2 — writer UNIQUE de bascule du fond, appelé par les boutons
   * Plan / Satellite du socle. Le consommateur y branche sa persistance
   * (`setBasemap`) qui change la prop `basemapMode` → ré-initialisation du socle.
   */
  export let onBasemapModeChange: (mode: "plan" | "satellite") => void = () => {};

  // ── Props : cycle de vie ───────────────────────────────────────────────────
  /** Appelé une fois la carte prête, avec l'API impérative du socle. */
  export let onReady: (api: GeoCityMapApi) => void = () => {};

  // ── État MapLibre interne ──────────────────────────────────────────────────
  let mapContainer: HTMLDivElement;
  let mapInstance: unknown = null;
  let mapReady = false;
  // Résilience `load` — garde d'idempotence de la finalisation. Posé (SYNCHRONE,
  // avant tout `await`) par `finalizeMapSetup` : empêche une double-exécution si
  // l'event `'load'` de MapLibre ET le repli-timeout se déclenchent en course
  // (sinon double `addSource` → throw « source already exists »).
  let mapSetupStarted = false;
  // Résilience `load` — handle du timeout de repli (annulé dès la finalisation ou
  // au démontage). `undefined` tant qu'aucune carte n'est en cours d'init.
  let readyFallbackTimer: ReturnType<typeof setTimeout> | undefined;
  // §5 2-modes — `true` quand le fond satellite est actif (host-allowlisté).
  // Positionné dans initMap dès la résolution du basemap, AVANT la 1re pose des
  // couches zone : conditionne le STYLE des overlays zone (aplats en plan vs
  // contour+casing couleur-famille en satellite, cf. zoneOverlayPaint).
  let satelliteActive = false;
  // §5 R3 — texte d'attribution PROVIDER du fond satellite, résolu DYNAMIQUEMENT
  // par viewport (cf. wireSatelliteAttribution) et rendu dans l'overlay léger
  // contextuel (`data-attribution-layer="satellite"`). Vide = aucun provider
  // résolu (plan / repli OSM → l'overlay affiche « © OpenStreetMap »).
  let satelliteAttributionText = "";
  // §5 2-modes — mode avec lequel la carte COURANTE a été construite (capté au
  // début d'`initMap`, AVANT tout `await`). Le bloc réactif de ré-init compare
  // ce témoin à la prop `basemapMode` : quand ils divergent APRÈS montage, la
  // carte est détruite puis reconstruite dans le nouveau mode (contrainte
  // `transformRequest` non-runtime). Égal à `basemapMode` à l'init → aucune
  // ré-init parasite au premier montage.
  let builtBasemapMode: "plan" | "satellite" = basemapMode;
  // Garde d'idempotence de la ré-init : interdit deux reconstructions
  // concurrentes (une ré-init en vol ne doit pas en déclencher une seconde).
  let reinitializing = false;
  const cityBoundaryBySlug = new Map<string, GeoJsonGeometry>();
  // C9 — mémoire du cadrage initial (capturé au `load`, restauré à la demande).
  const viewportMemory = createViewportMemory();
  // C6 — id de la feature survolée par source (feature-state hover).
  const hoveredFeatureIdBySource = new Map<string, number | string>();

  // ── Outil « mesurer une distance » (façon Google Maps) ─────────────────────
  // Mode mesure ACTIF : chaque clic ajoute un sommet ; une polyligne relie les
  // sommets ; double-clic / Échap / re-clic du bouton = terminer (fige la
  // mesure sans l'effacer et réactive l'interaction normale) ; « Effacer »
  // remet à zéro (sources/couches retirées proprement).
  const MEASURE_LINE_ID = "measure-line";
  const MEASURE_POINTS_ID = "measure-points";
  /** Couleur du tracé de mesure (hex requis par MapLibre — feedback-info DS). */
  const MEASURE_COLOR = "#2563eb";
  let measureActive = false;
  let measurePoints: LngLatTuple[] = [];
  // Responsive (01KZKZ4B0Y0E3DFSHNE9TXGE50) — légendes bas-gauche REPLIÉES par
  // défaut derrière une icône (gain de place, surtout sur mobile) ; tap = déplie.
  let legendsOpen = false;
  // §2 point 7 — id stable du panneau légende pour `aria-controls` sur le bouton.
  const LEGEND_PANEL_ID = "geo-map-legend-panel";

  // §4 R2 — menu « Fond de carte » : UN seul trigger lucide `Layers` (remplace les
  // deux boutons #646), ouvrant un menu DS VERS LE HAUT (placement="top-end", vu la
  // position bas-droit). Deux options radio Plan / Satellite (PLAN par défaut). Le
  // popover DS gère clic-extérieur ; Échap est traité par `handleMeasureKeydown`
  // (popover `closeOnEscape={false}`) pour fermer ET rendre le focus au trigger.
  let basemapMenuOpen = false;
  // Ancre du popover (span wrapper) : `MenuPopover.trigger` attend un élément HTML.
  let basemapMenuAnchor: HTMLElement | null = null;
  // Conteneur `role="menu"` (rendu seulement à l'ouverture) : sert la navigation
  // clavier (flèches/Home/End) et la focalisation de l'option active.
  let basemapMenuList: HTMLElement | null = null;
  const BASEMAP_MENU_ID = "geo-map-basemap-menu";

  // §5.3 point 3 — état EFFECTIF du fond, distinct de l'intention `basemapMode` :
  //  - `"satellite-2d"`     : l'imagerie satellite rend réellement ;
  //  - `"fallback-map-2d"`  : satellite demandé mais repli OSM (mint indispo OU
  //    erreur dure de tuile `sat-2d` attribuée à la source) ;
  //  - `null`               : intention Plan (aucun repli à signaler).
  let effectiveBasemap: "satellite-2d" | "fallback-map-2d" | null = null;
  // §5.3 point 3/4 — garde anti-boucle : au PREMIER échec dur attribué à `sat-2d`,
  // on reconstruit UNE fois sur OSM puis on NE retente plus automatiquement. Le
  // bouton « Réessayer » remet ce garde à zéro et reconstruit satellite une fois.
  let satelliteFailedForSession = false;
  // Notice de repli (bloc role="status" aria-live="polite"). Vraie quand un repli
  // a eu lieu alors que l'intention est satellite.
  $: satelliteFallbackNotice =
    basemapMode === "satellite" && effectiveBasemap === "fallback-map-2d";

  // §5 R3 — ATTRIBUTION contextuelle à la layer active : provider dynamique quand
  // le satellite rend RÉELLEMENT et qu'un texte est résolu, sinon mention OSM
  // (mode plan OU repli OSM). Pilote l'overlay léger hors-flux (cf. template + CSS
  // `.map-attribution`), qui REMPLACE le contrôle d'attribution par défaut MapLibre
  // (exclu) et RESTAURE la mention légale retirée en #648.
  $: attributionIsSatellite =
    satelliteActive && satelliteAttributionText.trim().length > 0;

  $: measureTotalLabel = formatDistanceFr(totalDistanceMeters(measurePoints));
  $: measureSegmentLabel = formatDistanceFr(lastSegmentMeters(measurePoints));

  // Vue par défaut : Québec (cible commune Signaux / Source).
  const INITIAL_CENTER: [number, number] = [-73.5, 45.7];
  const INITIAL_ZOOM = 7;
  const MAX_BOUNDS: [[number, number], [number, number]] = [
    [-85, 41],
    [-55, 63],
  ];

  // Résilience `load` — repli si l'event `'load'` de MapLibre ne fire pas (flap
  // réseau / requête de tuile avortée qui laisse `map.loaded()` en attente, ex.
  // ERR_NETWORK_CHANGED sous navigateur partagé) : au bout de ce délai, on force
  // la finalisation (pose des couches + `mapReady = true`) pour ne jamais laisser
  // l'overlay « Chargement… » figé. 6 s = marge confortable au-delà du `load`
  // nominal, sans laisser l'utilisateur devant un écran vide trop longtemps.
  const MAP_READY_FALLBACK_MS = 6000;

  type MapLayerEvent = {
    features?: Array<{ properties?: Record<string, unknown> }>;
    originalEvent?: { stopPropagation?: () => void };
  };

  // Événement du clic MAP-LEVEL (R1 — décideur unique zone/lot, cf.
  // registerGeoLayerInteractions) : porte le point pixel pour queryRenderedFeatures.
  type MapClickEvent = {
    point: unknown;
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

  // §1 — mode de fond EFFECTIVEMENT rendu (satellite réel vs plan/repli OSM).
  // Connu en TypeScript au montage/ré-montage : sert l'invariant `surfaceFillOpacity`
  // et le basculement contour région (§3).
  function currentSurfaceMode(): SurfaceMode {
    return satelliteActive ? "satellite" : "plan";
  }

  // ── Choroplèthe villes : application réactive de la peinture ───────────────
  function applyCitiesFillPaint(): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      getLayer: (id: string) => unknown;
      setPaintProperty: (layer: string, prop: string, value: unknown) => void;
    };
    if (!m.getLayer("cities-fill")) return;
    const surfaceMode = currentSurfaceMode();
    m.setPaintProperty("cities-fill", "fill-color", fillColorExpression);
    // §1/§3 — l'opacité d'aplat passe par l'invariant : 0 en satellite (l'imagerie
    // transparaît), expression plan sinon. Toujours posée (défaut 1 hors expression).
    m.setPaintProperty(
      "cities-fill",
      "fill-opacity",
      surfaceFillOpacity(surfaceMode, fillOpacityExpression ?? 1),
    );
    // §3 — en satellite, la MEANING région passe au CONTOUR : `cities-outline`
    // reprend l'EXPRESSION couleur du choroplèthe (= couleur de la légende). On la
    // réapplique ici pour qu'un changement de filtre Signaux/KPI mette à jour le
    // contour visible (et pas l'ancien aplat invisible). En plan, contour inchangé.
    if (surfaceMode === "satellite" && m.getLayer("cities-outline")) {
      m.setPaintProperty("cities-outline", "line-color", fillColorExpression);
    }
  }

  // Réapplique la peinture choroplèthe quand les expressions changent.
  $: if (mapReady && (fillColorExpression || fillOpacityExpression)) {
    applyCitiesFillPaint();
  }

  // ── Primitives caméra (exposées via l'API) ─────────────────────────────────
  // Miroirs DOM caméra (test-only, parité avec les miroirs de libellés) : la
  // caméra est peinte sur canvas WebGL, ces attributs sont le SEUL signal DOM
  // e2e-vérifiable des commandes caméra. Trois miroirs :
  //  - data-camera-command-count : nombre TOTAL de commandes émises (permet
  //    d'asserter « reclic sur le même lot = ZÉRO nouvelle commande ») ;
  //  - data-last-camera-command : signature de la dernière commande
  //    (`fit:W,S,E,N` | `recenter:lon,lat@zoom` | `fly:lon,lat@zoom` | `reset`),
  //    coordonnées arrondies 4 décimales, zoom en précision pleine ;
  //  - data-map-zoom : zoom courant (précision pleine), rafraîchi à chaque
  //    `moveend` — permet l'égalité STRICTE avant/après un recentrage.
  let cameraCommandCount = 0;
  let lastCameraCommand: string | null = null;
  let mapZoom: string | null = null;

  function recordCameraCommand(signature: string): void {
    cameraCommandCount += 1;
    lastCameraCommand = signature;
  }

  function roundedLngLat(point: [number, number]): string {
    return point.map((n) => n.toFixed(4)).join(",");
  }

  function flyTo(options: {
    center: [number, number];
    zoom: number;
    duration: number;
  }): void {
    if (!mapInstance || !mapReady) return;
    recordCameraCommand(
      `fly:${roundedLngLat(options.center)}@${String(options.zoom)}`,
    );
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
    // Miroir DOM du cadrage (test-only) : signature W,S,E,N arrondie.
    recordCameraCommand(
      `fit:${[bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]]
        .map((n) => n.toFixed(4))
        .join(",")}`,
    );
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
   * Contrat « lot suivant » — recentre la caméra sur `center` EN GARDANT le
   * zoom courant : `easeTo({ center, zoom: getZoom() })`. JAMAIS fitBounds
   * (fitBounds change le zoom). Le zoom est lu à l'émission et passé
   * explicitement — la commande est donc auto-porteuse et vérifiable.
   */
  function recenterKeepZoom(
    center: [number, number],
    options: { duration?: number } = {},
  ): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      easeTo: (o: {
        center: [number, number];
        zoom: number;
        duration: number;
      }) => void;
      getZoom: () => number;
    };
    const zoom = m.getZoom();
    recordCameraCommand(`recenter:${roundedLngLat(center)}@${String(zoom)}`);
    m.easeTo({ center, zoom, duration: options.duration ?? 600 });
  }

  /**
   * C9 — restaure le cadrage du primo-chargement (même centre, même zoom).
   * No-op (false) si la carte n'est pas prête ou si rien n'a été capturé.
   */
  function resetToInitialView(options: { duration?: number } = {}): boolean {
    if (!mapInstance || !mapReady) return false;
    const initial = viewportMemory.initial();
    if (!initial) return false;
    recordCameraCommand("reset");
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
    on: {
      (event: string, layer: string, handler: (e: MapLayerEvent) => void): void;
      (event: string, handler: (e: MapClickEvent) => void): void;
    };
    getCanvas: () => HTMLCanvasElement;
    getLayer: (id: string) => unknown;
  }): void {
    // Accès à queryRenderedFeatures (typé PointLike côté maplibre) via cast local
    // pour éviter le conflit de variance avec la signature étroite de `m`. On
    // l'appelle comme MÉTHODE (`mq.queryRenderedFeatures(...)`) pour préserver le
    // binding `this` : une extraction en const perdrait `this` → maplibre lit
    // `this.style` → throw.
    const mq = m as unknown as {
      queryRenderedFeatures: (
        point: unknown,
        opts: { layers: string[] },
      ) => Array<{
        layer?: { id?: string };
        properties?: Record<string, unknown>;
      }>;
    };
    // R1 (RÈGLE UNIQUE, ZÉRO RACE) — UN SEUL décideur de clic carte pour zone/lot.
    // Avant, deux handlers de layer distincts (`selected-zones-fill` +
    // `selected-lots-fill`) se déclenchaient pour le MÊME clic quand un lot est
    // au-dessus d'une zone : le handler ZONE posait `activeZoneCode` = zone du lot
    // AVANT que le handler LOT lise son garde (flush réactif synchrone) → garde
    // faussé → zone+lot ensemble au niveau ville. Ici on lit un SNAPSHOT de
    // `activeZoneCode` AVANT toute mutation, puis on décide ATOMIQUEMENT via
    // queryRenderedFeatures. Le clic ville (`cities-fill`) garde son handler dédié.
    m.on("click", (e: MapClickEvent) => {
      if (measureActive) return; // mode mesure : les clics servent à mesurer
      const activeZoneSnapshot = activeZoneCode; // pré-clic, jamais la valeur mutée
      const layers = ["selected-lots-fill", "selected-zones-fill"].filter((id) =>
        m.getLayer(id),
      );
      if (layers.length === 0) return;
      const feats = mq.queryRenderedFeatures(e.point, { layers });
      const lotFeat = feats.find((f) => f.layer?.id === "selected-lots-fill");
      const zoneFeat = feats.find((f) => f.layer?.id === "selected-zones-fill");
      const noLot = readString(lotFeat?.properties?.noLot);
      const lotZone = readString(lotFeat?.properties?.zoneCode);
      // Lot sélectionnable ⟺ zone active (snapshot) ET lot DANS cette zone.
      if (lotFeat && noLot && activeZoneSnapshot && lotZone === activeZoneSnapshot) {
        e.originalEvent?.stopPropagation?.();
        onLotClick({
          noLot,
          citySlug: readString(lotFeat.properties?.citySlug),
          zoneCode: lotZone,
        });
        return;
      }
      // Sinon — niveau ville OU lot hors zone active — sélectionner la ZONE sous le
      // curseur (switch), jamais le lot, jamais zone+lot.
      if (zoneFeat) {
        const citySlug = readString(zoneFeat.properties?.citySlug);
        const code = readString(zoneFeat.properties?.code);
        if (citySlug && code) {
          e.originalEvent?.stopPropagation?.();
          onZoneClick({ citySlug, code });
        }
      }
    });

    m.on("mouseenter", "selected-zones-fill", () => {
      if (measureActive) return; // conserve le crosshair de mesure
      m.getCanvas().style.cursor = "pointer";
    });
    m.on("mouseleave", "selected-zones-fill", () => {
      if (measureActive) return;
      m.getCanvas().style.cursor = "";
    });
    m.on("mouseenter", "selected-lots-fill", () => {
      if (!lotsSelectable) return; // C3 — pas de curseur pointer sur lot passif
      if (measureActive) return; // conserve le crosshair de mesure
      m.getCanvas().style.cursor = "pointer";
    });
    m.on("mouseleave", "selected-lots-fill", () => {
      if (!lotsSelectable) return; // C3 — jamais posé, rien à restaurer
      if (measureActive) return;
      m.getCanvas().style.cursor = "";
    });

    // C6 — survol : pose `feature-state.hover` sur la feature sous le curseur
    // (les sources sont créées avec generateId). Les expressions de peinture
    // du consommateur (hover-paint) réagissent à cet état — teinte accentuée,
    // blanc → gris clair. Les LOTS priment visuellement : quand le curseur est
    // sur un lot, la zone en dessous n'est pas marquée survolée.
    registerHoverState("selected-zones-fill", "selected-zones");
    // C3/R1 — le survol des LOTS (feature-state.hover → highlight) n'est actif
    // qu'en zone/lot ET uniquement pour les lots DE LA ZONE ACTIVE (bornage R1) :
    // le prédicat est lu RÉACTIVEMENT à chaque mousemove (par-feature).
    registerHoverState(
      "selected-lots-fill",
      "selected-lots",
      // R1 (règle unique) — le survol lot (highlight) n'est actif QUE si une zone
      // est active ET le lot y appartient ; sinon la zone sous-jacente se surligne.
      (f) => !!activeZoneCode && readString(f?.properties?.zoneCode) === activeZoneCode,
    );
  }

  /**
   * C6 — câble mousemove/mouseleave d'une couche vers feature-state.hover.
   * `isEnabled` (lu à chaque mousemove) permet de désactiver le survol d'une
   * couche sans la désenregistrer (C3 : lots passifs hors zone/lot actif).
   */
  function registerHoverState(
    layerId: string,
    sourceId: string,
    isEnabled: (feature?: {
      properties?: Record<string, unknown>;
    }) => boolean = () => true,
  ): void {
    const m = mapInstance as {
      on: (
        event: string,
        layer: string,
        handler: (e: {
          features?: Array<{
            id?: number | string;
            properties?: Record<string, unknown>;
          }>;
        }) => void,
      ) => void;
    };
    m.on("mousemove", layerId, (e) => {
      // R1/C3 — survol lu par-feature : couche passive OU (pour les lots) lot hors
      // zone active → on efface tout survol de CETTE source pour laisser la couche
      // sous-jacente (zone) prendre le survol.
      if (!isEnabled(e.features?.[0])) {
        clearHoverState(sourceId);
        return;
      }
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

  /**
   * m5 — Applique la visibilité des couches de libellés (n° lot / n° zone).
   * No-op tant que les couches n'existent pas (avant le 1er `syncGeoLayers`).
   */
  function applyLabelVisibility(lots: boolean, zones: boolean): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      getLayer: (id: string) => unknown;
      setLayoutProperty: (layer: string, prop: string, value: unknown) => void;
    };
    if (m.getLayer("selected-lots-label")) {
      m.setLayoutProperty(
        "selected-lots-label",
        "visibility",
        lots ? "visible" : "none",
      );
    }
    if (m.getLayer("selected-zones-label")) {
      m.setLayoutProperty(
        "selected-zones-label",
        "visibility",
        zones ? "visible" : "none",
      );
    }
  }

  // Bascule la visibilité des libellés quand les props changent (sans re-sync
  // complet des couches).
  $: if (mapReady) applyLabelVisibility(showLotLabels, showZoneLabels);

  /**
   * C3 — ordre de pile ZONES ↔ LOTS selon l'interactivité des lots.
   *
   * Les lots sont créés APRÈS les zones, donc AU-DESSUS : ils occultent le
   * survol de zone (opacité accentuée) et l'exergue de zone. Hors zone/lot
   * actif (`lotsSelectable = false`, lots passifs) on REMONTE les couches ZONE
   * au-dessus des lots pour que le survol/l'exergue de zone soient VISIBLES et
   * que la zone soit la cible de hit ; en zone/lot actif (`lotsSelectable =
   * true`) on remet les lots au-dessus (comportement par défaut). Idempotent :
   * `moveLayer(id)` sans `beforeId` renvoie la couche au sommet, donc l'ordre
   * d'itération détermine la pile finale (dernier = sommet). Les libellés et le
   * tracé de mesure restent au-dessus de tout.
   */
  function applyLayerOrder(lotsOnTop: boolean): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      getLayer: (id: string) => unknown;
      moveLayer: (id: string) => void;
    };
    const zoneLayers = [
      "selected-zones-fill",
      // §5 2-modes — casing AVANT le contour → rendu DESSOUS (liseré sombre sous
      // le trait famille). Présent seulement en satellite ; guard getLayer plus
      // bas → no-op en plan (aucun impact sur l'ordre du mode plan).
      "selected-zones-outline-casing",
      "selected-zones-outline",
      "selected-zones-highlight",
    ];
    const lotLayers = [
      "selected-lots-fill",
      "selected-lots-outline",
      "selected-lots-highlight",
    ];
    // Overlay CPTAQ toujours SOUS zones/lots : itéré EN PREMIER → `moveLayer` le
    // renvoie au sommet, puis zones/lots repassent au-dessus (dernier = sommet).
    // Position déterministe quel que soit l'ordre de création (toggle tardif).
    const cptaqLayers = ["cptaq-fill", "cptaq-outline"];
    const ordered = lotsOnTop
      ? [...cptaqLayers, ...zoneLayers, ...lotLayers]
      : [...cptaqLayers, ...lotLayers, ...zoneLayers];
    for (const id of ordered) {
      if (m.getLayer(id)) m.moveLayer(id);
    }
    // Les libellés restent lisibles au sommet des aplats/contours.
    if (m.getLayer("selected-zones-label")) m.moveLayer("selected-zones-label");
    if (m.getLayer("selected-lots-label")) m.moveLayer("selected-lots-label");
    // Le tracé de mesure prime toujours.
    ensureMeasureLayersOnTop();
  }

  // C3 — réordonne la pile quand l'interactivité des lots change SANS re-sync
  // (idempotent). Purge aussi tout survol de lot resté « accroché » au passage
  // en mode passif, pour ne pas figer un highlight de lot hors zone/lot actif.
  $: if (mapReady) {
    applyLayerOrder(lotsSelectable);
    if (!lotsSelectable) clearHoverState("selected-lots");
  }

  // R2 — met à jour RÉACTIVEMENT les couleurs d'exergue sans re-sync : la ZONE
  // passe au brun (`zoneHighlightColor`) dès qu'un lot est sélectionné, le LOT
  // garde l'orange (`lotHighlightColor`). Idempotent, no-op avant création couche.
  function applyHighlightColors(zoneColor: string, lotColor: string): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      getLayer: (id: string) => unknown;
      setPaintProperty: (layer: string, prop: string, value: unknown) => void;
    };
    if (m.getLayer("selected-zones-highlight")) {
      m.setPaintProperty("selected-zones-highlight", "line-color", zoneColor);
    }
    if (m.getLayer("selected-lots-highlight")) {
      m.setPaintProperty("selected-lots-highlight", "line-color", lotColor);
    }
  }
  $: if (mapReady) applyHighlightColors(zoneHighlightColor, lotHighlightColor);

  /**
   * §7 R2 — couleur CPTAQ = SEULE source token agricole DS
   * (`--st-semantic-data-category5`, kind « A » de zone-kind-style), repli
   * `#59A14F`. Sert le `fill-color` ET le `line-color` ; l'ancien hex isolé
   * `#65a30d` de l'aplat est retiré (langage couleur unique du zonage).
   */
  const CPTAQ_COLOR_TOKEN = "--st-semantic-data-category5";
  const CPTAQ_COLOR_FALLBACK = "#59A14F";
  /** Opacité d'aplat CPTAQ en mode Plan (0 en satellite via `surfaceFillOpacity`). */
  const CPTAQ_PLAN_FILL_OPACITY = 0.25;
  /**
   * §7 R2 — opacité d'aplat CPTAQ à l'EMPHASE (hover/focus de l'entrée de légende).
   * Doit DÉPASSER le repos Plan (0.25) et rendre un aplat TEMPORAIRE même en
   * Satellite (où le repos vaut 0). Le test de paint asserte hover > repos, PAS un
   * nombre exact.
   * source-gap: valeur provisoire à ratifier owner en recette.
   */
  const CPTAQ_HOVER_FILL_OPACITY = 0.5;
  // §7 R2 — état d'emphase (hover/focus de « Agricole (CPTAQ) »). Isolé à
  // `cptaq-fill`. Remis à false à chaque (ré)init de la carte (rebuild-fond, cf.
  // `initMap`) ; la vue le remet aussi à false au disable / changement de ville.
  let cptaqLegendEmphasized = false;

  /**
   * Overlay CPTAQ « zone agricole protégée » : idiome create-if-absent puis
   * `setData` (jamais removeLayer/removeSource → additif strict, aucune course
   * de teardown). Une FeatureCollection vide masque l'overlay. Rendu SOUS les
   * couches zone/lot via `applyLayerOrder`.
   */
  function setCptaqData(features: GeoJsonFeatureCollectionLike): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      getLayer: (id: string) => unknown;
      getSource: (id: string) => { setData?: (data: unknown) => void } | undefined;
      addSource: (id: string, source: unknown) => void;
      addLayer: (layer: unknown) => void;
      setPaintProperty: (layer: string, prop: string, value: unknown) => void;
      getContainer: () => HTMLElement;
    };
    const src = m.getSource("cptaq");
    if (src?.setData) {
      src.setData(features);
    } else if (!src) {
      m.addSource("cptaq", { type: "geojson", data: features });
    }
    // §1/§5/§7 — l'aplat CPTAQ suit l'invariant au REPOS (0 en satellite, 0.25 en
    // plan) ; à l'EMPHASE (hover/focus légende) il rend `CPTAQ_HOVER_FILL_OPACITY`
    // (aplat temporaire même en satellite). Le niveau sémantique ne contourne PAS
    // la politique du fond au repos.
    const surfaceMode = currentSurfaceMode();
    const cptaqRestingOpacity = surfaceFillOpacity(surfaceMode, CPTAQ_PLAN_FILL_OPACITY);
    const cptaqRenderedOpacity = cptaqLegendEmphasized
      ? CPTAQ_HOVER_FILL_OPACITY
      : cptaqRestingOpacity;
    // §7 — couleur CPTAQ unique résolue depuis le token agricole DS (theme-invariant
    // via repli hex si oklch/lab non parsable par MapLibre) : sert fill ET contour.
    const cptaqColor = resolveMapColor(
      CPTAQ_COLOR_TOKEN,
      CPTAQ_COLOR_FALLBACK,
      m.getContainer(),
    );
    if (!m.getLayer("cptaq-fill")) {
      m.addLayer({
        id: "cptaq-fill",
        type: "fill",
        source: "cptaq",
        paint: { "fill-color": cptaqColor, "fill-opacity": cptaqRenderedOpacity },
      });
    } else {
      m.setPaintProperty("cptaq-fill", "fill-color", cptaqColor);
      m.setPaintProperty("cptaq-fill", "fill-opacity", cptaqRenderedOpacity);
    }
    if (!m.getLayer("cptaq-outline")) {
      m.addLayer({
        id: "cptaq-outline",
        type: "line",
        source: "cptaq",
        paint: { "line-color": cptaqColor, "line-width": 1, "line-opacity": 0.7 },
      });
    } else {
      m.setPaintProperty("cptaq-outline", "line-color", cptaqColor);
    }
    // Garantit l'ordre CPTAQ-sous-zones/lots même si le toggle arrive tard.
    applyLayerOrder(lotsSelectable);
  }

  /**
   * §7 R2 — (ré)applique l'opacité d'aplat CPTAQ selon repos/emphase. Isolé à
   * `cptaq-fill` UNIQUEMENT : aucune autre surface, aucun changement de filtre
   * zonage. No-op tant que la couche n'existe pas.
   */
  function applyCptaqFillOpacity(): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      getLayer: (id: string) => unknown;
      setPaintProperty: (layer: string, prop: string, value: unknown) => void;
    };
    if (!m.getLayer("cptaq-fill")) return;
    const restingOpacity = surfaceFillOpacity(
      currentSurfaceMode(),
      CPTAQ_PLAN_FILL_OPACITY,
    );
    const renderedOpacity = cptaqLegendEmphasized
      ? CPTAQ_HOVER_FILL_OPACITY
      : restingOpacity;
    m.setPaintProperty("cptaq-fill", "fill-opacity", renderedOpacity);
  }

  /**
   * §7 R2 — emphase de la SEULE couche `cptaq-fill` au hover/focus de son entrée
   * de légende. `true` → aplat accentué (aplat temporaire même en satellite) ;
   * `false` → retour à l'opacité de repos (0 en satellite, valeur plan sinon).
   * Idempotent (aucun repaint si l'état ne change pas).
   */
  function setCptaqLegendEmphasis(active: boolean): void {
    if (cptaqLegendEmphasized === active) return;
    cptaqLegendEmphasized = active;
    applyCptaqFillOpacity();
  }

  function syncGeoLayers(input: GeoLayersInput): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      getLayer: (id: string) => unknown;
      getSource: (id: string) => { setData?: (data: unknown) => void } | undefined;
      addSource: (id: string, source: unknown) => void;
      addLayer: (layer: unknown) => void;
      setPaintProperty: (layer: string, prop: string, value: unknown) => void;
      setLayoutProperty: (layer: string, prop: string, value: unknown) => void;
      getContainer: () => HTMLElement;
    };

    const { zones, lots } = input;
    // §1 — mode de fond effectif : pilote l'invariant d'opacité d'aplat de TOUTES
    // les surfaces métier (zones, lots) et le style de contour lot en satellite.
    const surfaceMode = currentSurfaceMode();

    const zoneSource = m.getSource("selected-zones");
    if (zoneSource?.setData) {
      // C6 — les ids générés changent avec la donnée : purge l'état hover.
      clearHoverState("selected-zones");
      zoneSource.setData(zones);
    } else if (!zoneSource) {
      // generateId : requis pour le feature-state hover (C6).
      m.addSource("selected-zones", { type: "geojson", data: zones, generateId: true });
    }
    // §5 2-modes — style des overlays zone CONDITIONNÉ au fond. Valeurs INTERIM
    // geo-archi §5 2-modes, pending ratif DS tokens + owner :
    //  - PLAN : aplats (fill-opacity immo) + contour sombre fin — INCHANGÉ.
    //  - SATELLITE : aplat fill-opacity 0 (fill-color famille conservée =
    //    hit-area cliquable) + contour couleur-FAMILLE 2.25/1.0 + casing sombre
    //    dessous, pour que l'imagerie transparaisse et que la MEANING passe au
    //    contour. Boutons de switch = suite séparée (contrainte transformRequest).
    // Casing : couleur RATIFIÉE DS (token de fondation theme-invariant), résolue
    // depuis le conteneur monté sous le ThemeProvider comme les couleurs famille.
    const casingColor = resolveMapColor(
      ZONE_CASING_TOKEN,
      ZONE_CASING_FALLBACK,
      m.getContainer(),
    );
    const zonePaint = zoneOverlayPaint(
      satelliteActive,
      input.zoneFillColor,
      input.zoneFillOpacity,
      casingColor,
    );
    if (!m.getLayer("selected-zones-fill")) {
      m.addLayer({
        id: "selected-zones-fill",
        type: "fill",
        source: "selected-zones",
        // §3 — pas de `fill-outline-color` : le contour vient UNIQUEMENT de
        // `selected-zones-outline` (type:"line"), pilotable par mode.
        paint: {
          "fill-color": zonePaint.fill["fill-color"],
          "fill-opacity": zonePaint.fill["fill-opacity"],
        },
      });
    }
    // Casing (liseré sombre haut-contraste) posé JUSTE AVANT le contour famille
    // → dessous. Uniquement en satellite : en plan, aucune couche ajoutée (mode
    // plan strictement identique au socle). `applyLayerOrder` le range sous le
    // contour (guard getLayer → no-op si absent en plan).
    if (satelliteActive && !m.getLayer("selected-zones-outline-casing")) {
      m.addLayer({
        id: "selected-zones-outline-casing",
        type: "line",
        source: "selected-zones",
        paint: {
          "line-color": zonePaint.casing["line-color"],
          "line-width": zonePaint.casing["line-width"],
          "line-opacity": zonePaint.casing["line-opacity"],
        },
      });
    }
    if (!m.getLayer("selected-zones-outline")) {
      m.addLayer({
        id: "selected-zones-outline",
        type: "line",
        source: "selected-zones",
        paint: {
          "line-color": zonePaint.outline["line-color"],
          "line-width": zonePaint.outline["line-width"],
          "line-opacity": zonePaint.outline["line-opacity"],
        },
      });
    }
    // C3/R2 — exergue de la zone sélectionnée (contour épais). Couleur portée par
    // `zoneHighlightColor` : ORANGE zone-seule, BRUN quand un lot est sélectionné.
    if (!m.getLayer("selected-zones-highlight")) {
      m.addLayer({
        id: "selected-zones-highlight",
        type: "line",
        source: "selected-zones",
        filter: ["==", ["get", "isSelected"], true],
        paint: {
          "line-color": zoneHighlightColor,
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
        // §4 point 6 — pas de `fill-outline-color` blanc : il créait une seconde
        // frontière non reliée à la légende. La maille cadastrale vient UNIQUEMENT
        // de `selected-lots-outline`. L'opacité suit l'invariant (0 en satellite).
        paint: {
          "fill-color": input.lotFillColor,
          "fill-opacity": surfaceFillOpacity(surfaceMode, input.lotFillOpacity),
        },
      });
    }
    if (!m.getLayer("selected-lots-outline")) {
      m.addLayer({
        id: "selected-lots-outline",
        type: "line",
        source: "selected-lots",
        // §4 points 3-5 — en satellite, le contour porte la COULEUR DE LÉGENDE du
        // lot (`input.lotFillColor` : signal/priorité/4+/TOD/neutre — la branche
        // neutre est blanche, `LOT_NEUTRAL`), trait fin 0.4 opacité 1. En plan,
        // `input.lotLineColor`, 0.4, 0.35 (inchangé).
        paint: {
          "line-color": surfaceMode === "satellite" ? input.lotFillColor : input.lotLineColor,
          "line-width": 0.4,
          "line-opacity": surfaceMode === "satellite" ? 1 : 0.35,
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
          // R2 — exergue du lot DISTINCTE de la zone (brun/orange foncé ≠ orange
          // fluo de la zone), pour dissocier les deux contours.
          "line-color": lotHighlightColor,
          "line-width": 3,
          "line-opacity": 1,
        },
      });
    }

    // m5 — LIBELLÉS sur les polygones (au-dessus des aplats/contours). Couches
    // symbol dédiées, masquées par défaut (`visibility` piloté par les props).
    // La gestion de collision de MapLibre (text-optional + placement au point)
    // déleste automatiquement les étiquettes qui se chevauchent : le rendu reste
    // lisible même sur des centaines de lots.
    if (!m.getLayer("selected-zones-label")) {
      m.addLayer({
        id: "selected-zones-label",
        type: "symbol",
        source: "selected-zones",
        // La zone de repli (contour ville, code `fallback:<slug>`) n'a pas de
        // n° de zone signifiant : on ne l'étiquette pas.
        filter: ["!=", ["slice", ["get", "code"], 0, 9], "fallback:"],
        layout: {
          "text-field": ["get", "code"],
          "text-size": 11,
          "text-anchor": "center",
          "text-optional": true,
          visibility: showZoneLabels ? "visible" : "none",
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });
    }
    if (!m.getLayer("selected-lots-label")) {
      m.addLayer({
        id: "selected-lots-label",
        type: "symbol",
        source: "selected-lots",
        layout: {
          "text-field": ["get", "noLot"],
          "text-size": 10,
          "text-anchor": "center",
          "text-optional": true,
          visibility: showLotLabels ? "visible" : "none",
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });
    }
    // Garantit la cohérence visibilité ↔ props quand les couches préexistent.
    applyLabelVisibility(showLotLabels, showZoneLabels);

    // §5 2-modes — ré-applique l'opacité d'aplat selon le mode. En PLAN,
    // `zonePaint.fill["fill-opacity"]` === `input.zoneFillOpacity` (l'expression
    // immo repassée telle quelle) → comportement STRICTEMENT identique au socle.
    // En SATELLITE, opacité 0 (l'imagerie transparaît).
    m.setPaintProperty(
      "selected-zones-fill",
      "fill-opacity",
      zonePaint.fill["fill-opacity"],
    );
    // En SATELLITE uniquement, la MEANING est portée par le contour couleur
    // FAMILLE : ré-applique la teinte à l'aplat (hit-area) ET au contour au cas
    // où la famille est recolorée entre deux syncs. En PLAN, on ne touche NI la
    // fill-color NI la line-color à la sync (inchangé vs socle).
    if (satelliteActive) {
      m.setPaintProperty(
        "selected-zones-fill",
        "fill-color",
        zonePaint.fill["fill-color"],
      );
      m.setPaintProperty(
        "selected-zones-outline",
        "line-color",
        zonePaint.outline["line-color"],
      );
      // Casing : ré-applique la couleur token DS résolue (theme-invariant) si la
      // couche préexiste (résolution robuste à un theme swap entre deux syncs).
      if (m.getLayer("selected-zones-outline-casing")) {
        m.setPaintProperty(
          "selected-zones-outline-casing",
          "line-color",
          zonePaint.casing["line-color"],
        );
      }
    }
    m.setPaintProperty("selected-lots-fill", "fill-color", input.lotFillColor);
    // §6 point 6 — l'invariant enveloppe l'expression métier FINALE (sélection
    // `isSelected→0.85` ET hover via `withHoverOpacityBoost` inclus) : en satellite
    // l'aplat lot ne peut JAMAIS dépasser 0 ; en plan, l'opacité calculée est
    // restaurée sans refetch métier.
    m.setPaintProperty(
      "selected-lots-fill",
      "fill-opacity",
      surfaceFillOpacity(surfaceMode, input.lotFillOpacity),
    );
    // §4 — contour lot dépendant du mode (couleur légende + opacité 1 en satellite,
    // `input.lotLineColor` + 0.35 en plan). La largeur 0.4 est constante (création).
    m.setPaintProperty(
      "selected-lots-outline",
      "line-color",
      surfaceMode === "satellite" ? input.lotFillColor : input.lotLineColor,
    );
    m.setPaintProperty(
      "selected-lots-outline",
      "line-opacity",
      surfaceMode === "satellite" ? 1 : 0.35,
    );

    // Les couches zone/lot viennent d'être (re)posées : rétablit l'ordre de
    // pile selon l'interactivité des lots (C3) — qui remet aussi la mesure au
    // sommet — pour que le survol/l'exergue de zone du niveau ville ne soient
    // pas occultés par les lots fraîchement ajoutés au-dessus.
    applyLayerOrder(lotsSelectable);
  }

  // ── Outil mesure : mécanique carte ─────────────────────────────────────────
  function setMapCursor(cursor: string): void {
    if (!mapInstance) return;
    (
      mapInstance as { getCanvas: () => HTMLCanvasElement }
    ).getCanvas().style.cursor = cursor;
  }

  /** (Re)pose sources + couches `measure-line`/`measure-points` et les met à jour. */
  function syncMeasureLayers(): void {
    if (!mapInstance || !mapReady) return;
    const m = mapInstance as {
      getLayer: (id: string) => unknown;
      getSource: (id: string) => { setData?: (data: unknown) => void } | undefined;
      addSource: (id: string, source: unknown) => void;
      addLayer: (layer: unknown) => void;
    };
    const lineData = buildMeasureLineData(measurePoints);
    const pointsData = buildMeasurePointsData(measurePoints);

    const lineSource = m.getSource(MEASURE_LINE_ID);
    if (lineSource?.setData) {
      lineSource.setData(lineData);
    } else if (!lineSource) {
      m.addSource(MEASURE_LINE_ID, { type: "geojson", data: lineData });
    }
    const pointsSource = m.getSource(MEASURE_POINTS_ID);
    if (pointsSource?.setData) {
      pointsSource.setData(pointsData);
    } else if (!pointsSource) {
      m.addSource(MEASURE_POINTS_ID, { type: "geojson", data: pointsData });
    }

    if (!m.getLayer(MEASURE_LINE_ID)) {
      m.addLayer({
        id: MEASURE_LINE_ID,
        type: "line",
        source: MEASURE_LINE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": MEASURE_COLOR,
          "line-width": 2.5,
          "line-dasharray": [1.5, 1.25],
        },
      });
    }
    if (!m.getLayer(MEASURE_POINTS_ID)) {
      m.addLayer({
        id: MEASURE_POINTS_ID,
        type: "circle",
        source: MEASURE_POINTS_ID,
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#ffffff",
          "circle-stroke-color": MEASURE_COLOR,
          "circle-stroke-width": 2,
        },
      });
    }
    ensureMeasureLayersOnTop();
  }

  /**
   * Garde le tracé de mesure AU-DESSUS des couches zone/lot : `syncGeoLayers`
   * ajoute ses couches en fin de pile, ce qui recouvrirait la mesure.
   */
  function ensureMeasureLayersOnTop(): void {
    if (!mapInstance) return;
    const m = mapInstance as {
      getLayer: (id: string) => unknown;
      moveLayer: (id: string) => void;
    };
    // moveLayer sans beforeId ⇒ envoie la couche au sommet de la pile.
    if (m.getLayer(MEASURE_LINE_ID)) m.moveLayer(MEASURE_LINE_ID);
    if (m.getLayer(MEASURE_POINTS_ID)) m.moveLayer(MEASURE_POINTS_ID);
  }

  /** Effacer : remise à zéro + retrait PROPRE des sources/couches de mesure. */
  function clearMeasure(): void {
    measurePoints = [];
    if (!mapInstance) return;
    const m = mapInstance as {
      getLayer: (id: string) => unknown;
      removeLayer: (id: string) => void;
      getSource: (id: string) => unknown;
      removeSource: (id: string) => void;
    };
    for (const id of [MEASURE_POINTS_ID, MEASURE_LINE_ID]) {
      if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource(id)) m.removeSource(id);
    }
  }

  function enterMeasureMode(): void {
    measureActive = true;
    setMapCursor("crosshair");
  }

  /** Terminer/figer : sort du mode SANS effacer, réactive l'interaction normale. */
  function exitMeasureMode(): void {
    measureActive = false;
    setMapCursor("");
  }

  function toggleMeasureMode(): void {
    if (measureActive) exitMeasureMode();
    else enterMeasureMode();
  }

  /**
   * Échap — §2 point 7 : ferme une mesure EN COURS (fige sans effacer) ET/OU la
   * légende ouverte. N'efface jamais une mesure terminée (exitMeasureMode ne
   * touche pas `measurePoints`).
   */
  function handleMeasureKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (measureActive) exitMeasureMode();
    if (legendsOpen) legendsOpen = false;
    // §4.3 R2 — Échap ferme le menu de fond et REND le focus au trigger (le
    // popover DS a `closeOnEscape={false}` → un seul point de traitement ici).
    if (basemapMenuOpen) closeBasemapMenu(true);
  }

  // ── §4 R2 — menu « Fond de carte » : ouverture/fermeture + clavier/ARIA ──────
  /** Boutons d'option (role="menuitemradio") présents dans le popover ouvert. */
  function basemapOptionButtons(): HTMLButtonElement[] {
    if (!basemapMenuList) return [];
    return Array.from(
      basemapMenuList.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    );
  }

  /** Focalise l'option ACTIVE (aria-checked), sinon la première. */
  function focusActiveBasemapOption(): void {
    const items = basemapOptionButtons();
    const active =
      items.find((b) => b.getAttribute("aria-checked") === "true") ?? items[0];
    active?.focus();
  }

  /** Rend le focus au bouton déclencheur (dans le span d'ancrage). */
  function focusBasemapTrigger(): void {
    basemapMenuAnchor?.querySelector("button")?.focus();
  }

  /** Ouvre le menu et focalise l'option active une fois le popover rendu. */
  function openBasemapMenu(): void {
    basemapMenuOpen = true;
    void tick().then(() => focusActiveBasemapOption());
  }

  /** Ferme le menu ; `restoreFocus` rend le focus au trigger (Échap / sélection). */
  function closeBasemapMenu(restoreFocus = false): void {
    basemapMenuOpen = false;
    if (restoreFocus) focusBasemapTrigger();
  }

  /** Clic / Entrée / Espace sur le trigger : bascule l'ouverture. */
  function toggleBasemapMenu(): void {
    if (basemapMenuOpen) closeBasemapMenu();
    else openBasemapMenu();
  }

  /** Flèche bas / haut sur le trigger : ouvrir et focaliser l'option active. */
  function handleBasemapTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!basemapMenuOpen) openBasemapMenu();
      else focusActiveBasemapOption();
    }
  }

  /** Navigation clavier DANS le menu : flèches en boucle, Home/End aux extrémités. */
  function handleBasemapMenuKeydown(event: KeyboardEvent): void {
    const items = basemapOptionButtons();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(current + 1 + items.length) % items.length].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length].focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1].focus();
    }
    // Entrée / Espace : activation NATIVE du <button> option → `selectBasemap`.
  }

  /** Sélection d'une option : writer UNIQUE `onBasemapModeChange`, ferme + focus. */
  function selectBasemap(mode: "plan" | "satellite"): void {
    onBasemapModeChange(mode);
    closeBasemapMenu(true);
  }

  function addMeasurePoint(point: LngLatTuple): void {
    measurePoints = [...measurePoints, point];
    syncMeasureLayers();
  }

  /** Câble clic (ajout de sommet) + double-clic (terminer, zoom neutralisé). */
  function registerMeasureInteractions(m: {
    on: (
      event: string,
      handler: (e: {
        lngLat: { lng: number; lat: number };
        originalEvent?: MouseEvent;
        preventDefault: () => void;
      }) => void,
    ) => void;
  }): void {
    m.on("click", (e) => {
      if (!measureActive) return;
      // Second clic d'un double-clic (detail ≥ 2) : ne pas dupliquer le sommet.
      if ((e.originalEvent?.detail ?? 1) > 1) return;
      addMeasurePoint([e.lngLat.lng, e.lngLat.lat]);
    });
    m.on("dblclick", (e) => {
      if (!measureActive) return;
      e.preventDefault(); // neutralise le double-click zoom en mode mesure
      exitMeasureMode();
    });
  }

  function buildApi(): GeoCityMapApi {
    return {
      flyTo,
      fitMapToBounds,
      recenterKeepZoom,
      resetToInitialView,
      syncGeoLayers,
      setCptaqData,
      setCptaqLegendEmphasis,
      getCityBoundary,
      hasCityBoundary,
      get themeElement() {
        return mapContainer ?? null;
      },
    };
  }

  // ── §5 — basemap satellite 2D (Google Map Tiles) ────────────────────────────
  // OFF ⇒ fond OSM inchangé. ON ⇒ satellite via l'adapter geo-map-engine
  // `createGoogle2dBasemapAdapter` (ADR-0025, zéro-copie : on SPREAD ses sorties
  // — basemap/resolveRasterSource/transformRequest — sans jamais réimplémenter).
  // Toute erreur (mint 503 pré-GO, session, réseau) → repli OSM (onError→OSM).
  // Aucun secret côté client : session + clé restreinte vivent dans les closures
  // de l'adapter (mint geo-api `VITE_GEO_SAT_MINT_URL`). Attribution DYNAMIQUE
  // per-viewport rendue dans le DOM.
  // Activation RUNTIME par allowlist de hosts (image CD unique préprod/prod →
  // un `VITE_` build-time ne peut pas différer) ; `VITE_GEO_SAT_BASEMAP=false`
  // = kill-switch build. Cf. geo-sat-basemap.ts. Enable + mint URL sont évalués
  // PARESSEUSEMENT dans buildSatelliteBasemap() (post-mount) : au top-level du
  // <script> (init/hydratation) `location.hostname` peut être falsy → OFF à tort.

  /** Sortie du seam satellite : source raster MapLibre + injecteurs de l'adapter. */
  interface SatelliteBasemap {
    readonly tiles: string;
    readonly tileSize: number;
    readonly transformRequest: (
      url: string,
      resourceType?: string,
    ) => { readonly url: string } | undefined;
    readonly attributionResolver:
      | ((viewport: {
          center: readonly [number, number];
          zoom: number;
          bearing: number;
          pitch: number;
        }) => Promise<string>)
      | null;
  }

  /**
   * Construit le basemap satellite via l'adapter geo-map-engine quand le flag
   * est ON. Zéro-copie : on lit `resolveRasterSource(basemap.source)` (template
   * de tuiles SANS session/clé) + `options.transformRequest` (injection
   * `?session=&key=` par tuile) + `attributionResolver` (copyright dynamique).
   * `null` si flag OFF ou toute erreur → l'appelant retombe sur OSM.
   */
  async function buildSatelliteBasemap(): Promise<SatelliteBasemap | null> {
    // Lazy (post-mount) : `window.location.hostname` est fiable ici, contrairement
    // à l'init/hydratation du <script> où il peut être falsy → OFF à tort.
    const hostname =
      typeof window !== "undefined" ? window.location.hostname : null;
    const killSwitchOff = import.meta.env.VITE_GEO_SAT_BASEMAP === "false";
    if (!isSatelliteBasemapEnabled(hostname, killSwitchOff)) return null;
    const mintUrl = resolveMintUrl(
      hostname,
      import.meta.env.VITE_GEO_SAT_MINT_URL as string | undefined,
    );
    try {
      const { createGoogle2dBasemapAdapter } = await import("@sentropic/geo-map-engine");
      const adapter = await createGoogle2dBasemapAdapter({ mintUrl });
      const spec = adapter.basemap as { source: unknown };
      const resolved = adapter.resolveRasterSource(spec.source as never);
      const attributionResolver = resolved.attributionResolver ?? null;
      // §5.3 point 2 / source-gap LICENCE — JAMAIS de tuiles satellite sans mention
      // légale : si l'adapter ne fournit pas une attribution résolvable, on REFUSE
      // le raster et on replie sur OSM. Le correctif CONSOMME l'attribution fournie
      // par l'adapter ; il n'écrit AUCUN libellé fournisseur (texte licence = SOURCE-GAP).
      if (!attributionResolver) {
        console.warn(
          "§5 — adapter satellite sans attribution résolvable : repli OSM (pas de tuiles sans mention légale)",
        );
        return null;
      }
      return {
        tiles: resolved.tileUrlTemplateBase,
        tileSize: resolved.tileSize.width,
        transformRequest: adapter.options.transformRequest,
        attributionResolver,
      };
    } catch (err) {
      // onError → OSM : le satellite ne rend jamais partiellement / sans clé.
      console.warn("§5 — basemap satellite indisponible, repli OSM:", err);
      return null;
    }
  }

  /**
   * Attribution DYNAMIQUE du fond satellite, rafraîchie à chaque viewport
   * (load + moveend) via le `attributionResolver` de l'adapter — condition
   * geo-archi : jamais de tuiles sans copyright visible. §5 R3 : le texte résolu
   * alimente désormais l'état `satelliteAttributionText`, RENDU par l'overlay
   * léger contextuel (`.map-attribution`, `data-attribution-layer="satellite"`),
   * PLUS de contrôle MapLibre séparé — l'attribution provider est intégrée au
   * MÊME overlay que la mention OSM (owner : overlay unique, léger, contextuel).
   * En cas d'échec de résolution on GARDE le dernier texte (jamais de blanchiment).
   */
  function wireSatelliteAttribution(
    map: import("maplibre-gl").Map,
    resolver: (viewport: {
      center: readonly [number, number];
      zoom: number;
      bearing: number;
      pitch: number;
    }) => Promise<string>,
  ): void {
    const update = async (): Promise<void> => {
      try {
        const c = map.getCenter();
        const text = await resolver({
          center: [c.lng, c.lat],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        });
        // Garder le dernier copyright si le resolver renvoie du vide (jamais de
        // tuiles sans attribution). Assignation réactive → l'overlay se met à jour.
        if (text && text.trim().length > 0) satelliteAttributionText = text;
      } catch {
        /* garder le dernier copyright affiché — jamais de tuiles sans attribution */
      }
    };
    map.on("load", () => void update());
    map.on("moveend", () => void update());
    void update();
  }

  /**
   * §5.3 point 5 — DISCRIMINATEUR d'erreur de tuile satellite. **SOURCE-GAP** : le
   * champ exact qui attribue une `ErrorEvent` MapLibre à la source `sat-2d` n'est
   * PAS confirmé sur capture réelle — on NE le DEVINE PAS depuis le texte du
   * message. Best-effort STRUCTUREL (`e.sourceId === "sat-2d"`, repli `e.source.id`)
   * à CONFIRMER par un test d'intégration qui capturera le payload réel d'une
   * erreur de tuile avant de figer ce discriminateur.
   */
  function isSatelliteTileError(e: unknown): boolean {
    const ev = e as { sourceId?: unknown; source?: { id?: unknown } } | null;
    return ev?.sourceId === "sat-2d" || ev?.source?.id === "sat-2d";
  }

  /**
   * §5.3 points 3-4 — repli OSM au PREMIER échec dur attribué à `sat-2d`, SANS
   * boucle : marque la session (`satelliteFailedForSession`) puis reconstruit UNE
   * fois sur OSM (initMap, guard ⇒ `sat = null`). initMap pose alors
   * `effectiveBasemap = "fallback-map-2d"` + notifie `onBasemapFallback` ; le fond
   * effectif devient plan ⇒ plus aucune erreur sat ne se redéclenche.
   */
  function handleMapError(e: unknown): void {
    if (!satelliteActive || satelliteFailedForSession) return;
    if (!isSatelliteTileError(e)) return;
    satelliteFailedForSession = true;
    void reinitForBasemap();
  }

  /**
   * §5.3 point 4 — action EXPLICITE « Réessayer » : remet le garde de session à
   * zéro et reconstruit satellite UNE fois (aucune reconstruction automatique).
   */
  function retrySatellite(): void {
    if (!satelliteFailedForSession) return;
    satelliteFailedForSession = false;
    effectiveBasemap = null;
    void reinitForBasemap();
  }

  // ── Init MapLibre ──────────────────────────────────────────────────────────
  /**
   * @param startView Viewport (centre/zoom) de départ. Fourni lors d'une
   *   RÉ-INITIALISATION (switch de fond) pour PRÉSERVER le cadrage courant ;
   *   absent au primo-chargement → cadrage Québec par défaut. Le cadrage INITIAL
   *   mémorisé (viewportMemory) reste celui du tout premier montage (captureOnce
   *   idempotent) : `resetToInitialView` continue de restituer le cadrage Québec.
   */
  async function initMap(
    startView?: { center: [number, number]; zoom: number },
  ): Promise<void> {
    if (!mapContainer) return;
    // §5 2-modes — témoin du mode construit, posé AVANT tout `await` : le bloc
    // réactif de ré-init ne verra pas de divergence pendant cette construction.
    builtBasemapMode = basemapMode;
    // §7 R2 — rebuild-fond OFF : une carte neuve repart SANS emphase CPTAQ (aplat
    // au repos), l'emphase hover/focus étant transitoire.
    cptaqLegendEmphasized = false;
    try {
      const maplibre = (await import("maplibre-gl")).default;
      // C10 — fond « neutral-gray » : aplat gris + raster OSM DÉSATURÉ
      // (saturation -1) et éclairci, pour faire ressortir zones/lots façon
      // carte de référence. Aucune dépendance tuiles supplémentaire.
      // §5 2-modes — le fond satellite n'est construit QUE si le mode courant
      // vaut `'satellite'` ; en `'plan'` (défaut) → `sat = null` → fond OSM +
      // aplats REMPLIS (zoneOverlayPaint(false), inchangé).
      // §5.3 — ne construit le satellite que si l'intention est satellite ET
      // qu'aucun échec dur n'a été attribué à sat-2d pour cette session (garde
      // anti-boucle : après un repli, on reste OSM jusqu'à un « Réessayer »).
      const sat =
        basemapMode === "satellite" && !satelliteFailedForSession
          ? await buildSatelliteBasemap()
          : null;
      // §5 2-modes — mémorise le mode AVANT la 1re pose des couches zone : leur
      // style (aplats vs contour) en dépend. `sat` truthy = satellite actif.
      satelliteActive = !!sat;
      // §5 R3 — plan ou repli OSM : purge toute attribution provider résiduelle
      // pour que l'overlay contextuel repasse à « © OpenStreetMap ».
      if (!sat) satelliteAttributionText = "";
      // §5.3 — état EFFECTIF du fond : satellite rendu, repli, ou plan (null).
      effectiveBasemap =
        basemapMode === "satellite"
          ? sat
            ? "satellite-2d"
            : "fallback-map-2d"
          : null;
      // §5 2-modes — cas (c) : satellite demandé mais fond indisponible (mint /
      // attribution absente / échec tuile) → repli OSM SANS retomber sur plan. On
      // notifie le consommateur (notice de repli) ; les aplats restent remplis.
      if (basemapMode === "satellite" && !sat) onBasemapFallback();
      const osmBaseLayers =
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
      // Sources : OSM toujours présente (repli), + sat-2d quand le flag est ON.
      // L'attribution du sat reste vide ici : elle est DYNAMIQUE (per-viewport),
      // injectée dans le DOM au load/moveend (cf. wireSatelliteAttribution).
      const sources: Record<string, unknown> = {
        "osm-tiles": {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors",
        },
      };
      if (sat) {
        sources["sat-2d"] = {
          type: "raster",
          tiles: [sat.tiles],
          tileSize: sat.tileSize,
          attribution: "",
        };
      }
      const baseLayers = sat
        ? [{ id: "sat-2d-background", type: "raster" as const, source: "sat-2d" }]
        : osmBaseLayers;
      const m = new maplibre.Map({
        container: mapContainer,
        // §5 R3 P1 — EXCLUT le contrôle d'attribution PAR DÉFAUT de MapLibre.
        // Sans cette option, MapLibre injecte un `AttributionControl` compact
        // (`<details class="maplibregl-ctrl-attrib maplibregl-compact">` = bulle
        // « © OpenStreetMap contributors | MapLibre » + ▼) au coin bas-droit, LÀ
        // où s'ouvre le menu Layers : l'owner voyait cette bulle au lieu du menu.
        // Confirmé au RUNTIME servi (obs. navigateur 390×844, WebGL actif) : avec
        // cette option, le conteneur `maplibregl-ctrl-bottom-right` reste VIDE.
        // §5 R3 — l'attribution légale N'EST PAS blanchie : elle est RESTAURÉE par
        // l'overlay léger contextuel `.map-attribution` (owner-spec) — « © OpenStreetMap »
        // en plan/repli OSM, texte PROVIDER dynamique en satellite (alimenté par
        // `wireSatelliteAttribution`). Overlay hors-flux (position:absolute) → il ne
        // prend AUCUN espace et ne décale rien, contrairement au contrôle par défaut.
        attributionControl: false,
        style: {
          version: 8,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sources: sources as any,
          layers: baseLayers,
        },
        // §5 2-modes — ré-init : on repart du viewport COURANT (préservé) fourni
        // par `reinitForBasemap` ; au primo-chargement, cadrage Québec par défaut.
        center: startView?.center ?? INITIAL_CENTER,
        zoom: startView?.zoom ?? INITIAL_ZOOM,
        maxBounds: MAX_BOUNDS,
        // Zéro-copie : injecteur per-tuile de l'adapter (session/clé) — présent
        // seulement en mode satellite ; MapLibre passe chaque requête de tuile.
        ...(sat ? { transformRequest: sat.transformRequest } : {}),
      });
      if (sat?.attributionResolver) wireSatelliteAttribution(m, sat.attributionResolver);

      // Résilience `load` — CORPS de finalisation EXTRAIT et IDEMPOTENT. Il est
      // déclenché soit par l'event `'load'` de MapLibre (chemin nominal), soit
      // par le repli-timeout si `'load'` ne fire jamais (flap réseau). Le garde
      // synchrone en tête (`mapSetupStarted`, posé AVANT tout `await`) interdit
      // toute double-exécution si les deux déclencheurs se croisent — sans lui,
      // un second passage referait `addSource` → throw « source already exists ».
      const finalizeMapSetup = async (): Promise<void> => {
        if (mapSetupStarted) return;
        mapSetupStarted = true;
        // Finalisation engagée → annule le repli s'il est encore en vol (chemin
        // nominal : le timeout ne fera jamais un second passage).
        if (readyFallbackTimer !== undefined) {
          clearTimeout(readyFallbackTimer);
          readyFallbackTimer = undefined;
        }

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

        // Pose des couches `cities-polygons` ENVELOPPÉE : sur le CHEMIN DE REPLI,
        // le style peut ne pas être tout à fait prêt au moment du timeout →
        // addSource/addLayer peuvent throw. On `console.warn` alors, MAIS on pose
        // quand même `mapReady = true` plus bas (objectif = ne JAMAIS laisser
        // l'overlay « Chargement… » figé). Les couches zones/lots sont, elles,
        // posées par la sync réactive gatée sur `mapReady`.
        try {
          // Source GeoJSON polygones (aplats)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          m.addSource("cities-polygons", {
            type: "geojson",
            data: polygonsData as any,
          });

          // §1/§3 — mode effectif connu ici (satelliteActive posé avant ce corps).
          const surfaceMode = currentSurfaceMode();
          // Couche aplat fill choroplèthe (couleur/opacité pilotées par les props).
          // §3 — pas de `fill-outline-color` : le contour vient de `cities-outline`.
          // L'opacité passe par l'invariant (0 en satellite ⇒ aucun aplat région).
          m.addLayer({
            id: "cities-fill",
            type: "fill",
            source: "cities-polygons",
            paint: {
              "fill-color": fillColorExpression,
              // `surfaceFillOpacity` renvoie `unknown` (expression MapLibre opaque
              // OU 0) : cast vers le type de paint attendu par MapLibre.
              "fill-opacity": surfaceFillOpacity(
                surfaceMode,
                fillOpacityExpression ?? 1,
              ) as ExpressionSpecification | number,
            },
          });

          // §3 — contour région. En PLAN : slate discret (#64748b / 0.5 / 0.4). En
          // SATELLITE : le contour reprend l'EXPRESSION couleur du choroplèthe (=
          // couleur de la légende région) et devient la MEANING ; largeur
          // SAT_CITY_LINE_WIDTH (source-gap provisoire), opacité 1.
          m.addLayer({
            id: "cities-outline",
            type: "line",
            source: "cities-polygons",
            paint: {
              "line-color": surfaceMode === "satellite" ? fillColorExpression : "#64748b",
              "line-width": surfaceMode === "satellite" ? SAT_CITY_LINE_WIDTH : 0.5,
              "line-opacity": surfaceMode === "satellite" ? 1 : 0.4,
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
            if (measureActive) return; // mode mesure : les clics servent à mesurer
            const features = e.features;
            if (!features || features.length === 0) return;
            const props = features[0].properties as { citySlug?: string };
            const citySlug = readString(props?.citySlug);
            if (!citySlug) return;
            onCityClick(citySlug);
          });

          m.on("mousemove", "cities-fill", (e) => {
            if (measureActive) return; // conserve le crosshair de mesure
            const props = e.features?.[0]?.properties as
              | { citySlug?: string }
              | undefined;
            m.getCanvas().style.cursor =
              activeCitySlug === props?.citySlug ? "" : "pointer";
          });
          m.on("mouseleave", "cities-fill", () => {
            if (measureActive) return;
            m.getCanvas().style.cursor = "";
          });
        } catch (err) {
          // Repli : style pas tout à fait prêt → on n'a pas pu poser les couches
          // villes, mais on lève quand même l'overlay (dégradation gracieuse).
          console.warn("cities-polygons layer setup failed (repli load):", err);
        }

        mapReady = true;
        // C9 — capture le cadrage du primo-chargement (restauré au retour
        // Province / à la désélection via resetToInitialView).
        const center = m.getCenter();
        viewportMemory.captureOnce({
          center: [center.lng, center.lat],
          zoom: m.getZoom(),
        });
        // Miroir DOM du zoom courant (test-only) : posé au chargement puis
        // rafraîchi en fin de mouvement caméra (moveend = fin d'animation
        // flyTo/easeTo/fitBounds ET fin de geste utilisateur). Précision
        // pleine : permet l'égalité STRICTE avant/après un recentrage.
        mapZoom = String(m.getZoom());
        m.on("moveend", () => {
          mapZoom = String(m.getZoom());
        });
        applyCitiesFillPaint();
        registerGeoLayerInteractions(m);
        registerMeasureInteractions(m);
        onReady(buildApi());
      };

      // §5.3 — écoute des erreurs : repli OSM au 1er échec dur attribué à `sat-2d`
      // (discriminateur source-gap, cf. isSatelliteTileError). No-op hors satellite.
      m.on("error", (e: unknown) => handleMapError(e));
      // Chemin nominal (primaire) : l'event `'load'` de MapLibre.
      m.on("load", () => void finalizeMapSetup());
      // Repli : si `'load'` ne fire pas dans le délai imparti (flap réseau, tuile
      // stuck, requête que `map.loaded()` attend et qui est avortée), on force la
      // finalisation UNE SEULE fois — le garde d'idempotence côté finalizeMapSetup
      // absorbe toute course avec un `'load'` tardif.
      readyFallbackTimer = setTimeout(() => {
        void finalizeMapSetup();
      }, MAP_READY_FALLBACK_MS);

      mapInstance = m;
    } catch (err) {
      console.error("MapLibre init error", err);
    }
  }

  /**
   * §5 2-modes — RÉ-INITIALISATION de la carte au changement de `basemapMode`.
   * Contrainte MapLibre : `transformRequest` (injection session/clé des tuiles
   * satellite) n'est PAS modifiable au runtime → on détruit proprement la carte
   * existante puis on relance `initMap` dans le nouveau mode. Le viewport
   * COURANT (centre/zoom) est CAPTURÉ avant destruction et repassé à `initMap`
   * (cadrage préservé). Le cadrage INITIAL mémorisé (viewportMemory) reste celui
   * du primo-chargement. Idempotence : une ré-init en vol bloque les suivantes.
   */
  async function reinitForBasemap(): Promise<void> {
    if (reinitializing) return;
    reinitializing = true;
    // Capture le viewport courant AVANT destruction (préservation du cadrage).
    let startView: { center: [number, number]; zoom: number } | undefined;
    if (mapInstance) {
      const m = mapInstance as {
        getCenter: () => { lng: number; lat: number };
        getZoom: () => number;
        remove: () => void;
      };
      try {
        const c = m.getCenter();
        startView = { center: [c.lng, c.lat], zoom: m.getZoom() };
      } catch {
        /* carte pas assez avancée pour lire le viewport → cadrage par défaut */
      }
    }
    // Annule un repli-timeout en vol et remet les gardes de finalisation à zéro,
    // puis détruit la carte existante (couches/handlers retirés par MapLibre).
    if (readyFallbackTimer !== undefined) {
      clearTimeout(readyFallbackTimer);
      readyFallbackTimer = undefined;
    }
    mapReady = false;
    mapSetupStarted = false;
    if (mapInstance) {
      (mapInstance as { remove: () => void }).remove();
      mapInstance = null;
    }
    await initMap(startView);
    reinitializing = false;
  }

  // §5 2-modes — déclencheur de ré-init : la prop `basemapMode` diverge du mode
  // effectivement construit (`builtBasemapMode`) APRÈS que la carte soit prête.
  // Gaté sur `mapReady` (jamais pendant le montage initial) + garde anti-course.
  $: if (mapReady && basemapMode !== builtBasemapMode && !reinitializing) {
    void reinitForBasemap();
  }

  onDestroy(() => {
    // Résilience `load` — évite un fire du repli APRÈS démontage (fuite / accès à
    // une carte déjà retirée). Remet aussi le garde à false pour une éventuelle
    // ré-init propre.
    if (readyFallbackTimer !== undefined) {
      clearTimeout(readyFallbackTimer);
      readyFallbackTimer = undefined;
    }
    mapSetupStarted = false;
    if (mapInstance) {
      (mapInstance as { remove: () => void }).remove();
      mapInstance = null;
    }
  });

  onMount(() => {
    void initMap();
  });
</script>

<svelte:window onkeydown={handleMeasureKeydown} />

<div
  class="relative h-full w-full overflow-hidden"
  data-testid="geo-city-map-base"
  data-zone-labels-visible={showZoneLabels}
  data-lot-labels-visible={showLotLabels}
  data-camera-command-count={cameraCommandCount}
  data-last-camera-command={lastCameraCommand}
  data-map-zoom={mapZoom}
>
  <div bind:this={mapContainer} class="absolute inset-0"></div>

  <!-- ── §5 R3 — ATTRIBUTION légale : overlay LÉGER, PETIT, CENTRÉ sur la bande de
       contrôles bas, CONTEXTUEL à la layer active. Remplace le contrôle
       d'attribution par défaut de MapLibre (exclu, `attributionControl:false`) et
       RESTAURE la mention retirée en #648. `position:absolute` (cf. `.map-attribution`)
       → hors-flux : NE prend PAS d'espace, NE décale RIEN. `pointer-events:none`
       sur la pastille (le lien légal reste cliquable) → n'intercepte pas les
       gestes carte. Texte : provider dynamique quand le satellite rend, sinon
       « © OpenStreetMap » (plan / repli OSM). Valeurs fines de placement/taille =
       source-gap owner-visual (cf. CSS). -->
  <div
    class="map-attribution"
    data-testid="map-attribution"
    data-attribution-layer={attributionIsSatellite ? "satellite" : "osm"}
    aria-label="Attribution du fond de carte"
  >
    {#if attributionIsSatellite}
      {satelliteAttributionText}
    {:else}
      ©&nbsp;<a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer">OpenStreetMap</a
      >
    {/if}
  </div>

  <!-- ── Contrôles carte (BAS-droit) : §5.1 — RANGÉE [Mesure | Fond de carte].
       §5 R6 — `bottom-3` UNIFORME mobile+desktop (12 px). Le dégagement `bottom-20`
       (80 px, ancien espace de la bulle de chat) n'a plus lieu d'être — chat désactivé
       (#651) — d'où la « marge basse trop grande » responsive (owner [img 36]) : corrigée.
       §5 R5 — desktop : `md:bottom-3` (0.75 rem) ANCRE la rangée AU BORD BAS, juste
       AU-DESSUS de l'attribution centrée (`.map-attribution`, desktop `bottom:0.5rem`)
       SANS la recouvrir → BANDE COHÉRENTE (légende bas-gauche · mesure+layers
       bas-droit · attribution bas-centre). R4 laissait la rangée à `md:bottom-10`
       (2,5 rem = 40 px) alors que l'attribution était descendue à 8 px → icônes
       flottant trop haut (owner : « décalé openstreetmap mais pas les icônes »).
       Mesuré en repro chromium 1280×720 : bas rangée 708 px / bas attribution 712 px
       (4 px au-dessus, aucun chevauchement bbox). Offset = source-gap owner-visual.
       `flex-col-reverse` → les panneaux (mesure / indisponibilité) s'ouvrent vers
       le HAUT, au-dessus de la rangée de boutons. -->
  <div class="map-control-cluster absolute bottom-3 md:bottom-3 right-3 z-10 flex flex-col-reverse items-end gap-2">
    <!-- §5.1 R2 — RANGÉE UNIFORME : chaque contrôle est un enfant DIRECT, un seul
         gap (token `--st-spacing`, source-gap à ratifier owner en recette), aucune
         marge horizontale par enfant, aucun gap imbriqué. Ordre : Mesure → Fond de
         carte (Layers) → slot terminal `controls-bottom-right-end`. -->
    <div class="map-control-row" data-testid="map-control-row">
      <button
        type="button"
        class="map-ctrl-btn"
        class:map-ctrl-btn-active={measureActive}
        aria-pressed={measureActive}
        aria-label="Mesurer une distance"
        title="Mesurer une distance"
        data-testid="measure-toggle"
        onclick={toggleMeasureMode}
      >
        <Ruler size={16} aria-hidden="true" />
      </button>

      <!-- §4 R2 — contrôle de fond = UN seul trigger lucide `Layers` (rendu SSI
           `showBasemapControl`, host gating porté par le consommateur) ouvrant un
           menu DS vers le HAUT (placement="top-end"). L'ancre (span) lie le trigger
           au popover DS ; les deux boutons #646 disparaissent. -->
      {#if showBasemapControl}
        <span
          class="map-control-anchor"
          bind:this={basemapMenuAnchor}
          data-testid="basemap-control"
          data-basemap-mode={basemapMode}
        >
          <!-- §5 R3 P2 — hook e2e STABLE de l'icône Layers (testid ADDITIF :
               `basemap-control` sur l'ancre + `basemap-menu-trigger` sur le bouton DS
               sont CONSERVÉS). Sert l'assertion mobile « le cluster de contrôles carte
               reste VISIBLE + CLIQUABLE quand le chat docked plein-écran est ouvert »
               (coexistence du CLUSTER, pas seulement du pane droit traité par #579). -->
          <span class="map-layers-toggle-hit" data-testid="map-layers-toggle">
            <MenuTriggerButton
              aria-label={`Fond de carte : ${basemapMode === "plan" ? "Plan" : "Satellite"}`}
              aria-controls={BASEMAP_MENU_ID}
              expanded={basemapMenuOpen}
              size="sm"
              variant="secondary"
              data-testid="basemap-menu-trigger"
              onclick={toggleBasemapMenu}
              onkeydown={handleBasemapTriggerKeydown}
            >
              <Icon name="layers" size={16} />
            </MenuTriggerButton>
          </span>
        </span>
      {/if}

      <!-- §5.1 R2 — slot terminal VIDE (échafaudage) : le déclencheur chat sera
           câblé par un lot coordonné ultérieur. Reste le DERNIER enfant de la
           rangée → tout contrôle bas-droit-fin est garanti à droite. -->
      <slot name="controls-bottom-right-end" />
    </div>

    <!-- §4 R2 — popover DS du menu de fond (rendu SSI `showBasemapControl`) : en
         position ABSOLUE hors flux → n'affecte pas l'espacement de la rangée. Échap
         est traité par `handleMeasureKeydown` (popover `closeOnEscape={false}`). -->
    {#if showBasemapControl}
      <MenuPopover
        id={BASEMAP_MENU_ID}
        bind:open={basemapMenuOpen}
        trigger={basemapMenuAnchor}
        placement="top-end"
        label="Fond de carte"
        closeOnEscape={false}
        class="geo-basemap-popover"
      >
        <div
          class="basemap-menu"
          role="menu"
          aria-label="Fond de carte"
          bind:this={basemapMenuList}
          tabindex="-1"
          onkeydown={handleBasemapMenuKeydown}
        >
          <button
            type="button"
            class="basemap-menu__item"
            role="menuitemradio"
            aria-checked={basemapMode === "plan"}
            data-testid="basemap-option-plan"
            onclick={() => selectBasemap("plan")}
          >
            <span class="basemap-menu__check" aria-hidden="true">
              <Check size={16} strokeWidth={2} />
            </span>
            <span class="basemap-menu__label">Plan</span>
          </button>
          <button
            type="button"
            class="basemap-menu__item"
            role="menuitemradio"
            aria-checked={basemapMode === "satellite"}
            data-testid="basemap-option-satellite"
            onclick={() => selectBasemap("satellite")}
          >
            <span class="basemap-menu__check" aria-hidden="true">
              <Check size={16} strokeWidth={2} />
            </span>
            <span class="basemap-menu__label">Satellite</span>
          </button>
        </div>
      </MenuPopover>
    {/if}

    {#if measureActive || measurePoints.length > 0}
      <div class="measure-panel" data-testid="measure-panel">
        <p class="measure-overline">Mesure</p>
        {#if measurePoints.length === 0}
          <p class="measure-hint">Cliquez sur la carte pour ajouter des points.</p>
        {:else}
          <p class="measure-total" data-testid="measure-total">
            Distance : {measureTotalLabel}
          </p>
          {#if measurePoints.length >= 2}
            <p class="measure-segment">Dernier segment : {measureSegmentLabel}</p>
          {/if}
          {#if measureActive}
            <p class="measure-hint">Double-clic ou Échap pour terminer.</p>
          {/if}
          <button
            type="button"
            class="measure-clear"
            data-testid="measure-clear"
            onclick={clearMeasure}
          >
            Effacer
          </button>
        {/if}
      </div>
    {/if}

    <!-- §5.3 — repli OSM : satellite demandé mais indisponible (mint / attribution
         absente / échec de tuile). Le mode d'INTENTION reste 'satellite' ; bloc
         d'état annoncé aux lecteurs d'écran, action explicite « Réessayer ». -->
    {#if satelliteFallbackNotice}
      <div
        class="basemap-fallback"
        role="status"
        aria-live="polite"
        data-testid="basemap-fallback-notice"
      >
        <span class="basemap-fallback-text">Satellite indisponible — carte affichée.</span>
        <button
          type="button"
          class="basemap-retry"
          data-testid="basemap-retry"
          onclick={retrySatellite}
        >
          Réessayer
        </button>
      </div>
    {/if}
  </div>

  {#if segments.length > 0 || $$slots["overlay-top-left"]}
    <!-- Responsive : sur mobile le fil d'Ariane est CENTRÉ horizontalement pour ne
         pas être chevauché par les toggles de panes (haut-gauche/haut-droit) —
         « Province » doit rester ENTIER. Desktop (sm+) : ancré à gauche comme avant. -->
    <div
      class="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-4.5rem)] -translate-x-1/2 flex-col items-center gap-2 sm:left-3 sm:max-w-[calc(100%-1.5rem)] sm:translate-x-0 sm:items-start"
    >
      {#if segments.length > 0}
        <div
          class="inline-flex w-fit flex-nowrap overflow-hidden whitespace-nowrap rounded border border-slate-200 bg-white/95 text-xs shadow-sm"
        >
          {#each segments as seg (seg.label)}
            {@const segActive = seg.active ?? activeSegment === seg.label}
            <button
              type="button"
              class={`px-2 py-1 font-semibold transition-colors sm:px-2.5 ${
                segActive
                  ? "bg-slate-900 text-white"
                  : seg.disabled
                    ? "text-slate-300 cursor-not-allowed"
                    : "text-slate-600 hover:bg-slate-100 cursor-pointer"
              }`}
              aria-pressed={segActive}
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
  {#if $$slots["overlay-bottom-left"] || legend}
    <!-- Responsive : légendes REPLIÉES par défaut derrière une icône (§6 R2 =
         lucide `Map`) ; tap = déplie. `flex-col-reverse` → le bouton reste en bas,
         le panneau s'ouvre vers le HAUT. §5 R5/R6 — même ancrage `bottom-3 md:bottom-3` (uniforme 12px)
         que la rangée bas-droit → Légende (bas-gauche) et Mesure (bas-droit) restent
         SYMÉTRIQUES et forment la BANDE COHÉRENTE avec l'attribution centrée
         (desktop au bord bas, source-gap owner-visual). Cible : légendes lot/zones
         (slot overlay-bottom-left) + légende paramétrable (prop `legend`). -->
    <div class="absolute bottom-3 md:bottom-3 left-3 z-10 flex flex-col-reverse items-start gap-2">
      <button
        type="button"
        class="map-ctrl-btn"
        class:map-ctrl-btn-active={legendsOpen}
        aria-pressed={legendsOpen}
        aria-expanded={legendsOpen}
        aria-controls={LEGEND_PANEL_ID}
        aria-label="Légende"
        title="Légende"
        data-testid="legend-toggle"
        onclick={() => (legendsOpen = !legendsOpen)}
      >
        <MapIcon size={16} aria-hidden="true" />
      </button>
      {#if legendsOpen}
        <div id={LEGEND_PANEL_ID} class="flex max-w-xs flex-col gap-2" data-testid="legend-panel">
          <slot name="overlay-bottom-left" />
          {#if legend}
            <div
              class="max-w-xs rounded border border-slate-200 bg-white/95 px-3 py-2 shadow-sm"
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
        </div>
      {/if}
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

<style>
  /* §5.1 — boutons de contrôle carte (Mesure, Fond de carte, Légende) : 32×32 px,
     même bordure / rayon / focus / état actif, tokens DS (replis slate). */
  .map-ctrl-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.375rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-default, #fff);
    color: var(--st-semantic-text-secondary, #475569);
    box-shadow: 0 1px 2px rgb(15 23 42 / 0.1);
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
  }
  .map-ctrl-btn:hover {
    background: var(--st-semantic-surface-hover, #f1f5f9);
  }
  .map-ctrl-btn-active,
  .map-ctrl-btn-active:hover {
    background: var(--st-semantic-action-primary, #2563eb);
    border-color: var(--st-semantic-action-primary, #2563eb);
    color: var(--st-semantic-action-primaryText, #fff);
  }
  /* §2 point 6 — focus visible via le token DS bouton (repli 2px solid #2563eb). */
  .map-ctrl-btn:focus-visible,
  .basemap-retry:focus-visible {
    outline: var(--st-component-button-anatomy-focus-outline, 2px solid #2563eb);
    outline-offset: var(--st-component-button-anatomy-focus-outlineOffset, 2px);
  }
  /* §5.1 R2 — RANGÉE de contrôles : UN seul gap (token spacing DS, source-gap à
     ratifier). Chaque contrôle est un enfant direct ; aucune marge horizontale par
     enfant, aucun gap imbriqué → intervalles ÉGAUX quel que soit le nombre. */
  .map-control-row {
    display: inline-flex;
    align-items: center;
    gap: var(--st-spacing-2, 0.5rem);
  }
  /* Ancre du trigger de fond : wrapper neutre (aucune marge) pour `MenuPopover`. */
  .map-control-anchor {
    display: inline-flex;
  }
  /* §5 R3 P2 — enveloppe du hook e2e `map-layers-toggle` : boîte serrée sur le
     bouton DS (aucun décalage de la rangée), cliquable/visible comme le bouton. */
  .map-layers-toggle-hit {
    display: inline-flex;
  }
  /* §5 R3 P2 — COEXISTENCE MOBILE du cluster de contrôles carte avec le chat.
     En ≤639px, chat-ui force le docked et rend un overlay PLEIN-ÉCRAN (`fixed inset
     z-50`, width 100vw). Le cluster (`absolute … z-10`) passait DESSOUS → recouvert /
     non-cliquable (plus moyen de changer de fond NI de refermer le chat via son
     déclencheur). On remonte le cluster AU-DESSUS de l'overlay (z-index 60 > 50)
     UNIQUEMENT en mobile : desktop STRICTEMENT inchangé (le `z-10` inline reste la
     base ; #579 et la coexistence du pane droit ne sont pas touchés). La spécificité
     de la classe scopée Svelte (0,2,0) l'emporte sur `.z-10` (0,1,0) → aucun
     `!important`. Aligné sur le breakpoint mobile de chat-ui (max-width:639px). */
  @media (max-width: 639px) {
    .map-control-cluster {
      z-index: 60;
    }
  }
  /* §5 R3/R4 — ATTRIBUTION légale : overlay PETIT, LÉGER (pastille translucide),
     CENTRÉ horizontalement, ANCRÉ EN BAS de la carte, HORS-FLUX
     (`position:absolute`) → NE décale RIEN et ne prend aucun espace dans la rangée.
     `position:absolute` (et NON `fixed`) : l'overlay suit la CARTE (socle
     réutilisable, potentiellement non plein-viewport) et reste dans le contexte de
     la racine — l'offsetParent EST la racine `.relative h-full w-full` (mesuré en
     repro : plein-hauteur, l'ancrage `bottom` porte donc bien sur le BAS de la
     carte, pas de piège offsetParent ici). §5 R4 — sur desktop l'overlay est
     descendu au BORD BAS de la carte (owner : « trop haute » quand il flottait à
     2.5rem, au niveau de la rangée de contrôles) ; il passe SOUS cette rangée.
     Valeurs fines (offset bas exact, taille, opacité, max-width) = source-gap à
     figer owner-visual. */
  .map-attribution {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 5rem; /* = bottom-20 (mobile, au-dessus de la rangée) — source-gap owner-visual */
    z-index: 10;
    /* Bornage : ne chevauche ni les icônes bas-droite ni la bulle de chat. */
    max-width: calc(100% - 7rem); /* source-gap à figer owner-visual */
    padding: 0.0625rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.625rem; /* ~10px, petit — source-gap à figer owner-visual */
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--st-semantic-text-secondary, #475569);
    background: rgb(255 255 255 / 0.72); /* léger — source-gap à figer owner-visual */
    /* Ne capte pas les gestes carte ; le lien légal réactive pointer-events. */
    pointer-events: none;
  }
  @media (min-width: 768px) {
    .map-attribution {
      /* Desktop : au BORD BAS de la carte (owner-visual, 8 px). §5 R5 — les 2
         clusters descendent à `md:bottom-3` (12 px) → l'attribution s'aligne juste
         SOUS eux, formant la bande cohérente bas-gauche/bas-centre/bas-droite (bas
         attribution 712 px vs bas clusters 708 px, mesuré). source-gap owner-visual. */
      bottom: 0.5rem;
    }
  }
  .map-attribution a {
    color: inherit;
    text-decoration: underline;
    pointer-events: auto; /* lien légal OSM cliquable */
  }
  /* §5 R3 P1+P3 — RECALE le popover DS en `position: fixed`.
     Le `MenuPopover` DS calcule sa position en coordonnées VIEWPORT
     (`getBoundingClientRect()` + scroll) MAIS pose le panneau en
     `position: absolute` : correct UNIQUEMENT si son offsetParent est le
     `<body>` (origine 0,0). Ici le popover est un descendant du conteneur de
     contrôles `.absolute … right-3` (positionné) → l'offsetParent devient CE
     conteneur bas-droit, donc le panneau est décalé de l'offset du conteneur :
     il part HORS-VIEWPORT en bas-droite (desktop = « le menu ne s'ouvre pas » ;
     responsive = « bas-droite au lieu de haut-gauche » + reflow/clignotement,
     le panneau hors-champ étirant la zone défilable). Reproduit en navigateur :
     panneau à (top:1239,left:2334) en 1280×720, corrigé à (bottom:644,right:1268)
     avec `fixed`. `position: fixed` ⇒ coordonnées relatives au VIEWPORT (offset
     du conteneur annulé) et échappe au `overflow-hidden` de la racine ; les
     transforms DS (`translate(-100%,-100%)` de `top-end`) ancrent alors le
     panneau HAUT-GAUCHE, coin bas-droit au-dessus du trigger.
     `!important` REQUIS : la règle DS `.st-menuPopover { position: absolute }`
     est SCOPÉE par Svelte au build de l'app en `.st-menuPopover.svelte-<hash>`
     (spécificité 0,2,0) — un simple sélecteur double-classe (0,2,0) FAIT MATCH
     NUL et perd à l'ordre de cascade (vérifié en e2e : le panneau restait en
     `absolute`, hors-viewport). `!important` l'emporte sur la règle scopée tierce
     quels que soient hash/ordre. Bornage : routes carte plein-viewport, sans
     scroll de page ni ancêtre `transform` (vérifié) — condition de validité de
     `fixed`. */
  :global(.st-menuPopover.geo-basemap-popover) {
    position: fixed !important;
  }
  /* §5 R4 B — items du menu « Fond de carte » aux tokens DS MENU-ROW (recette
     design-system, groundée `Menu.svelte`). Le PANNEAU (surface / bord / ombre /
     rayon) est DÉJÀ porté par le popover DS (`.st-menuPopover`) : on ne pose ici que
     le padding interne + la mise en page des lignes (aucun double-chrome). L'ACTIF
     n'est JAMAIS un aplat de couleur (aucun token surface-selected au DS — c'est
     l'ancien « bleu plein » retiré) : il se marque par le glyph lucide `Check`
     (accent `--st-semantic-action-primary`) en tête d'une colonne RÉSERVÉE
     (Plan/Satellite alignés) + le label en `--st-semantic-text-primary` weight 500. */
  .basemap-menu {
    display: flex;
    flex-direction: column;
    padding: var(--st-spacing-1, 0.25rem);
  }
  .basemap-menu__item {
    display: flex;
    align-items: center;
    width: 100%;
    gap: var(--st-spacing-2, 0.5rem);
    padding: var(--st-spacing-2, 0.5rem) var(--st-spacing-3, 0.75rem);
    border: none;
    border-radius: var(--st-radius-sm, 0.25rem);
    background: transparent;
    color: var(--st-component-menu-text, var(--st-semantic-text-primary, #0f172a));
    font: inherit;
    font-size: var(--st-component-menu-fontSize, 0.875rem);
    text-align: left;
    cursor: pointer;
  }
  .basemap-menu__item:hover,
  .basemap-menu__item:focus-visible {
    background: var(
      --st-component-control-hoverBackground,
      var(--st-semantic-surface-subtle, #f8fafc)
    );
    outline: none;
  }
  /* Colonne « coche » RÉSERVÉE : le glyph (16px) est toujours dans le flux mais
     masqué tant que la ligne n'est pas active → Plan et Satellite restent alignés. */
  .basemap-menu__check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    visibility: hidden;
    color: var(--st-semantic-action-primary, #2563eb);
  }
  .basemap-menu__item[aria-checked="true"] .basemap-menu__check {
    visibility: visible;
  }
  .basemap-menu__item[aria-checked="true"] .basemap-menu__label {
    color: var(--st-semantic-text-primary, #0f172a);
    font-weight: 500;
  }
  /* §5.3 — notice de repli OSM (role="status" aria-live="polite"). */
  .basemap-fallback {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 16rem;
    border-radius: 0.375rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-default, rgb(255 255 255 / 0.95));
    box-shadow: 0 1px 2px rgb(15 23 42 / 0.1);
    padding: 0.375rem 0.5rem;
  }
  .basemap-fallback-text {
    font-size: var(--st-component-caption-fontSize, 0.6875rem);
    color: var(--st-semantic-text-secondary, #475569);
  }
  .basemap-retry {
    padding: 0.125rem 0.5rem;
    border-radius: 0.25rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-subtle, #f8fafc);
    color: var(--st-semantic-text-secondary, #475569);
    font-size: var(--st-component-caption-fontSize, 0.6875rem);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .basemap-retry:hover {
    background: var(--st-semantic-surface-hover, #f1f5f9);
  }

  .measure-panel {
    min-width: 10.5rem;
    max-width: 14rem;
    border-radius: 0.375rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-default, rgb(255 255 255 / 0.95));
    box-shadow: 0 1px 2px rgb(15 23 42 / 0.1);
    padding: 0.5rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .measure-overline {
    font-size: var(--st-component-label-fontSize, 0.6875rem);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--st-semantic-text-muted, #94a3b8);
  }
  .measure-total {
    font-size: var(--st-component-body-sm-fontSize, 0.8125rem);
    font-weight: 600;
    color: var(--st-semantic-text-primary, #0f172a);
  }
  .measure-segment {
    font-size: var(--st-component-caption-fontSize, 0.6875rem);
    color: var(--st-semantic-text-secondary, #475569);
  }
  .measure-hint {
    font-size: var(--st-component-caption-fontSize, 0.6875rem);
    color: var(--st-semantic-text-muted, #94a3b8);
  }
  .measure-clear {
    align-self: flex-start;
    margin-top: 0.25rem;
    padding: 0.125rem 0.5rem;
    border-radius: 0.25rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-subtle, #f8fafc);
    color: var(--st-semantic-text-secondary, #475569);
    font-size: var(--st-component-caption-fontSize, 0.6875rem);
    font-weight: 600;
    cursor: pointer;
  }
  .measure-clear:hover {
    background: var(--st-semantic-surface-hover, #f1f5f9);
  }
</style>
