<script lang="ts">
  /**
   * SignauxMapView — Vue Signaux Phase 1 — layout 3 colonnes.
   *
   * Layout ws-shell (graphify) :
   *   RAIL (menu gauche w-80) | CANVAS (carte MapLibre) | SEL (panneau droit w-80)
   *
   * - Rail gauche : SignauxRail (recherche + facets signaux + liste plate de
   *   villes) ; les signaux de la ville active vivent à DROITE (bucket
   *   « Signaux »)
   * - Canvas : MapLibre GL aplats choroplèthe + flyTo au clic ville
   * - Sel droit : SignauxSelPanel (détail ville + nœuds par type) ; les
   *   filtres DONNÉES vivent en EN-TÊTE des accordéons Zones (par type de
   *   zone) et Lots (catégorie/usages/superficie) — l'état des deux filtres
   *   est porté ICI car il pilote la peinture carte (zéro refetch)
   * - Légende épinglée en bas du rail (slot controls-footer ViewLayout)
   *
   * Garde-fous Phase 1 :
   *  - NE swap PAS MapLibre
   *  - NE touche PAS API/OIDC/PG/geo
   *  - NE déclenche PAS l'activation zonage-au-zoom (Phase 2)
   */
  import { onMount } from "svelte";
  import { Checkbox } from "@sentropic/design-system-svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import SignauxRail from "$lib/components/maps/SignauxRail.svelte";
  import SignauxSelPanel from "$lib/components/maps/SignauxSelPanel.svelte";
  import DocumentOverlay from "$lib/components/maps/DocumentOverlay.svelte";
  import SignalPdfOverlay from "$lib/components/maps/SignalPdfOverlay.svelte";
  import GeoCityMapBase, {
    type GeoCityMapApi,
    type GeoSegment,
  } from "$lib/components/maps/GeoCityMapBase.svelte";
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
    type LegacyZmpProjection,
    type SignalDocRef,
    type SignalEvidence,
  } from "$lib/signals/graph-signal-detail-client.js";
  import {
    buildOverlaySignals,
    buildNavSignals,
    buildHoverCard,
    type OverlaySignal,
    type OverlayNavSignal,
    type HoverCardData,
  } from "$lib/signals/pdf-overlay-signals.js";
  import { signalColorAt } from "$lib/signals/pdf-signal-colors.js";
  import { extractSignalEvidence } from "$lib/signals/graph-signal-detail-client.js";
  import {
    type GeoZoneFeature,
    type GeoZonesResponse,
    type GeoZoneFeatureCollection,
  } from "$lib/maps/geo-zones-client.js";
  import {
    emptyUnconfiguredZones,
    loadSignauxZones,
  } from "$lib/maps/signaux-zones-loader.js";
  import {
    fetchAllLots,
    type LotFeatureCollection,
    type LotsResponse,
  } from "$lib/maps/lots-client.js";
  import { RequestGuard } from "$lib/net/request-guard.js";
  import {
    isAbortError,
    DEFAULT_REQUEST_TIMEOUT_MS,
  } from "$lib/net/fetch-with-timeout.js";
  import {
    createSelectionBucketState,
    makeKey,
    parseKey,
    setFocus,
    toggleExclusiveSelection,
    toggleSelection,
    type SelectionBucketState,
    type SelectionKey,
  } from "$lib/maps/selection-bucket.js";
  import {
    resolveSelectionCameraTarget,
    type PreviousCameraLot,
  } from "$lib/maps/selection-camera.js";
  import { zoneCodeAtPoint } from "$lib/maps/zone-membership.js";
  import {
    buildGeoLevelNavigation,
    type GeoLevel,
  } from "$lib/maps/geo-level-navigation.js";
  import {
    buildDrillSegments,
    computeDrillLevel,
    zonesConfigured,
  } from "$lib/maps/geo-drill.js";
  import {
    navigateToGeoRoute,
    type GeoRoute,
  } from "$lib/router/router.js";
  import {
    decorateLotsWithSignalProjection,
    decorateSelectedFlag,
    extractSignalLotRefs,
    extractSignalZoneRefs,
    fallbackZoneCode,
    findLotBounds,
    opacityForSelectionKey,
    withCityFallbackZone,
    filterDimsProjection,
    zoneRefComparableKey,
    CITY_FALLBACK_ZONE_PREFIX,
    FILTER_DIMMED_OPACITY,
  } from "$lib/maps/signaux-map-geo.js";
  import {
    withHoverNeutralTint,
    withHoverOpacityBoost,
  } from "$lib/maps/hover-paint.js";
  import {
    A_SUBSET_KEY,
    clearVivierCityTransientState,
    countForVivierCity,
    initialVivierSubsetKey,
    modeFromSubsetKey,
    projectNodesForVivierKey,
    reconcileVivierRouteSubset,
    reconcileVivierSelection,
    retainProjectedSignalId,
    subsetKeyForMode,
    vivierRouteKey,
  } from "$lib/signals/vivier-view-mode.js";
  import {
    applyVivierBExclusions,
    DEFAULT_VIVIER_B_EXCLUSIONS,
    type VivierBExclusions,
  } from "$lib/signals/vivier-b-display-filter.js";
  import {
    defaultDateRange,
    filterNodesByEtapeDate,
    type SignalDateRange,
  } from "$lib/signals/signal-date-filter.js";
  import { rankVivierBNodes } from "$lib/signals/vivier-b-ranking.js";
  import {
    lotLineColorExpression,
    signauxLotFillColorExpression,
    resolveToken,
    resolveMapColor,
    LOT_NEUTRAL_TOKEN,
    LOT_NEUTRAL_FALLBACK,
    LOT_TOD_TOKEN,
    LOT_TOD_FALLBACK,
    LOT_4PLUS_TOD_TOKEN,
    LOT_4PLUS_TOD_FALLBACK,
    PRIORITY_LINE_TOKEN,
    PRIORITY_LINE_FALLBACK,
    SIGNAL_DIRECT_TOKEN,
    SIGNAL_DIRECT_FALLBACK,
  } from "$lib/maps/score-color-scale.js";
  import {
    isDefaultEvalFilter,
    isQuatrePlus,
    lotHierarchyOpacity,
    lotMatchesEvalFilter,
    LOT_HIERARCHY_OPACITY,
    type EvalLotFilter,
  } from "$lib/maps/eval-lot-filters.js";
  import {
    decorateZonesWithKindColor,
    zoneKindLegend,
    ZONE_KIND_NEUTRAL,
  } from "$lib/maps/zone-kind-style.js";
  import {
    zoneKindFilterOpacity,
    DEFAULT_ZONE_KIND_FILTER,
    ZONE_KIND_FILTER_DIMMED_OPACITY,
    ZONE_KIND_FILTER_MATCH_OPACITY,
    type ZoneKindFilter,
  } from "$lib/maps/zone-kind-filter.js";
  import {
    zoneMillesimeFilterOpacity,
    ZONE_MILLESIME_FILTER_DIMMED_OPACITY,
    DEFAULT_ZONE_MILLESIME_FILTER,
    type ZoneMillesimeFilter,
  } from "$lib/maps/zone-millesime-filter.js";
  import ZoneMillesimeSelect from "$lib/components/maps/ZoneMillesimeSelect.svelte";
  import { lotZoneCode } from "$lib/components/maps/lot-fiche-utils.js";
  import {
    geometryBounds,
    boundsCenter,
    QUEBEC_PROVINCE_BOUNDS,
  } from "$lib/maps/geometry-bounds.js";
  import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

  const EMPTY_ZONES: GeoZoneFeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  const EMPTY_LOTS: LotFeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };

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
  let detailLegacyProjection: LegacyZmpProjection | null = null;
  // ── Waiters PAR COUCHE (zones / lots indépendants) ────────────────────────
  // Chaque couche porte SON propre état chargement + erreur : l'échec ou la
  // lenteur de l'une n'affecte JAMAIS l'affichage de l'autre.
  let zonesLoading = false;
  let zonesError: string | null = null;
  let lotsLoading = false;
  let lotsError: string | null = null;
  let geoNotices: string[] = [];
  let zonesResponse: GeoZonesResponse | null = null;
  let lotsResponse: LotsResponse | null = null;

  // ── Gardes anti-course (dernière requête gagne) ───────────────────────────
  // Deux ressources distinctes, superséd­ées ATOMIQUEMENT au changement de
  // ville : le détail (panneau droit) et les couches géo (zones+lots). Une
  // réponse en retard d'une ville précédente est ignorée (jeton) ET avortée
  // (AbortController) — elle ne peint jamais la mauvaise ville.
  const detailGuard = new RequestGuard();
  const geoGuard = new RequestGuard();
  let activeDocument: SignalDocRef | null = null;
  // m7 / m8 — source documentaire générique ouverte dans le viewer partagé
  // (règlement PDF, grille de zonage, source de zone). Distincte de
  // `activeEvidence` (preuve d'un signal, avec navigation multi-signaux).
  let activeSource:
    | {
        title: string;
        sourceUrl: string | null;
        rawRef: string | null;
        page: number | null;
      }
    | null = null;
  let activeEvidence:
    | {
        title: string;
        evidence: SignalEvidence;
        signals: OverlaySignal[];
        nodeId: string;
      }
    | null = null;
  // #91 — toggle « masquer hors-filtre » du viewer (défaut : visibles).
  let hideOutOfFilter = false;
  // #86 — cross-highlight : id du signal survolé (canal bidirectionnel
  // viewer ↔ fiche droite). Source unique de vérité du hover croisé.
  let hoveredEvidenceSignalId: string | null = null;
  function setHoveredEvidenceSignal(id: string | null): void {
    hoveredEvidenceSignalId = id;
  }
  let displayedLots: LotFeatureCollection = EMPTY_LOTS;

  // Contrat caméra « lot suivant » — dernier LOT ciblé par une commande caméra
  // (frame ou recentrage) + sa zone au moment de la commande. Alimente la
  // décision selection-camera : reclic même lot = aucune commande ; autre lot
  // même zone = recentrage zoom conservé ; autre zone = cadrage existant.
  // Réinitialisé au changement de ville et au retour Province.
  let cameraLot: PreviousCameraLot | null = null;

  // ── m5 / UAT — Libellés sur la carte (n° de zone / n° de lot) ─────────────
  // DEUX cases INDÉPENDANTES : n° de zone et n° de lot s'affichent/masquent
  // séparément → on peut avoir zone SEUL, lot SEUL, les DEUX, ou AUCUN.
  // Défaut : n° de zone AFFICHÉ (coché), n° de lot MASQUÉ. PERSISTANT en
  // session (localStorage) : le choix tient au fil des villes et des reloads.
  const LOT_LABELS_LS_KEY = "signaux-show-lot-labels";
  const ZONE_LABELS_LS_KEY = "signaux-show-zone-labels";
  let showLotLabels = false;
  let showZoneLabels = true;

  function readLabelPref(key: string, fallback: boolean): boolean {
    if (typeof localStorage === "undefined") return fallback;
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "1";
  }
  function persistLabelPref(key: string, value: boolean): void {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value ? "1" : "0");
    }
  }
  function setShowLotLabels(value: boolean): void {
    showLotLabels = value;
    persistLabelPref(LOT_LABELS_LS_KEY, value);
  }
  function setShowZoneLabels(value: boolean): void {
    showZoneLabels = value;
    persistLabelPref(ZONE_LABELS_LS_KEY, value);
  }

  // ── Cache multi-villes : nœuds par ville ──────────────────────────────────
  /** Cache des nœuds détail par ville slug (pour recoloration aplats filtrée). */
  const detailCache = new Map<string, GraphSignalNode[]>();
  let appliedGeoRouteKey: string | null = null;
  let pendingRouteZoneKey: string | null = null;

  // ── Projection globale A / B ─────────────────────────────────────────────
  const FILTER_DEFAULT: string = A_SUBSET_KEY;
  const FILTER_LS_KEY = "signaux-filter-subset";
  let activeSubsetKey: string = FILTER_DEFAULT;

  /**
   * Exclusions d'AFFICHAGE de la vue B. Elles ne touchent ni la classification
   * serveur ni les compteurs : elles ne font que masquer.
   */
  let vivierBExclusions: VivierBExclusions = { ...DEFAULT_VIVIER_B_EXCLUSIONS };
  let dateRange: SignalDateRange = defaultDateRange();

  /**
   * Visible nodes retain the server-authoritative A/B projection and apply the
   * temporal lens only to its display result.
   *
   * La PROJECTION reste calculée sur la population brute AUTHORITATIVE : en A par
   * défaut (`z|m|p`), `projectLegacyVivierA` VALIDE le jeu contre les IDs exacts
   * du serveur avant toute exclusion client.
   */
  function visibleNodesFor(
    nodes: GraphSignalNode[],
    authority: unknown,
    subsetKey: string,
    exclusions: VivierBExclusions,
    range: SignalDateRange,
  ): GraphSignalNode[] {
    const mode = modeFromSubsetKey(subsetKey);
    const projected = projectNodesForVivierKey(nodes, authority, subsetKey).nodes;
    const dated = filterNodesByEtapeDate(projected, range);
    return mode === "b" ? applyVivierBExclusions(dated, exclusions) : dated;
  }

  function applyActiveSubsetKey(subsetKey: string): void {
    // Clé LIVE composée conservée TELLE QUELLE (axes de A / précoce de B) : elle
    // pilote carte + détail. La normalisation en clé de mode n'a lieu qu'à la
    // PERSISTANCE (handleFilterChange / écritures d'URL), jamais sur l'état vif.
    activeSubsetKey = subsetKey;
    reconcileToVisibleNodes();
  }

  /** Un signal masqué ne doit rester ni sélectionné, ni survolé, ni ouvert. */
  function reconcileToVisibleNodes(): void {
    const allowedIds = new Set(
      visibleNodesFor(
        detailNodes,
        detailLegacyProjection,
        activeSubsetKey,
        vivierBExclusions,
        dateRange,
      ).map((node) => node.id),
    );
    selectionState = reconcileVivierSelection(selectionState, allowedIds);
    const evidenceId = retainProjectedSignalId(activeEvidence?.nodeId ?? null, allowedIds);
    if (activeEvidence && evidenceId === null) activeEvidence = null;
    hoveredEvidenceSignalId = retainProjectedSignalId(hoveredEvidenceSignalId, allowedIds);
  }

  function handleExclusionsChange(next: VivierBExclusions): void {
    vivierBExclusions = next;
    reconcileToVisibleNodes();
  }

  function handleDateRangeChange(next: SignalDateRange): void {
    dateRange = next;
    reconcileToVisibleNodes();
    updateGeoLayers();
  }

  /**
   * Restaure la clé filtre depuis l'URL au chargement.
   * Priorité : URL > localStorage > A. Seule la clé B explicite sélectionne B.
   * Le filtre est stocké dans geoRoute.state.filters["subset"] en tant que tableau de valeurs.
   * Tout état vide, ancien ou hybride (dont l'ancien `z|p`) revient à A.
   */
  function subsetKeyFromRoute(route: GeoRoute | null): string {
    const stored = typeof localStorage === "undefined"
      ? null
      : localStorage.getItem(FILTER_LS_KEY);
    return initialVivierSubsetKey(route, stored);
  }

  function handleFilterChange(
    subsetKey: string,
  ): void {
    // La clé LIVE (composée) pilote carte + détail…
    applyActiveSubsetKey(subsetKey);
    // …mais SEULE la clé de MODE est persistée (défaut du tab). La sous-sélection
    // vive (axes A décochés, précoce B) reste une lentille de session : au reload
    // le tab repart de son défaut (défaut A = z|m|p ; `z|p` jamais collant).
    const persistKey = subsetKeyForMode(modeFromSubsetKey(subsetKey));
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FILTER_LS_KEY, persistKey);
    }
    // Persiste le filtre dans l'URL (remplace sans ajouter à l'historique)
    const currentRoute = geoRoute;
    if (currentRoute) {
      const subsetValues = persistKey.split("|");
      const newFilters: Record<string, string[]> = { subset: subsetValues };
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
    updateGeoLayers();
  }

  // ── Filtres DONNÉES par accordéon (drawer DROIT — en-têtes des buckets
  // Zones et Lots de SignauxSelPanel) ────────────────────────────────────
  // Distincts du filtre de SIGNAUX z|p (rail gauche) : ceux-ci filtrent les
  // données cadastrales/zonage de la ville active. L'état vit ICI (pas dans le
  // panneau) car il pilote la peinture carte. ZÉRO refetch : chaque changement
  // ne fait que recalculer les expressions de peinture. Fermer un accordéon ne
  // réinitialise PAS son filtre (le compteur N/M du bandeau reste visible).
  /** Filtre LOTS (catégorie exclusive × usages additifs × superficie min). */
  let lotDataFilter: EvalLotFilter = {
    category: "all",
    usages: new Set(),
    superficieMin: 0,
  };

  function handleLotDataFilterChange(next: EvalLotFilter): void {
    lotDataFilter = next;
  }

  /** Filtre par TYPE de zone (chips additives — catégories de la légende). */
  let zoneKindFilter: ZoneKindFilter = DEFAULT_ZONE_KIND_FILTER;

  function handleZoneKindFilterChange(next: ZoneKindFilter): void {
    zoneKindFilter = next;
  }

  /**
   * Filtre par MILLÉSIME de zonage (exclusif — un seul millésime à la fois).
   * Défaut « tous » (`null`). Réinitialisé au changement de ville (selectCity)
   * pour ne jamais estomper une nouvelle ville avec un millésime périmé.
   */
  let zoneMillesimeFilter: ZoneMillesimeFilter = DEFAULT_ZONE_MILLESIME_FILTER;

  function handleZoneMillesimeFilterChange(next: ZoneMillesimeFilter): void {
    zoneMillesimeFilter = next;
  }

  // Recalque la peinture quand un filtre données change (assignations ci-dessus).
  // `zoneMillesimeFilter !== undefined` référence la variable (toujours vrai :
  // string|null jamais undefined) pour que Svelte suive la dépendance SANS
  // exiger une valeur truthy (null = « tous » est un état actif légitime).
  $: if (mapReady && lotDataFilter && zoneKindFilter && zoneMillesimeFilter !== undefined) {
    updateGeoLayers();
  }

  /**
   * Codes (forme comparable) des zones contenant au moins un lot 4+ — zones
   * SURLIGNÉES quand le filtre données 4+/Priorité est actif (parité #315).
   * Fonction (pas un réactif) : lue au moment du repaint, jamais périmée.
   */
  function computeFourPlusZoneKeys(): Set<string> {
    if (
      lotDataFilter.category !== "quatrePlus" &&
      lotDataFilter.category !== "priorite"
    ) {
      return new Set();
    }
    const keys = new Set<string>();
    for (const lot of displayedLots.features) {
      if (!isQuatrePlus(lot.properties)) continue;
      const code = lotZoneCode(lot.properties);
      if (code) keys.add(zoneRefComparableKey(code));
    }
    return keys;
  }

  /**
   * Clés de sélection GÉO (zone/lot/signal) — la sélection de la VILLE
   * elle-même (posée à chaque selectCity) ne doit PAS estomper les couches :
   * l'ouverture d'une ville montre la colorisation par défaut pleine.
   */
  function geoSelectedKeys(state: SelectionBucketState): Set<SelectionKey> {
    const keys = new Set<SelectionKey>();
    for (const key of state.selectedKeys) {
      if (!key.startsWith("municipality:")) keys.add(key);
    }
    return keys;
  }

  /**
   * Lots affichés, décorés de la projection signal. Les TROIS sources sont des
   * PARAMÈTRES (pas des lectures de closure) pour que le bloc réactif `$:`
   * re-calcule aussi à l'arrivée de lotsResponse/zonesResponse — pas seulement
   * au changement des nœuds (sinon le panneau filtres compte 0/0 tant qu'aucun
   * signal ne bouge).
   */
  function buildDisplayedLots(
    lotsRes: LotsResponse | null,
    zonesRes: GeoZonesResponse | null,
    nodes: GraphSignalNode[],
  ): LotFeatureCollection {
    return lotsRes
      ? decorateLotsWithSignalProjection(
          lotsRes.featureCollection,
          zonesRes?.featureCollection.features ?? [],
          nodes,
        )
      : EMPTY_LOTS;
  }

  // ── Données réactives ──────────────────────────────────────────────────────
  $: allEntries = buildCityMapEntries(graphItems);
  $: activeViewMode = modeFromSubsetKey(activeSubsetKey);
  /**
   * Clé de MODE dérivée (z|m|p / vivier-v2) : c'est ELLE qu'on persiste et qu'on
   * renvoie au rail, jamais la clé LIVE composée — sinon `z|p` redeviendrait
   * collant. Le rail en re-dérive ses axes (idempotent).
   */
  $: persistedSubsetKey = subsetKeyForMode(activeViewMode);
  /**
   * Détail projeté selon la clé LIVE composée : A applique les axes cochés,
   * B restreint aux précoces si l'axe est coché. `z|m|p` reste la projection
   * EXACTE validée par l'autorité serveur (aucune régression du vivier).
   */
  $: detailProjection = projectNodesForVivierKey(
    detailNodes,
    detailLegacyProjection,
    activeSubsetKey,
  );
  /**
   * La liste affichée = la projection de la clé LIVE, puis la lentille
   * temporelle, puis (en B seulement) les exclusions d'affichage et le tri
   * déterministe `compareVivier`. Le retrait
   * du garde-fou `m` de A est compensé par la sous-sélection d'axes, sans jamais
   * reclasser un signal.
   *
   * En B, on TRIE ce qui reste après exclusion (on n'ordonne que le visible) :
   * le mur de signaux devient une liste priorisée (éligibilité → effet
   * densifiant → précocité d'étape → instrument → preuve → fraîcheur → id). En A,
   * l'ordre reste EXACTEMENT celui de la projection serveur (aucun changement).
   */
  $: dateScopedProjectionNodes = filterNodesByEtapeDate(detailProjection.nodes, dateRange);
  $: filteredDetailNodes = activeViewMode === "b"
    ? rankVivierBNodes(
        applyVivierBExclusions(dateScopedProjectionNodes, vivierBExclusions),
      )
    : dateScopedProjectionNodes;
  $: effectiveDetailError = detailError ?? (
    !detailLoading && detailNodes.length > 0 && !detailProjection.available
      ? "Projection du vivier indisponible (contrat serveur incompatible)."
      : null
  );

  /**
   * m1.7 — Compte LIVE de la ville sélectionnée, transmis au rail pour que son
   * badge cesse d'ignorer les filtres client (axes A/B, exclusions B) :
   * `filteredDetailNodes` EST déjà ce pipeline complet, c'est
   * exactement ce que voit l'utilisateur dans le panneau droit.
   *
   * `null` (repli sur le compte bulk du rail) tant que :
   *  - aucune ville n'est sélectionnée ;
   *  - le détail est en cours de chargement (`detailLoading` — pas de flash à
   *    0/n·d le temps du fetch, cf. #378) ;
   *  - la projection serveur est indisponible (`!detailProjection.available`) —
   *    on ne substitue jamais un compte qu'on ne peut pas garantir exact.
   */
  $: selectedCityLiveCount =
    selectedCity && !detailLoading && detailProjection.available
      ? filteredDetailNodes.length
      : null;
  $: displayedLots = buildDisplayedLots(lotsResponse, zonesResponse, filteredDetailNodes);

  /**
   * Les deux vues (A comme B) restreignent le jeu brut de signaux.
   * (Ne pas tester `includes("z")` : la clé de B n'est pas un jeu de flags.)
   */
  $: filterActive = activeViewMode === "a" || activeViewMode === "b";
  /** True si au moins un lot affiché porte une projection de signal (#4). */
  $: hasProjectedLot = displayedLots.features.some(
    (lot) => (lot.properties.signalProjection ?? "none") !== "none",
  );

  // ── #91 — Navigation par signal du viewer de preuve ────────────────────────
  // Source de vérité de la nav : la liste FILTRÉE (ordre du pane droit). Le
  // viewer la reçoit + l'index courant et NE refiltre pas. navSignals est
  // multi-doc ; le viewer affiche PDF i/N quand ≥ 2 docs distincts.
  $: navSignals = buildNavSignals(filteredDetailNodes);
  /** Rang du signal ouvert dans navSignals (-1 si overlay fermé / hors-liste). */
  $: navIndex = activeEvidence
    ? navSignals.findIndex((n) => n.id === activeEvidence!.nodeId)
    : -1;

  /**
   * Niveau géo ACTIF du drill (Province / Ville / Zone). Les dépendances
   * (`selectionState`, `selectedCity`) sont passées EN PARAMÈTRES — même
   * contrat que `visual()` dans SignauxSelPanel : en mode legacy Svelte 5,
   * une dépendance lue seulement DANS le corps d'une fonction laisse le
   * réactif périmé (le segment restait « Province » après un deep-link ville,
   * rendant le clic « Province » — et donc le dézoom C9 — inopérant).
   */
  function computeGeoLevel(
    state: SelectionBucketState,
    city: CityMapEntry | null,
  ): string {
    // Projection de l'état bucket vers la logique de drill PARTAGÉE (geo-drill,
    // mutualisée avec la vue Sources/Couverture).
    const zoneSelected =
      state.focusedKey?.startsWith("zone:") ||
      [...state.selectedKeys].some((key) => key.startsWith("zone:"));
    return computeDrillLevel({
      hasSelectedCity: city !== null,
      hasZoneSelection: !!zoneSelected,
    });
  }

  // PAS de `$: activeGeoLevel = …` : ce statement est déclaré AVANT le
  // `$: applyGeoRoute(...)` qui assigne selectedCity pendant le flush — en
  // legacy Svelte 5 il resterait périmé (« Province » après un deep-link
  // ville). Le niveau actif est donc évalué à la demande : dans le TEMPLATE
  // (expression re-rendue à chaque invalidation) et au clic de segment.

  $: if (geoRoute && allEntries.length > 0) {
    void applyGeoRoute(geoRoute);
  }

  $: if (pendingRouteZoneKey && selectedCity && zonesResponse) {
    applyPendingRouteZone();
  }

  // ── #11 — Highlight géo : cibles du signal focusé ─────────────────────────
  /** Codes de zones référencées par le signal focusé (vide si pas de signal focusé). */
  $: focusedSignalZoneRefs = (() => {
    const key = selectionState.focusedKey;
    if (!key) return new Set<string>();
    const parsed = parseKey(key);
    if (!parsed || parsed.kind !== "signal") return new Set<string>();
    const node = detailNodes.find((n) => n.id === parsed.id);
    if (!node) return new Set<string>();
    return new Set(extractSignalZoneRefs(node));
  })();

  /** Numéros de lots référencés par le signal focusé (vide si pas de signal focusé). */
  $: focusedSignalLotRefs = (() => {
    const key = selectionState.focusedKey;
    if (!key) return new Set<string>();
    const parsed = parseKey(key);
    if (!parsed || parsed.kind !== "signal") return new Set<string>();
    const node = detailNodes.find((n) => n.id === parsed.id);
    if (!node) return new Set<string>();
    return new Set(extractSignalLotRefs(node));
  })();

  $: if (mapReady && (focusedSignalZoneRefs || focusedSignalLotRefs)) {
    updateGeoLayers();
  }

  // ── Carte (socle GeoCityMapBase) ───────────────────────────────────────────
  /** API impérative du socle, captée une fois la carte prête (onReady). */
  let mapApi: GeoCityMapApi | null = null;
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
   * selon le compte actif exact (subsetCounts[subsetKey]). Les dépendances
   * sont passées en PARAMÈTRES (pas lues en variable libre) pour que Svelte
   * suive correctement le recalcul réactif de la prop choroplèthe.
   *
   * La couleur ne dépend QUE des comptes bulk : sélectionner une ville ne
   * repeint pas son polygone (la sélection est portée par l'opacité).
   */
  function buildFillColorExpression(
    entries: CityMapEntry[],
    subsetKey: string,
  ): ExpressionSpecification {
    const expr: unknown[] = ["match", ["get", "citySlug"]];
    for (const e of entries) {
      const count = countForVivierCity(e, subsetKey);
      expr.push(e.municipality.slug, signalCountColor(count));
    }
    expr.push("#e2e8f0"); // fallback pour villes sans data
    return expr as ExpressionSpecification;
  }

  function buildFillOpacityExpression(
    entries: CityMapEntry[],
    activeCitySlug: string | null,
    selState: SelectionBucketState,
  ): ExpressionSpecification {
    const expr: unknown[] = ["match", ["get", "citySlug"]];
    for (const entry of entries) {
      const key = makeKey("municipality", entry.municipality.slug);
      const contextualOpacity = activeCitySlug
        ? (entry.municipality.slug === activeCitySlug ? 0.06 : 0.1)
        : 0.75;
      expr.push(
        entry.municipality.slug,
        activeCitySlug
          ? contextualOpacity
          : opacityForSelectionKey(selState, key, 0.75),
      );
    }
    expr.push(activeCitySlug ? 0.08 : 0.75);
    return expr as ExpressionSpecification;
  }

  /**
   * Expressions choroplèthe passées EN PROPS au socle. Les dépendances sont
   * référencées ici afin que Svelte recalcule la peinture exactement quand
   * l'ancien `updateFillColors()` impératif était déclenché : la COULEUR ne
   * dépend que de (allEntries, activeSubsetKey), l'OPACITÉ porte seule la
   * sélection (selectedCity, selectionState).
   */
  $: fillColorExpression = buildFillColorExpression(allEntries, activeSubsetKey);
  $: fillOpacityExpression = buildFillOpacityExpression(
    allEntries,
    selectedCity?.municipality.slug ?? null,
    selectionState,
  );

  /**
   * `fill-color` des aplats zone : teinte par KIND portée par la propriété
   * décorée `kindColor` (cf. decorateZonesWithKindColor — résidentiel jaune,
   * commercial rouge, agricole vert…), repli neutre. L'expression est STATIQUE
   * (le socle ne pose `fill-color` qu'à la création de la couche) : c'est la
   * DONNÉE décorée qui change, pas l'expression.
   */
  function zoneKindFillColorExpression(el: Element | null): ExpressionSpecification {
    return [
      "coalesce",
      ["get", "kindColor"],
      resolveMapColor(LOT_NEUTRAL_TOKEN, LOT_NEUTRAL_FALLBACK, el),
    ] as ExpressionSpecification;
  }

  /**
   * Segments du drill Province / Ville / Zone (Zone grisée si non configurée).
   * Fonction PURE évaluée dans le template (mêmes raisons que computeGeoLevel :
   * un `$:` déclaré avant applyGeoRoute resterait périmé après un deep-link).
   */
  function buildGeoSegments(
    city: CityMapEntry | null,
    zonesRes: GeoZonesResponse | null,
  ): GeoSegment[] {
    // Segments du drill PARTAGÉS (geo-drill, mutualisés avec Sources/Couverture).
    return buildDrillSegments({
      hasSelectedCity: city !== null,
      zonesConfigured: zonesConfigured(zonesRes),
    });
  }

  // Met à jour les couches geo quand la carte ou les nœuds filtrés changent.
  $: if (mapReady && filteredDetailNodes !== undefined) {
    updateGeoLayers();
  }

  // ── Légende (couleurs résolues des tokens DS ; fallbacks sent-tech hors DOM) ─
  const lotLegendEntries = [
    { color: resolveToken(SIGNAL_DIRECT_TOKEN, SIGNAL_DIRECT_FALLBACK, null), label: "Cité par un signal" },
    { color: resolveToken(PRIORITY_LINE_TOKEN, PRIORITY_LINE_FALLBACK, null), label: "Priorité (4+ ∧ TOD)" },
    { color: resolveToken(LOT_4PLUS_TOD_TOKEN, LOT_4PLUS_TOD_FALLBACK, null), label: "Multifamilial 4+" },
    { color: resolveToken(LOT_TOD_TOKEN, LOT_TOD_FALLBACK, null), label: "Périmètre TOD" },
    { color: resolveToken(LOT_NEUTRAL_TOKEN, LOT_NEUTRAL_FALLBACK, null), label: "Sans indicateur" },
  ];
  /** Kinds réellement présents dans les zones de la ville active (hors fallback contour). */
  $: zoneLegendEntries = selectedCity
    ? zoneKindLegend(
        (zonesResponse?.featureCollection.features ?? [])
          .filter((f) => !f.properties.code.startsWith(CITY_FALLBACK_ZONE_PREFIX))
          .map((f) => ({
            kind: f.properties.kind ?? null,
            code: f.properties.code,
            affectation: f.properties.affectation ?? null,
          })),
        null,
      )
    : [];

  /**
   * Base du sélecteur de millésime de la légende = TOUTES les zones servies
   * (jamais filtrées) : le sélecteur se masque lui-même tant qu'il n'y a pas
   * ≥ 2 millésimes (dégradé honnête, jamais mono-option).
   */
  $: zoneMillesimeLegendInput = (
    zonesResponse?.featureCollection.features ?? []
  ).map((f) => ({ reglementMillesime: f.properties.reglementMillesime ?? null }));

  /** flyTo sur le centroïde WGS-84 de la ville (MunicipalityT.lon/lat). */
  function flyToCity(entry: CityMapEntry): void {
    mapApi?.flyTo({
      center: [entry.municipality.lon, entry.municipality.lat],
      zoom: 12,
      duration: 800,
    });
  }

  /**
   * #12 — Zoome sur l'étendue d'une zone sélectionnée. La feature de zone porte
   * sa propre `geometry` ; on calcule sa bbox via `geometryBounds`. Une zone
   * désignée sans polygone (geometry === null) renvoie une bbox nulle → on
   * retombe sur le centroïde ville (cadrage stable, pas de sur-zoom). La
   * mécanique de cadrage (repli flyTo si bbox dégénérée) vit dans le socle.
   */
  function zoomToZone(citySlug: string, code: string): void {
    const zone = zonesResponse?.featureCollection.features.find(
      (f) => f.properties.citySlug === citySlug && f.properties.code === code,
    );
    const bounds = geometryBounds(zone?.geometry ?? null);
    if (bounds) {
      mapApi?.fitMapToBounds(bounds);
      return;
    }
    // Repli : zone sans géométrie → recentre sur la ville sélectionnée.
    if (selectedCity) flyToCity(selectedCity);
  }

  /**
   * m4 — Commande caméra sur le LOT cliqué (clic carte OU clic liste), selon le
   * mode décidé par selection-camera :
   *  - `frame` (premier lot / lot d'une autre zone) : cadrage existant
   *    (fitBounds — peut changer le zoom) ;
   *  - `recenter` (autre lot de la même zone) : RECENTRE sur le centre du lot
   *    EN GARDANT le zoom courant (easeTo — JAMAIS fitBounds).
   * On ne refit JAMAIS sur la zone parente (rester au niveau lot). Lot sans
   * géométrie exploitable → on NE bouge PAS la caméra (et on ne mémorise rien).
   */
  function zoomToLot(
    citySlug: string,
    noLot: string,
    mode: "frame" | "recenter",
  ): void {
    const bounds = findLotBounds(
      displayedLots,
      citySlug,
      noLot,
      selectedCity?.municipality.slug ?? null,
    );
    if (!bounds) return;
    if (mode === "recenter") {
      mapApi?.recenterKeepZoom(boundsCenter(bounds));
    } else {
      mapApi?.fitMapToBounds(bounds);
    }
    // Mémorise le lot ciblé + sa zone : base de la décision au prochain clic.
    cameraLot = { citySlug, noLot, zoneCode: cameraZoneCodeForLot(citySlug, noLot) };
  }

  /**
   * Zone d'appartenance d'un lot pour la décision caméra (clé COMPARABLE, pas
   * d'affichage). Priorité au `zoneCode` joint par l'API (#314) ; repli
   * GÉOMÉTRIQUE (centre du lot dans le polygone de zone) quand le join est
   * absent. `null` = indéterminé — aucun code inventé, la décision retombe
   * alors sur le recentrage (jamais de changement de zoom surprise).
   */
  function cameraZoneCodeForLot(citySlug: string, noLot: string): string | null {
    const fallbackCity = selectedCity?.municipality.slug ?? null;
    const lot = displayedLots.features.find(
      (feature) =>
        feature.properties.noLot === noLot &&
        (feature.properties.citySlug ?? fallbackCity) === citySlug,
    );
    if (!lot) return null;
    const joined = lotZoneCode(lot.properties);
    if (joined) return zoneRefComparableKey(joined);
    const bounds = geometryBounds(lot.geometry ?? null);
    if (!bounds) return null;
    const code = zoneCodeAtPoint(
      zonesResponse?.featureCollection.features ?? null,
      boundsCenter(bounds),
    );
    return code === null ? null : zoneRefComparableKey(code);
  }

  /**
   * #13 / C9 — Retour à l'échelle province : restaure le CADRAGE EXACT du
   * primo-chargement (viewport mémorisé par le socle). Repli défensif :
   * fitBounds sur l'étendue du Québec si rien n'a été capturé.
   */
  function flyToProvince(): void {
    if (mapApi?.resetToInitialView({ duration: 800 })) return;
    mapApi?.fitMapToBounds(QUEBEC_PROVINCE_BOUNDS, { maxZoom: 7, duration: 800 });
  }

  // ── Callbacks d'interaction passés au socle ────────────────────────────────
  /** Clic ville → sélection (selectCity garde l'idempotence sur la même ville). */
  function handleCityClick(citySlug: string): void {
    if (selectedCity?.municipality.slug === citySlug) return;
    const entry = allEntries.find((ent) => ent.municipality.slug === citySlug);
    if (entry) void selectCity(entry);
  }

  /** Clic aplat zone → bascule la sélection de zone. */
  function handleZoneClick(zone: { citySlug: string; code: string }): void {
    toggleMapSelection(makeKey("zone", `${zone.citySlug}/${zone.code}`));
  }

  /** Clic aplat lot → bascule la sélection de lot (repli ville sélectionnée). */
  function handleLotClick(lot: { noLot: string; citySlug: string | null }): void {
    const citySlug = lot.citySlug ?? selectedCity?.municipality.slug;
    if (!citySlug) return;
    toggleMapSelection(makeKey("lot", `${citySlug}/${lot.noLot}`));
  }

  /**
   * Le socle est prêt : on capte son API impérative. Le bloc réactif
   * `mapReady && filteredDetailNodes` déclenche alors la 1re peinture des
   * couches zone/lot (équivalent de l'ancien `updateGeoLayers()` au load).
   */
  function handleMapReady(api: GeoCityMapApi): void {
    mapApi = api;
    mapReady = true;
    // Restauration d'URL (deep-link /geo/city/…) : si une ville est déjà
    // sélectionnée quand la carte devient prête, le flyTo de selectCity est
    // parti dans le vide (mapApi encore null) — on cadre la ville maintenant.
    if (selectedCity) flyToCity(selectedCity);
  }

  // ── Ville sélectionnée ─────────────────────────────────────────────────────
  async function selectCity(
    entry: CityMapEntry,
    options: { syncUrl?: boolean } = {},
  ): Promise<void> {
    const syncUrl = options.syncUrl ?? true;
    if (selectedCity?.municipality.slug === entry.municipality.slug) {
      return;
    }
    const transients = clearVivierCityTransientState(
      selectedCity?.municipality.slug ?? null,
      entry.municipality.slug,
      { activeEvidence, activeDocument, hoveredEvidenceSignalId },
    );
    activeEvidence = transients.activeEvidence;
    activeDocument = transients.activeDocument;
    activeSource = null;
    hoveredEvidenceSignalId = transients.hoveredEvidenceSignalId;
    if (syncUrl) {
      // Conserver le MODE actif (A/B) dans la nouvelle route ville. On persiste
      // la clé de mode, pas la sous-sélection LIVE (défaut A = z|m|p au reload).
      navigateToGeoRoute({
        level: "city",
        citySlug: entry.municipality.slug,
        state: {
          mode: geoRoute?.state.mode ?? "signal",
          filters: { subset: persistedSubsetKey.split("|") },
        },
      });
    }
    selectedCity = entry;
    detailNodes = [];
    detailLegacyProjection = null;
    geoNotices = [];
    // Contrat « lot suivant » : changement de ville → plus de lot caméra de
    // référence (le prochain lot cliqué est un PREMIER lot, cadrage existant).
    cameraLot = null;
    // Millésime exclusif : un choix d'une ville précédente n'a aucun sens sur la
    // nouvelle couche → retour à « tous » (dégradé honnête, jamais tout estompé).
    zoneMillesimeFilter = DEFAULT_ZONE_MILLESIME_FILTER;
    const cityKey = makeKey("municipality", entry.municipality.slug);
    selectionState = createSelectionBucketState({
      selectedKeys: [cityKey],
      focusedKey: cityKey,
      expandedKeys: [cityKey],
    });

    // flyTo sur la carte (centroïde de la ville)
    flyToCity(entry);

    // Les 3 couches partent EN PARALLÈLE, chacune avec son propre waiter et sa
    // propre garde anti-course : détail (panneau droit) + zones + lots.
    void loadDetailForCity(entry.municipality.slug);
    void loadGeoForCity(entry.municipality.slug);
  }

  /**
   * Charge le détail signaux (panneau droit) d'une ville avec garde anti-course
   * et timeout. Une réponse en retard/annulée (changement de ville) est ignorée ;
   * un échec bascule la couche en état d'erreur SANS toucher aux zones/lots.
   */
  async function loadDetailForCity(citySlug: string): Promise<void> {
    const lease = detailGuard.lease();
    detailLoading = true;
    detailError = null;
    detailLegacyProjection = null;
    try {
      const res = await fetchGraphSignalDetail(citySlug, "", DEFAULT_REQUEST_TIMEOUT_MS, {
        signal: lease.signal,
      });
      if (!lease.isCurrent()) return; // réponse périmée → on ignore
      if (!res.ok && res.nodes.length === 0) {
        // 404 — ville sans signaux graphify (état vide honnête, pas une erreur)
        detailNodes = [];
        detailLegacyProjection = null;
        detailError = null;
        return;
      }
      detailNodes = res.nodes;
      detailLegacyProjection = res.legacyProjection;
      // Alimenter le cache multi-villes (recoloration aplats filtrée)
      detailCache.set(citySlug, res.nodes);
      // Ne pas auto-focaliser le 1er signal : l'utilisateur choisit lui-même
      // quel signal ouvrir (clic dans le panneau droit).
      updateGeoLayers();
    } catch (e) {
      // Abort (changement de ville) → réponse périmée à ignorer, pas une erreur.
      if (!lease.isCurrent() || isAbortError(e)) return;
      console.warn("Signal detail load failed:", e);
      detailError = "Signaux indisponibles.";
      detailLegacyProjection = null;
    } finally {
      if (lease.isCurrent()) detailLoading = false;
    }
  }

  /** « Réessayer » du panneau : recharge uniquement le détail signaux. */
  function retryDetail(): void {
    if (selectedCity) void loadDetailForCity(selectedCity.municipality.slug);
  }

  /** « Réessayer » de la carte : recharge uniquement les couches zones+lots. */
  function retryGeo(): void {
    if (selectedCity) void loadGeoForCity(selectedCity.municipality.slug);
  }

  function clearSelection(options: { recenter?: boolean } = {}): void {
    // Supersède TOUTE requête en vol (détail + zones + lots) : aucune réponse
    // en retard ne repeindra la carte après « Fermer ».
    detailGuard.cancel();
    geoGuard.cancel();
    selectedCity = null;
    pendingRouteZoneKey = null;
    detailNodes = [];
    detailLegacyProjection = null;
    detailError = null;
    detailLoading = false;
    zonesError = null;
    lotsError = null;
    zonesLoading = false;
    lotsLoading = false;
    geoNotices = [];
    zonesResponse = null;
    lotsResponse = null;
    activeDocument = null;
    activeEvidence = null;
    activeSource = null;
    hoveredEvidenceSignalId = null;
    selectionState = createSelectionBucketState();
    // Contrat « lot suivant » : retour Province → plus de lot caméra de
    // référence (le prochain lot cliqué est un PREMIER lot, cadrage existant).
    cameraLot = null;
    updateGeoLayers();
    // #13 — dézoom caméra vers l'échelle province. Optionnel : `applyGeoRoute`
    // au montage initial appelle clearSelection sans vouloir animer la carte
    // (elle démarre déjà au niveau province), d'où le garde `recenter`.
    if (options.recenter !== false) flyToProvince();
  }

  /**
   * Clic sur le segmented-control Province / Ville / Zone.
   * Province → clearSelection (retour vue globale)
   * Ville → désélectionner les zones/lots mais conserver la ville sélectionnée
   * Zone → sélectionner la première zone disponible (si zones configurées)
   */
  function handleGeoLevelClick(level: string): void {
    // Niveau actif recalculé AU CLIC (jamais périmé — cf. computeGeoLevel).
    const activeGeoLevel = computeGeoLevel(selectionState, selectedCity);
    if (level === activeGeoLevel) return;
    if (level === "Province") {
      // Dézoom → vue province (bug #4). On REMET L'URL au niveau `region` (en
      // conservant le filtre subset actif) via la logique pure
      // buildGeoLevelNavigation, pas seulement l'état local. Sans cette
      // navigation, l'URL restait sur `city:slug` : au reload / à la navigation
      // suivante, `applyGeoRoute` re-sélectionnait la ville → on restait
      // « coincé » en focus ville. La navigation déclenche le bloc réactif
      // `applyGeoRoute(region)` → `clearSelection()`, l'état région devient
      // persistant et cohérent avec l'URL.
      const nav = buildGeoLevelNavigation({
        target: "Province",
        current: activeGeoLevel as GeoLevel,
        hasSelectedCity: !!selectedCity,
        mode: geoRoute?.state.mode,
        subsetKey: persistedSubsetKey,
      });
      if (nav) navigateToGeoRoute(nav);
      // Filet local immédiat (au cas où la route n'aurait pas changé d'identité,
      // ex. déjà en region) : on garantit un état de base propre tout de suite.
      clearSelection();
    } else if (level === "Ville") {
      if (!selectedCity) return;
      // Effacer toutes les sélections zone/lot, conserver la ville
      selectionState = createSelectionBucketState();
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
      // Clic sur un autre item → l'ajouter aux sélectionnés si absent, puis
      // focaliser. C3 : zone/lot passent par la sélection EXCLUSIVE (une seule
      // sélection géo à la fois) ; signaux/ville gardent la sélection multi.
      if (!selectionState.selectedKeys.has(key)) {
        selectionState = toggleExclusiveSelection(selectionState, key);
      }
      selectionState = setFocus(selectionState, key);
      // m4 — un LOT sélectionné depuis le pane droit commande la caméra
      // (parité stricte avec le clic carte, cf. toggleMapSelection) : #383 ne
      // couvrait que le clic carte, si bien que sélectionner un 2e lot depuis
      // la liste laissait le viewport sur le lot précédent. La décision (contrat
      // « lot suivant » : recentrage zoom conservé / cadrage / rien) vit dans
      // selection-camera — jamais de repli zone/ville. Les zones gardent leur
      // comportement (leur cadrage pane reste piloté par les autres chemins).
      if (parseKey(key)?.kind === "lot") {
        zoomToSelectionKey(key, { fitLot: true });
      }
    }
    syncRouteForSelectionKey(key);
    updateGeoLayers();
  }

  function focusBucketKey(key: SelectionKey | null): void {
    selectionState = setFocus(selectionState, key);
    // #11 — propage immédiatement le highlight géo (zones/lots du signal focusé)
    // à MapLibre. Le bloc réactif sur focusedSignal*Refs couvre déjà ce cas,
    // mais l'appel explicite garantit la mise à jour même si la réactivité ne
    // re-déclenche pas (ex. même set de refs réassigné). Idempotent.
    updateGeoLayers();
    // #12 — si on focalise une zone, cadrer la caméra dessus.
    if (key) zoomToSelectionKey(key);
  }

  function openDocument(ref: SignalDocRef): void {
    activeDocument = ref;
    activeSource = null;
  }

  function closeDocument(): void {
    activeDocument = null;
  }

  /**
   * m7 / m8 — ouvre une SOURCE documentaire générique dans le viewer partagé
   * (SignalPdfOverlay) : règlement PDF, grille de zonage, source de zone. Le
   * viewer décide seul PDF vs iframe selon l'URL. Un seul overlay à la fois :
   * on referme la preuve signal + le doc overlay pour éviter l'empilement.
   */
  function openSource(payload: {
    title: string;
    sourceUrl: string | null;
    rawRef?: string | null;
    page?: number | null;
  }): void {
    activeSource = {
      title: payload.title,
      sourceUrl: payload.sourceUrl ?? null,
      rawRef: payload.rawRef ?? null,
      page: payload.page ?? null,
    };
    activeEvidence = null;
    activeDocument = null;
  }

  function closeSource(): void {
    activeSource = null;
  }

  function openEvidence(payload: {
    title: string;
    evidence: SignalEvidence;
    node: GraphSignalNode;
  }): void {
    // LOT 2 (#84) : surligne TOUS les signaux du même PV (même rawRef). On
    // groupe ici car `detailNodes` (tous les signaux de la ville) vit dans
    // cette vue ; aucune route API à modifier.
    const signals = buildOverlaySignals(
      payload.node,
      detailNodes,
      payload.evidence.rawRef,
      // #4 — marque les co-PV signaux HORS-FILTRE (peints en slate par le viewer).
      (n) => filteredDetailNodes.some((candidate) => candidate.id === n.id),
    );
    activeEvidence = {
      title: payload.title,
      evidence: payload.evidence,
      signals,
      nodeId: payload.node.id,
    };
    // #91 — synchro bidirectionnelle : ouvrir/déplacer le viewer focalise AUSSI
    // la fiche correspondante à droite (elle se déplie + scrolle en miroir).
    syncRightPaneFocus(payload.node.id);
    // Ferme le doc overlay + la source générique pour éviter deux overlays superposés
    activeDocument = null;
    activeSource = null;
  }

  /**
   * #91 — NAVIGATION par signal demandée par le viewer (◀ Signal ▶ / menu).
   * `index` est un rang dans `navSignals` (= liste filtrée). On reconstruit
   * l'évidence + les signaux du nœud cible et on réassigne `activeEvidence` :
   * si le nœud cible pointe un AUTRE document, les props rawRef/page changent →
   * le viewer recharge le PDF (waiter #90, cache #89). Idempotent sur overlay
   * ouvert (déplace simplement l'index). Synchro la fiche droite en miroir.
   */
  function navigateToSignal(index: number): void {
    if (index < 0 || index >= navSignals.length) return;
    const target = navSignals[index];
    if (!target) return;
    const node = detailNodes.find((n) => n.id === target.id);
    if (!node) return;
    openEvidence({
      title: node.label,
      evidence: extractSignalEvidence(node),
      node,
    });
  }

  /**
   * Focalise la fiche d'un signal dans le pane droit (la déplie + scrolle).
   * Réutilise le mécanisme de focus existant (selectionState) que le pane
   * consomme déjà. Non destructif : conserve la sélection multi.
   */
  function syncRightPaneFocus(nodeId: string): void {
    const key = makeKey("signal", nodeId);
    if (!selectionState.selectedKeys.has(key)) {
      selectionState = toggleSelection(selectionState, key);
    }
    selectionState = setFocus(selectionState, key);
  }

  function closeEvidence(): void {
    activeEvidence = null;
  }

  function setHideOutOfFilter(hide: boolean): void {
    hideOutOfFilter = hide;
  }

  /**
   * #4 — Projette un nœud en données de hover-card pour le viewer (popover des
   * signaux hors-filtre). La couleur reprend celle du surlignage du même signal
   * dans le doc courant (cohérence pastille ↔ surlignage). Repli rang 0.
   */
  function resolveHoverCard(id: string): HoverCardData | null {
    const node = detailNodes.find((n) => n.id === id);
    if (!node) return null;
    const sig = activeEvidence?.signals.find((s) => s.id === id);
    const color = sig?.color ?? signalColorAt(0);
    return buildHoverCard(node, color);
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
    // C3 — sélection EXCLUSIVE : une seule zone OU un seul lot à la fois
    // (sélectionner un lot désélectionne la zone et réciproquement).
    selectionState = toggleExclusiveSelection(selectionState, key);
    selectionState = setFocus(selectionState, wasSelected ? null : key);
    if (!wasSelected) {
      syncRouteForSelectionKey(key);
      // #12 — zoom sur la zone qu'on vient de sélectionner (pas au déselect).
      // m4 — un clic carte sur un LOT commande la caméra (fitLot) selon le
      // contrat « lot suivant » (selection-camera) : jamais un refit sur la
      // zone parente, recentrage zoom conservé entre lots d'une même zone.
      zoomToSelectionKey(key, { fitLot: true });
    }
    updateGeoLayers();
  }

  /**
   * #12 / m4 — Cadre la caméra sur l'étendue de la clé sélectionnée. Centralisé
   * ici pour que tous les chemins de sélection de zone (clic carte, segmented
   * control « Zone », restauration d'URL) zooment de façon cohérente.
   *
   * Les LOTS ne sont cadrés que sur demande explicite (`fitLot`), càd un clic
   * carte sur un lot (m4) : on ajuste alors la caméra AU lot cliqué. Les autres
   * chemins de sélection de lot (auto-sélection du 1er lot d'une ville sans
   * zones) ne zooment PAS, pour ne pas plonger dans un lot arbitraire à
   * l'ouverture d'une ville.
   */
  function zoomToSelectionKey(
    key: SelectionKey,
    options: { fitLot?: boolean } = {},
  ): void {
    // Décision de commande factorisée (selection-camera.js) : zone → toujours
    // cadrée ; lot → seulement sur sélection utilisateur (`fitLot`), avec le
    // contrat « lot suivant » : reclic même lot = aucune commande ; autre lot
    // même zone = recentrage zoom conservé ; autre zone = cadrage existant.
    // Jamais de repli zone/ville pour un lot (pas de reset de viewport).
    const target = resolveSelectionCameraTarget(key, {
      ...options,
      previousLot: cameraLot,
      zoneCodeForLot: cameraZoneCodeForLot,
    });
    if (!target) return;
    if (target.kind === "zone") {
      zoomToZone(target.citySlug, target.code);
    } else {
      zoomToLot(target.citySlug, target.noLot, target.mode);
    }
  }

  async function applyGeoRoute(route: GeoRoute): Promise<void> {
    const key = vivierRouteKey(route);
    if (appliedGeoRouteKey === key) return;
    appliedGeoRouteKey = key;
    applyActiveSubsetKey(reconcileVivierRouteSubset(route, activeSubsetKey));

    if (route.level === "region") {
      // Au montage / restauration d'URL, la carte démarre déjà au niveau
      // province : pas d'animation forcée (recenter:false). Le dézoom animé
      // est piloté par le clic explicite « Province » (handleGeoLevelClick).
      clearSelection({ recenter: false });
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
      // C3 — sélection exclusive pour les clés géo (zone/lot).
      selectionState = toggleExclusiveSelection(selectionState, key);
    }
    selectionState = setFocus(selectionState, key);
    updateGeoLayers();
    // #12 — cadrage caméra sur la zone (segmented control « Zone », restauration
    // d'URL /geo/zone/...). No-op si la clé n'est pas une zone.
    zoomToSelectionKey(key);
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
    if (!parsed) return;
    // C3 — sélectionner un LOT désélectionne la zone : si l'URL est au niveau
    // zone, on la ramène au niveau ville (cohérence URL ↔ sélection exclusive).
    if (parsed.kind === "lot") {
      if (geoRoute?.level === "zone") {
        navigateToGeoRoute({
          level: "city",
          citySlug: geoRoute.citySlug,
          state: {
            mode: geoRoute.state.mode ?? "signal",
            filters: { subset: persistedSubsetKey.split("|") },
          },
        });
      }
      return;
    }
    if (parsed.kind !== "zone") return;
    const separatorIndex = parsed.id.indexOf("/");
    if (separatorIndex <= 0 || separatorIndex === parsed.id.length - 1) return;
    const citySlug = parsed.id.slice(0, separatorIndex);
    const zoneKey = parsed.id.slice(separatorIndex + 1);
    navigateToGeoRoute({
      level: "zone",
      citySlug,
      zoneKey,
      state: {
        mode: geoRoute?.state.mode ?? "signal",
        filters: { subset: persistedSubsetKey.split("|") },
      },
    });
  }

  // ── Opacités des aplats zone (teintes DOUCES : les lots restent lisibles) ──
  const ZONE_BASE_OPACITY = 0.25;
  const ZONE_FALLBACK_OPACITY = 0.15;
  // C6 — planchers d'opacité au SURVOL (teinte accentuée, jamais réduite).
  const ZONE_HOVER_MIN_OPACITY = 0.55;
  const LOT_HOVER_MIN_OPACITY = 0.5;
  /** Zones contenant des lots 4+ quand le filtre données 4+/Priorité est actif. */
  const ZONE_4PLUS_HIGHLIGHT_OPACITY = 0.45;

  /**
   * Compose les opacités des filtres de zone TYPE (additif) et MILLÉSIME
   * (exclusif). `null` = filtre inactif. Résultat :
   *  - les deux inactifs → `null` (la hiérarchie d'opacité existante s'applique) ;
   *  - au moins un actif → estompé si UN filtre actif écarte la zone, sinon
   *    accentué (une zone doit passer TOUS les filtres actifs pour ressortir).
   */
  function composeZoneFilterOpacity(
    kindOpacity: number | null,
    millesimeOpacity: number | null,
  ): number | null {
    if (kindOpacity === null && millesimeOpacity === null) return null;
    const dimmed =
      kindOpacity === ZONE_KIND_FILTER_DIMMED_OPACITY ||
      millesimeOpacity === ZONE_MILLESIME_FILTER_DIMMED_OPACITY;
    return dimmed
      ? ZONE_KIND_FILTER_DIMMED_OPACITY
      : ZONE_KIND_FILTER_MATCH_OPACITY;
  }

  function buildZoneOpacityExpression(
    zones = zonesResponse?.featureCollection.features ?? EMPTY_ZONES.features,
    signalZoneRefs: ReadonlySet<string> = focusedSignalZoneRefs,
  ): ExpressionSpecification | number {
    // Un `match` MapLibre sans branche est invalide : couche vide → constante.
    if (zones.length === 0) return ZONE_BASE_OPACITY;
    const hasSignalFocus = signalZoneRefs.size > 0;
    const geoKeys = geoSelectedKeys(selectionState);
    const hasZoneSelection = [...geoKeys].some((key) => key.startsWith("zone:"));
    const fourPlusKeys = computeFourPlusZoneKeys();
    const expr: unknown[] = ["match", ["get", "code"]];
    // Codes DUPLIQUÉS dans les collections réelles (ex. Salaberry : C-186 ×2,
    // polygones disjoints d'une même zone) : une seule branche match par code,
    // sinon MapLibre rejette l'expression.
    const seenCodes = new Set<string>();
    for (const zone of zones) {
      const code = zone.properties.code;
      if (seenCodes.has(code)) continue;
      seenCodes.add(code);
      const key = zoneSelectionKey(zone);
      // Filtres de zone (en-tête accordéon Zones) — matchée accentuée,
      // hors-filtre estompée mais visible ; null quand le filtre est inactif.
      // TYPE (additif) et MILLÉSIME (exclusif) se COMPOSENT : une zone n'est
      // accentuée que si elle passe TOUS les filtres actifs ; estompée dès
      // qu'un filtre actif l'écarte. Aucune zone n'est retirée de la carte.
      const kindOpacity = zoneKindFilterOpacity(
        zone.properties.kind ?? null,
        code,
        zoneKindFilter,
        zone.properties.affectation ?? null,
      );
      const millesimeOpacity = zoneMillesimeFilterOpacity(
        zone.properties.reglementMillesime ?? null,
        zoneMillesimeFilter,
      );
      const filterOpacity = composeZoneFilterOpacity(kindOpacity, millesimeOpacity);
      let opacity: number;
      if (hasSignalFocus) {
        opacity = signalZoneRefs.has(code) ? 0.85 : 0.15;
      } else if (hasZoneSelection) {
        // C3 — la zone sélectionnée ressort (teinte accentuée), les autres
        // s'estompent ; l'exergue orange est portée par la couche highlight.
        opacity = geoKeys.has(key) ? 0.85 : 0.12;
      } else if (filterOpacity !== null) {
        // Même mécanique que le filtre lots (#315) : la peinture est pilotée
        // par le(s) filtre(s), aucune zone n'est retirée de la carte.
        opacity = filterOpacity;
      } else if (fourPlusKeys.has(zoneRefComparableKey(code))) {
        opacity = ZONE_4PLUS_HIGHLIGHT_OPACITY;
      } else {
        opacity = code.startsWith(CITY_FALLBACK_ZONE_PREFIX)
          ? ZONE_FALLBACK_OPACITY
          : ZONE_BASE_OPACITY;
      }
      expr.push(code, opacity);
    }
    expr.push(hasSignalFocus || hasZoneSelection ? 0.12 : ZONE_BASE_OPACITY);
    return expr as ExpressionSpecification;
  }

  function buildLotOpacityExpression(
    lots: LotFeatureCollection = displayedLots,
    signalLotRefs: ReadonlySet<string> = focusedSignalLotRefs,
  ): ExpressionSpecification | number {
    // Un `match` MapLibre sans branche est invalide : couche vide → constante.
    if (lots.features.length === 0) return LOT_HIERARCHY_OPACITY.neutral;
    const hasSignalFocus = signalLotRefs.size > 0;
    // Sélection GÉO uniquement (zone/lot/signal) : la sélection de la ville
    // elle-même n'estompe rien — colorisation par défaut pleine à l'ouverture.
    const geoKeys = geoSelectedKeys(selectionState);
    const hasGeoSelection = geoKeys.size > 0;
    const dataFilterActive = !isDefaultEvalFilter(lotDataFilter);
    // #4 — atténuation par filtre SIGNAUX (z|m) uniquement quand ni focus
    // signal ni sélection géo ne pilotent déjà l'opacité.
    const dimByFilter =
      !hasSignalFocus && !hasGeoSelection && filterActive && hasProjectedLot;
    // Codes (comparables) des zones sélectionnées : leurs lots se surlignent
    // avec elles (contrat d'interaction clic zone → zone + ses lots).
    const selectedZoneCodes = new Set<string>();
    for (const key of geoKeys) {
      const parsed = parseKey(key);
      if (!parsed || parsed.kind !== "zone") continue;
      const sep = parsed.id.indexOf("/");
      if (sep > 0 && sep < parsed.id.length - 1) {
        selectedZoneCodes.add(zoneRefComparableKey(parsed.id.slice(sep + 1)));
      }
    }
    const expr: unknown[] = ["match", ["get", "noLot"]];
    const citySlug = selectedCity?.municipality.slug;
    for (const lot of lots.features) {
      const noLot = lot.properties.noLot;
      let opacity: number;
      if (hasSignalFocus) {
        opacity = signalLotRefs.has(noLot) ? 0.85 : 0.15;
      } else if (hasGeoSelection) {
        const key = lotSelectionKey(noLot, lot.properties.citySlug ?? citySlug);
        const zoneCodeKey = zoneRefComparableKey(lotZoneCode(lot.properties) ?? "");
        const highlighted =
          (key !== null && geoKeys.has(key)) ||
          (zoneCodeKey.length > 0 && selectedZoneCodes.has(zoneCodeKey));
        opacity = highlighted ? 0.85 : 0.15;
      } else if (
        dataFilterActive &&
        !lotMatchesEvalFilter(lot.properties, lotDataFilter)
      ) {
        // Hors-filtre données : estompé, jamais masqué (parité #315).
        opacity = FILTER_DIMMED_OPACITY;
      } else if (
        dimByFilter &&
        filterDimsProjection(lot.properties.signalProjection, true, true)
      ) {
        // Lot sans projection de signal alors qu'un filtre restreint est actif.
        opacity = FILTER_DIMMED_OPACITY;
      } else {
        // Hiérarchie concurrente PERMANENTE : priorité 0.5 > 4+ 0.4 > TOD 0.25
        // > neutre 0.15. Avec filtre données actif, les matchés ressortent.
        const base = lotHierarchyOpacity(lot.properties);
        opacity = dataFilterActive ? Math.max(base, 0.5) : base;
      }
      expr.push(noLot, opacity);
    }
    expr.push(
      hasSignalFocus || hasGeoSelection ? 0.12 : LOT_HIERARCHY_OPACITY.neutral,
    );
    return expr as ExpressionSpecification;
  }

  /**
   * (Re)peint les couches zone/lot via le socle. La VUE calcule les données +
   * expressions (couleur/opacité — dépendantes de l'état signal/filtre/focus) ;
   * le socle GeoCityMapBase porte l'échafaudage source/couche/setPaintProperty.
   * No-op tant que la carte n'est pas prête (mapApi null), comme l'ancien garde
   * `!mapInstance || !mapReady`.
   */
  function updateGeoLayers(): void {
    if (!mapApi) return;
    const zones = zonesResponse?.featureCollection ?? EMPTY_ZONES;
    const lots = lotsResponse
      ? decorateLotsWithSignalProjection(
          lotsResponse.featureCollection,
          zones.features,
          filteredDetailNodes,
        )
      : EMPTY_LOTS;
    // Élément monté sous le ThemeProvider (= conteneur carte du socle) pour
    // résoudre les tokens DS des expressions de couleur zone/lot (parité stricte).
    const el = mapApi.themeElement;
    // C3 — clés géo sélectionnées : décorent `isSelected` (exergue orange du
    // socle) sur la zone OU le lot sélectionné (sélection exclusive).
    const geoKeys = geoSelectedKeys(selectionState);
    // Teinte par kind portée PAR FEATURE (kindColor) : robuste aux codes
    // dupliqués et aux données arrivant après la création de la couche.
    const zonesForPaint = decorateSelectedFlag(
      decorateZonesWithKindColor(zones, computeFourPlusZoneKeys(), el),
      (props) =>
        geoKeys.has(makeKey("zone", `${props.citySlug}/${props.code}`)),
    );
    const citySlug = selectedCity?.municipality.slug ?? null;
    const lotsForPaint = decorateSelectedFlag(lots, (props) => {
      const slug = props.citySlug ?? citySlug;
      return slug !== null && slug !== undefined
        ? geoKeys.has(makeKey("lot", `${slug}/${props.noLot}`))
        : false;
    });
    // C6 — survol : teinte accentuée (opacité remontée) ; les teintes BLANCHES
    // (« Type non déterminé », « Sans indicateur ») virent au gris clair.
    const zoneNeutralColor = resolveMapColor(
      ZONE_KIND_NEUTRAL.token,
      ZONE_KIND_NEUTRAL.fallback,
      el,
    );
    const lotNeutralColor = resolveMapColor(LOT_NEUTRAL_TOKEN, LOT_NEUTRAL_FALLBACK, el);
    mapApi.syncGeoLayers({
      zones: zonesForPaint,
      lots: lotsForPaint,
      zoneFillColor: withHoverNeutralTint(
        zoneKindFillColorExpression(el),
        zoneNeutralColor,
      ),
      zoneFillOpacity: withHoverOpacityBoost(
        buildZoneOpacityExpression(zones.features),
        ZONE_HOVER_MIN_OPACITY,
      ),
      lotFillColor: withHoverNeutralTint(
        signauxLotFillColorExpression(el),
        lotNeutralColor,
      ),
      lotFillOpacity: withHoverOpacityBoost(
        buildLotOpacityExpression(lots),
        LOT_HOVER_MIN_OPACITY,
      ),
      lotLineColor: lotLineColorExpression(el),
    });
  }

  /**
   * Lecture des réponses géo committées. Le type de retour est ANNOTÉ pour
   * casser le flow-narrowing de TS : dans `loadGeoForCity`, `zonesResponse` est
   * (ré)assigné dans des closures async que l'analyse de flux ne suit pas, si
   * bien qu'un accès direct après `await` le verrait comme `null`.
   */
  function committedGeoResponses(): {
    zones: GeoZonesResponse | null;
    lots: LotsResponse | null;
  } {
    return { zones: zonesResponse, lots: lotsResponse };
  }

  /**
   * Charge les couches géo (zones + lots) d'une ville.
   *
   * Chaque couche est une TÂCHE INDÉPENDANTE : son waiter (`zonesLoading` /
   * `lotsLoading`) se résout dès QUE SA réponse arrive (pas de couplage : lots
   * n'attend pas zones). Garde anti-course commune (`geoGuard`) : au changement
   * de ville, les réponses en retard sont ignorées (jeton) ET avortées (signal).
   * Timeout borné côté clients → un échec bascule la couche en erreur SANS
   * casser l'autre.
   */
  async function loadGeoForCity(citySlug: string): Promise<void> {
    const lease = geoGuard.lease();
    zonesLoading = true;
    zonesError = null;
    lotsLoading = true;
    lotsError = null;
    geoNotices = [];
    zonesResponse = null;
    lotsResponse = null;
    updateGeoLayers();
    // Notices accumulées par couche (affichage honnête « fallback / vide »).
    const notices: string[] = [];
    const publishNotices = () => {
      if (lease.isCurrent()) geoNotices = [...notices];
    };

    // ── Couche ZONES (waiter propre) ─────────────────────────────────────────
    // Résolution TIERÉE (signaux-zones-loader) : endpoint de résolution API,
    // PUIS collection OGC `qc-zonage-<slug>` (passthrough) quand l'endpoint ne
    // connaît pas la ville. Le fallback contour ville ne reste appliqué que si
    // la collection est VRAIMENT absente (cas Salaberry-de-Valleyfield : 645
    // vraies zones servies par la collection, plus jamais le contour).
    const zonesTask = (async () => {
      try {
        const loaded = await loadSignauxZones(citySlug, { signal: lease.signal });
        if (!lease.isCurrent()) return;
        if (loaded.tier !== "none" && loaded.response) {
          zonesResponse = loaded.response;
          if (
            loaded.tier === "endpoint" &&
            loaded.response.resolutionStatus === "fallback"
          ) {
            notices.push("Zones dérivées des lots : géométrie officielle non configurée.");
          }
        } else if (!loaded.response) {
          // Endpoint ET collection non configurés → état vide honnête.
          zonesResponse = emptyUnconfiguredZones(citySlug);
        } else {
          const entry = allEntries.find((item) => item.municipality.slug === citySlug);
          const withFallback = withCityFallbackZone(loaded.response, {
            citySlug,
            cityName: entry?.municipality.name ?? citySlug,
            geometry: mapApi?.getCityBoundary(citySlug) ?? null,
          });
          zonesResponse = withFallback.response;
          if (withFallback.created) {
            notices.push(
              (mapApi?.hasCityBoundary(citySlug) ?? false)
                ? `Zones non configurées : fallback ${fallbackZoneCode(citySlug)} sur le contour ville.`
                : `Zones non configurées : fallback ${fallbackZoneCode(citySlug)} sans géométrie disponible.`,
            );
          }
        }
      } catch (err) {
        // Abort (changement de ville) → réponse périmée à ignorer.
        if (!lease.isCurrent() || isAbortError(err)) return;
        console.warn("Zones load failed:", err);
        zonesError = "Zones indisponibles.";
      } finally {
        if (lease.isCurrent()) {
          zonesLoading = false;
          publishNotices();
          updateGeoLayers();
        }
      }
    })();

    // ── Couche LOTS (waiter propre) ──────────────────────────────────────────
    // C8 — TOUS les lots de la ville (parité référence) : pagination OGC
    // multi-pages fusionnée (fetchAllLots), peinte PROGRESSIVEMENT à chaque
    // page reçue. Garde anti-course inchangée (lease + AbortSignal).
    const lotsTask = (async () => {
      try {
        const value = await fetchAllLots(citySlug, {
          signal: lease.signal,
          onPage: (partial) => {
            if (!lease.isCurrent()) return;
            lotsResponse = partial;
            updateGeoLayers();
          },
        });
        if (!lease.isCurrent()) return;
        lotsResponse = value;
        if (!value.ok || value.source === "none") {
          notices.push(
            value.reason
              ? `Lots non configurés : ${value.reason}`
              : "Lots non configurés pour cette ville.",
          );
        } else if (value.featureCollection.features.length === 0) {
          notices.push("Lots configurés, mais aucun lot dans la réponse.");
        }
      } catch (err) {
        if (!lease.isCurrent() || isAbortError(err)) return;
        console.warn("Lots load failed:", err);
        lotsError = "Lots indisponibles.";
      } finally {
        if (lease.isCurrent()) {
          lotsLoading = false;
          publishNotices();
          updateGeoLayers();
        }
      }
    })();

    await Promise.allSettled([zonesTask, lotsTask]);
    if (!lease.isCurrent()) return; // ville changée entre-temps → on abandonne
    publishNotices();

    // 2.4 — Ville sans zones configurées → bascule par défaut sur le 1er lot.
    // Relecture via accesseur (type de retour annoté) : les assignations de
    // zonesResponse/lotsResponse vivent dans les closures async ci-dessus, que
    // l'analyse de flux TS ne re-widen pas — un accès direct serait narrow à
    // `null`/`never`. L'accesseur casse ce narrowing.
    const { zones: zonesNow, lots: lotsNow } = committedGeoResponses();
    const noZones =
      !zonesNow ||
      zonesNow.zoneCount === 0 ||
      zonesNow.featureCollection.features.length === 0;
    const firstLot = lotsNow?.featureCollection.features[0] ?? null;
    if (noZones && firstLot && lease.isCurrent()) {
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
      applyActiveSubsetKey(initialSubsetKey);
    }
    // m5 — restaurer les préférences d'affichage des libellés (persistance
    // session). Défaut si rien de persisté : n° de zone AFFICHÉ, n° de lot masqué.
    showLotLabels = readLabelPref(LOT_LABELS_LS_KEY, false);
    showZoneLabels = readLabelPref(ZONE_LABELS_LS_KEY, true);
    void load();
    // L'init MapLibre est portée par le socle GeoCityMapBase (cf. template).
  });
</script>

<ViewLayout controlsWidth="w-80" selWidth="w-80">
  <!-- ── RAIL gauche : recherche + facets + accordéon villes ─────────────── -->
  <svelte:fragment slot="controls">
    {#if loadError}
      <div class="px-4 py-2 text-xs text-red-600 border-b border-red-100 bg-red-50">
        {loadError} — les compteurs sont masqués tant que les données ne sont pas chargées.
      </div>
    {/if}
    <!-- Plus de panneau autonome « Filtre Zones et Lots » ici : les filtres
         données vivent dans le drawer droit (en-têtes des accordéons Zones
         et Lots de SignauxSelPanel). -->
    <SignauxRail
      entries={allEntries}
      selectedSlug={selectedCity?.municipality.slug ?? null}
      {loading}
      dataUnavailable={loadError !== null}
      initialSubsetKey={activeSubsetKey}
      exclusions={vivierBExclusions}
      {dateRange}
      {selectedCityLiveCount}
      onSelectCity={selectCity}
      onRefresh={load}
      onFilterChange={handleFilterChange}
      onExclusionsChange={handleExclusionsChange}
      onDateRangeChange={handleDateRangeChange}
    />
  </svelte:fragment>

  <!-- ── CANVAS : carte (socle GeoCityMapBase) ────────────────────────────── -->
  <!--
    La couleur choroplèthe = nb de signaux (fillColorExpression). Le socle porte
    l'init MapLibre, le drill segmenté, la caméra et l'échafaudage zone/lot ;
    cette vue ne pilote que les données + expressions métier. Iso-comportement.
  -->
  <GeoCityMapBase
    basemap="neutral-gray"
    {fillColorExpression}
    {fillOpacityExpression}
    {showLotLabels}
    {showZoneLabels}
    activeCitySlug={selectedCity?.municipality.slug ?? null}
    segments={buildGeoSegments(selectedCity, zonesResponse)}
    activeSegment={computeGeoLevel(selectionState, selectedCity)}
    onSegmentClick={handleGeoLevelClick}
    onCityClick={handleCityClick}
    onZoneClick={handleZoneClick}
    onLotClick={handleLotClick}
    onReady={handleMapReady}
  >
    <!-- C1 — LÉGENDES SUR LA CARTE (comme la vue Sources), plus dans le rail.
         Ville active : bloc « Zonage » AU-DESSUS du bloc « Lots ». -->
    <svelte:fragment slot="overlay-bottom-left">
      {#if !selectedCity}
        <div
          class="rounded border border-slate-200 bg-white/95 px-3 py-2 shadow-sm"
          data-testid="map-legend-signaux"
        >
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Légende — signaux / ville</p>
          <ul class="space-y-1">
            {#each [
              { color: "#ef4444", label: "6+ signaux" },
              { color: "#f97316", label: "3–5 signaux" },
              { color: "#fbbf24", label: "1–2 signaux" },
              { color: "#e2e8f0", label: "Aucun signal (0)" },
            ] as item (item.label)}
              <li class="flex items-center gap-2 text-xs text-slate-600">
                <span class="h-3 w-3 shrink-0 rounded-sm border border-slate-300" style="background-color: {item.color};"></span>
                {item.label}
              </li>
            {/each}
          </ul>
        </div>
      {:else}
        {#if zoneLegendEntries.length > 0}
          <div
            class="rounded border border-slate-200 bg-white/95 px-3 py-2 shadow-sm"
            data-testid="map-legend-zonage"
          >
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Zonage</p>
            <!-- m6 — sélecteur de millésime (exclusif), masqué tant qu'un seul
                 millésime est servi pour la ville (dégradé honnête). -->
            <div class="mb-2">
              <ZoneMillesimeSelect
                zones={zoneMillesimeLegendInput}
                filter={zoneMillesimeFilter}
                onChange={handleZoneMillesimeFilterChange}
              />
            </div>
            <ul class="grid grid-cols-2 gap-x-3 gap-y-1">
              {#each zoneLegendEntries as item (item.label)}
                <li class="flex items-center gap-2 text-xs text-slate-600">
                  <span class="h-3 w-3 shrink-0 rounded-sm border border-slate-300" style="background-color: {item.color};"></span>
                  {item.label}
                </li>
              {/each}
            </ul>
            <!-- Case DS indépendante : affiche/masque le n° de zone sur les aplats. -->
            <div class="mt-2 border-t border-slate-100 pt-2" data-testid="legend-zone-labels-toggle">
              <Checkbox
                label="N° de zone"
                checked={showZoneLabels}
                onchange={(event) => setShowZoneLabels(event.currentTarget.checked)}
              />
            </div>
          </div>
        {/if}
        <div
          class="rounded border border-slate-200 bg-white/95 px-3 py-2 shadow-sm"
          data-testid="map-legend-lots"
        >
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Lots</p>
          <ul class="space-y-1">
            {#each lotLegendEntries as item (item.label)}
              <li class="flex items-center gap-2 text-xs text-slate-600">
                <span class="h-3 w-3 shrink-0 rounded-sm border border-slate-300" style="background-color: {item.color};"></span>
                {item.label}
              </li>
            {/each}
          </ul>
          <!-- Case DS indépendante : affiche/masque le n° de lot sur les aplats. -->
          <div class="mt-2 border-t border-slate-100 pt-2" data-testid="legend-lot-labels-toggle">
            <Checkbox
              label="N° de lot"
              checked={showLotLabels}
              onchange={(event) => setShowLotLabels(event.currentTarget.checked)}
            />
          </div>
        </div>
      {/if}
    </svelte:fragment>

    <svelte:fragment slot="overlay-top-left">
      {#if selectedCity && (zonesLoading || lotsLoading || zonesError || lotsError || geoNotices.length > 0)}
        <div class="max-w-sm space-y-1 rounded border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm">
          <!-- Waiter PAR COUCHE : chacune affiche son propre état. -->
          {#if zonesLoading}
            <p class="m-0 font-semibold text-slate-500">Chargement des zones…</p>
          {/if}
          {#if lotsLoading}
            <p class="m-0 font-semibold text-slate-500">Chargement des lots…</p>
          {/if}
          <!-- Erreur PAR COUCHE : neutre + « Réessayer » ; n'affecte pas l'autre. -->
          {#if zonesError}
            <p class="m-0 flex items-center gap-2 text-amber-700">
              <span>Zones indisponibles.</span>
              <button type="button" class="font-semibold underline hover:text-amber-900" on:click={retryGeo}>Réessayer</button>
            </p>
          {/if}
          {#if lotsError}
            <p class="m-0 flex items-center gap-2 text-amber-700">
              <span>Lots indisponibles.</span>
              <button type="button" class="font-semibold underline hover:text-amber-900" on:click={retryGeo}>Réessayer</button>
            </p>
          {/if}
          {#each geoNotices as notice (notice)}
            <p class="m-0 text-slate-600">{notice}</p>
          {/each}
        </div>
      {/if}
    </svelte:fragment>

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
        provisional={activeEvidence.evidence.provisional}
        signals={activeEvidence.signals}
        {navSignals}
        {navIndex}
        onNavigate={navigateToSignal}
        {hideOutOfFilter}
        onToggleHideOutOfFilter={setHideOutOfFilter}
        onSignalHover={setHoveredEvidenceSignal}
        hoveredSignalId={hoveredEvidenceSignalId}
        {resolveHoverCard}
        onClose={closeEvidence}
      />
    {/if}
    {#if activeSource}
      <!-- m7 / m8 — viewer partagé pour une source générique (règlement PDF,
           grille de zonage, source de zone). Pas de navigation multi-signaux :
           navSignals vide → la rangée de nav du viewer reste masquée. -->
      <SignalPdfOverlay
        title={activeSource.title}
        sourceUrl={activeSource.sourceUrl}
        rawRef={activeSource.rawRef}
        page={activeSource.page}
        onClose={closeSource}
      />
    {/if}
  </GeoCityMapBase>

  <!-- ── SEL droit : contexte de sélection (Ville active + Signaux / Zones /
       Lots). Les filtres DONNÉES vivent en EN-TÊTE des accordéons Zones et
       Lots ; leur état est porté ici (peinture carte, zéro refetch). ─────── -->
  <svelte:fragment slot="sel">
    <SignauxSelPanel
      {selectedCity}
      detailNodes={filteredDetailNodes}
      unfilteredSignalCount={detailNodes.length}
      {detailLoading}
      detailError={effectiveDetailError}
      {zonesLoading}
      {zonesError}
      {lotsLoading}
      {lotsError}
      {zonesResponse}
      {lotsResponse}
      {selectionState}
      activeSubsetKey=""
      vivierBMode={activeViewMode === "b"}
      lotFilter={lotDataFilter}
      onLotFilterChange={handleLotDataFilterChange}
      {zoneKindFilter}
      onZoneKindFilterChange={handleZoneKindFilterChange}
      {zoneMillesimeFilter}
      onZoneMillesimeFilterChange={handleZoneMillesimeFilterChange}
      onClear={() => clearSelection()}
      onToggleKey={toggleBucketKey}
      onOpenDocument={openDocument}
      onOpenEvidence={openEvidence}
      onOpenSource={openSource}
      onRetryDetail={retryDetail}
      onRetryGeo={retryGeo}
      hoveredSignalId={hoveredEvidenceSignalId}
      onHoverSignal={setHoveredEvidenceSignal}
    />
  </svelte:fragment>
</ViewLayout>
