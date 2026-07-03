<script lang="ts">
  /**
   * SourceCoverageMap — onglet « Couverture » de la vue Source.
   *
   * MÊME mode d'interaction que la vue Signaux (socle carto partagé
   * GeoCityMapBase + structure rail gauche / carte / drawer droit), la vue ne
   * différant que sur :
   *   - le CRITÈRE DE FILTRAGE du rail : radio EXCLUSIF à 3 portées
   *     (« Focus QA : 4 villes » / « 30 villes à signaux » / « Toutes » —
   *     coverage-scope) au lieu des 3 cases à cocher de Signaux. La portée
   *     remplace l'ancien toggle « Province (1104) / Focus 30 » de la carte ;
   *   - le DRAWER droit : scorecard de couverture de la ville sélectionnée
   *     (SourceScorecard — PV · signaux · zones · normes · lots · TOD) au lieu
   *     des accordéons Signaux/Zones/Lots ;
   *   - la SÉMANTIQUE de coloration : tri-état honnête Servi / Partiel /
   *     Non couvert (D2 : jamais un score 0-100, jamais de vert fabriqué).
   *
   * Drill au clic ville (parité Signaux) : sélection + cadrage caméra sur le
   * contour + chargement des ZONES (résolution tiérée signaux-zones-loader,
   * fallback contour ville honnête) ; segmented-control Province / Ville /
   * Zone partagé (geo-drill) ; clic zone → sélection exclusive + zoom bbox.
   *
   * La VUE ne porte que les données + expressions métier ; toute la mécanique
   * carto (MapLibre, caméra, échafaudage des couches) vit dans le socle.
   */
  import { Alert } from "@sentropic/design-system-svelte";
  import { MapPin } from "@lucide/svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import GeoCityMapBase, {
    type GeoCityMapApi,
    type GeoMapLegend,
  } from "$lib/components/maps/GeoCityMapBase.svelte";
  import SourcesRail from "./SourcesRail.svelte";
  import SourceScorecard from "./SourceScorecard.svelte";
  import {
    buildFillColorExpression,
    computeFocusScope,
    buildProvinceHeadline,
    formatProvinceHeadline,
    STATE_COLOR,
    STATE_LABEL,
    type CityCoverage,
    type CoverageResponse,
  } from "$lib/sources/source-coverage-client.js";
  import {
    buildScopeOpacityExpression,
    DEFAULT_COVERAGE_SCOPE,
    type CoverageScope,
  } from "$lib/sources/coverage-scope.js";
  import {
    buildDrillSegments,
    computeDrillLevel,
    zonesConfigured,
  } from "$lib/maps/geo-drill.js";
  import {
    emptyUnconfiguredZones,
    loadSignauxZones,
  } from "$lib/maps/signaux-zones-loader.js";
  import type {
    GeoZoneFeature,
    GeoZoneFeatureCollection,
    GeoZonesResponse,
  } from "$lib/maps/geo-zones-client.js";
  import {
    decorateSelectedFlag,
    fallbackZoneCode,
    withCityFallbackZone,
    CITY_FALLBACK_ZONE_PREFIX,
    FILTER_DIMMED_OPACITY,
  } from "$lib/maps/signaux-map-geo.js";
  import {
    decorateZonesWithKindColor,
    zoneKindLegend,
    ZONE_KIND_NEUTRAL,
  } from "$lib/maps/zone-kind-style.js";
  import {
    withHoverNeutralTint,
    withHoverOpacityBoost,
  } from "$lib/maps/hover-paint.js";
  import {
    resolveMapColor,
    LOT_NEUTRAL_TOKEN,
    LOT_NEUTRAL_FALLBACK,
  } from "$lib/maps/score-color-scale.js";
  import {
    geometryBounds,
    QUEBEC_PROVINCE_BOUNDS,
  } from "$lib/maps/geometry-bounds.js";
  import { RequestGuard } from "$lib/net/request-guard.js";
  import { isAbortError } from "$lib/net/fetch-with-timeout.js";
  import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

  const EMPTY_ZONES: GeoZoneFeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  const EMPTY_LOTS: { type: "FeatureCollection"; features: unknown[] } = {
    type: "FeatureCollection",
    features: [],
  };

  export let cities: CityCoverage[] = [];
  export let response: CoverageResponse | null = null;
  export let loading = false;
  export let error: string | null = null;
  export let onReload: () => void = () => {};

  // ── Carte (socle) ──────────────────────────────────────────────────────────
  let mapApi: GeoCityMapApi | null = null;

  // ── Portée (rail gauche, radio EXCLUSIF) — remplace le toggle Focus 30 ─────
  /** Défaut « Toutes » = comportement Province historique. */
  let scope: CoverageScope = DEFAULT_COVERAGE_SCOPE;

  function handleScopeChange(next: CoverageScope): void {
    scope = next;
  }
  // Périmètre « 30 villes à signaux » (présence de signaux, PAS priorityRank ≤ 30) :
  // partagé par la portée focus30 (coverage-scope) et le badge Focus 30 du drawer.
  $: focusScope = computeFocusScope(cities);

  // ── Sélection ville + zone (drill, parité Signaux) ─────────────────────────
  let selectedCity: CityCoverage | null = null;
  let selectedZoneCode: string | null = null;

  // ── Couche ZONES de la ville sélectionnée (waiter propre + anti-course) ────
  let zonesLoading = false;
  let zonesError: string | null = null;
  let zonesResponse: GeoZonesResponse | null = null;
  let geoNotices: string[] = [];
  const geoGuard = new RequestGuard();

  const cityBySlug = new Map<string, CityCoverage>();
  $: {
    cityBySlug.clear();
    for (const c of cities) cityBySlug.set(c.citySlug, c);
  }

  function syntheticAbsentCity(slug: string): CityCoverage {
    // Ville présente sur la carte mais ABSENTE de la couverture → carte
    // « absent » honnête (jamais vert, jamais une erreur).
    return {
      citySlug: slug,
      cityName: slug,
      mrc: null,
      priorityRank: null,
      l1Raw: { state: "absent", count: 0, freshness: "unknown" },
      l2Graph: { state: "absent", ontologyVersion: null, freshness: "unknown" },
      signals: { state: "absent", count: 0, withCitation: 0, freshness: "unknown" },
      l4Zonage: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
      normes: { state: "absent", freshness: "unknown" },
      l5Lots: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
      tod: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
      worstStatus: "absent",
      nextMarginalGain: null,
    };
  }

  // ── Expressions choroplèthe ────────────────────────────────────────────────
  // Couleur = pire statut honnête (sémantique COUVERTURE, propre à Sources).
  // Opacité : sans sélection → la PORTÉE active surligne ses villes (le reste
  // atténué) ; ville sélectionnée → aplats quasi transparents (les zones du
  // drill se lisent — parité Signaux 0.06 / 0.1 / 0.08).
  $: fillColorExpression = buildFillColorExpression(cities);
  $: fillOpacityExpression = (selectedCity
    ? buildSelectedCityOpacityExpression(cities, selectedCity.citySlug)
    : buildScopeOpacityExpression(cities, scope)) as
    | ExpressionSpecification
    | number;

  function buildSelectedCityOpacityExpression(
    all: CityCoverage[],
    activeSlug: string,
  ): ExpressionSpecification | number {
    if (all.length === 0) return 0.08;
    const expr: unknown[] = ["match", ["get", "citySlug"]];
    for (const city of all) {
      expr.push(city.citySlug, city.citySlug === activeSlug ? 0.06 : 0.1);
    }
    expr.push(0.08);
    return expr as ExpressionSpecification;
  }

  // ── Légende (overlay socle) : couverture au niveau province, zonage drillé ─
  const coverageLegend: GeoMapLegend = {
    title: "Couverture par ville",
    items: [
      { color: STATE_COLOR.verified, label: STATE_LABEL.verified },
      { color: STATE_COLOR.declared, label: STATE_LABEL.declared },
      { color: STATE_COLOR.absent, label: STATE_LABEL.absent },
    ],
  };

  /** Kinds réellement présents dans les zones de la ville active. */
  $: zoneLegendEntries = selectedCity
    ? zoneKindLegend(
        (zonesResponse?.featureCollection.features ?? [])
          .filter((f) => !f.properties.code.startsWith(CITY_FALLBACK_ZONE_PREFIX))
          .map((f) => ({ kind: f.properties.kind ?? null, code: f.properties.code })),
        null,
      )
    : [];

  $: legend = selectedCity
    ? zoneLegendEntries.length > 0
      ? ({ title: "Zonage", items: zoneLegendEntries } as GeoMapLegend)
      : null
    : coverageLegend;

  // ── Drill segmenté Province / Ville / Zone (logique partagée geo-drill) ────
  $: geoSegments = buildDrillSegments({
    hasSelectedCity: selectedCity !== null,
    zonesConfigured: zonesConfigured(zonesResponse),
  });
  $: activeSegment = computeDrillLevel({
    hasSelectedCity: selectedCity !== null,
    hasZoneSelection: selectedZoneCode !== null,
  });

  /**
   * Clic sur le segmented-control (parité Signaux) :
   * Province → désélection (retour vue globale, dézoom)
   * Ville → désélectionner la zone, conserver la ville
   * Zone → sélectionner la première zone disponible (si configurées)
   */
  function handleSegmentClick(label: string): void {
    if (label === activeSegment) return;
    if (label === "Province") {
      clearSelection();
      return;
    }
    if (!selectedCity) return;
    if (label === "Ville") {
      selectedZoneCode = null;
      updateZoneLayers();
      return;
    }
    const zones = zonesResponse?.featureCollection.features ?? [];
    if (zones.length === 0) return; // zones non configurées — rien à faire
    selectZone(zones[0].properties.code);
  }

  // ── Headline province (D7) ─────────────────────────────────────────────────
  $: headline = response ? buildProvinceHeadline(response) : null;
  $: headlineText = response ? formatProvinceHeadline(response.totals) : "";

  // ── Sélection ville → drawer scorecard + drill zones ───────────────────────
  function handleCityClick(slug: string): void {
    if (selectedCity?.citySlug === slug) return;
    selectCity(cityBySlug.get(slug) ?? syntheticAbsentCity(slug));
  }

  /** Sélection depuis le rail (même chemin que le clic carte). */
  function handleRailSelect(city: CityCoverage): void {
    if (selectedCity?.citySlug === city.citySlug) return;
    selectCity(city);
  }

  function selectCity(city: CityCoverage): void {
    selectedCity = city;
    selectedZoneCode = null;
    // Cadrage caméra sur le contour de la ville (parité Signaux). Repli : si le
    // contour n'est pas en cache (géométrie absente), on ne force pas la caméra.
    fitCityBounds(city.citySlug);
    void loadZonesForCity(city.citySlug);
  }

  function fitCityBounds(slug: string): void {
    const boundary = mapApi?.getCityBoundary(slug) ?? null;
    const bounds = geometryBounds(boundary);
    if (bounds) mapApi?.fitMapToBounds(bounds, { maxZoom: 11 });
  }

  function clearSelection(options: { recenter?: boolean } = {}): void {
    // Supersède toute requête zones en vol : aucune réponse en retard ne
    // repeindra la carte après « Fermer ».
    geoGuard.cancel();
    selectedCity = null;
    selectedZoneCode = null;
    zonesResponse = null;
    zonesError = null;
    zonesLoading = false;
    geoNotices = [];
    updateZoneLayers();
    if (options.recenter !== false) flyToProvince();
  }

  /** Retour à l'échelle province : cadrage EXACT du primo-chargement (C9). */
  function flyToProvince(): void {
    if (mapApi?.resetToInitialView({ duration: 800 })) return;
    mapApi?.fitMapToBounds(QUEBEC_PROVINCE_BOUNDS, { maxZoom: 7, duration: 800 });
  }

  // ── Sélection de zone (exclusive) + zoom bbox (parité Signaux #12) ─────────
  function selectZone(code: string): void {
    selectedZoneCode = code;
    updateZoneLayers();
    zoomToZone(code);
  }

  /** Clic aplat zone → bascule la sélection de zone. */
  function handleZoneClick(zone: { citySlug: string; code: string }): void {
    if (selectedZoneCode === zone.code) {
      selectedZoneCode = null;
      updateZoneLayers();
      return;
    }
    selectZone(zone.code);
  }

  function zoomToZone(code: string): void {
    const feature = zonesResponse?.featureCollection.features.find(
      (f) => f.properties.code === code,
    );
    const bounds = geometryBounds(feature?.geometry ?? null);
    if (bounds) {
      mapApi?.fitMapToBounds(bounds);
      return;
    }
    // Repli : zone sans géométrie → recadre sur la ville sélectionnée.
    if (selectedCity) fitCityBounds(selectedCity.citySlug);
  }

  // ── Chargement ZONES (résolution tiérée + fallback contour, anti-course) ───
  async function loadZonesForCity(citySlug: string): Promise<void> {
    const lease = geoGuard.lease();
    zonesLoading = true;
    zonesError = null;
    zonesResponse = null;
    geoNotices = [];
    updateZoneLayers();
    const notices: string[] = [];
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
        notices.push("Zones non configurées pour cette ville.");
      } else {
        const withFallback = withCityFallbackZone(loaded.response, {
          citySlug,
          cityName: selectedCity?.cityName ?? citySlug,
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
        geoNotices = [...notices];
        updateZoneLayers();
      }
    }
  }

  /** « Réessayer » : recharge uniquement la couche zones. */
  function retryZones(): void {
    if (selectedCity) void loadZonesForCity(selectedCity.citySlug);
  }

  // ── Peinture des aplats zone (teintes par kind + sélection exclusive) ──────
  const ZONE_BASE_OPACITY = 0.25;
  const ZONE_FALLBACK_OPACITY = 0.15;
  const ZONE_SELECTED_OPACITY = 0.85;
  // C6 — plancher d'opacité au SURVOL (teinte accentuée, jamais réduite).
  const ZONE_HOVER_MIN_OPACITY = 0.55;

  function buildZoneOpacityExpression(
    zones: GeoZoneFeature[],
  ): ExpressionSpecification | number {
    // Un `match` MapLibre sans branche est invalide : couche vide → constante.
    if (zones.length === 0) return ZONE_BASE_OPACITY;
    const hasZoneSelection = selectedZoneCode !== null;
    const expr: unknown[] = ["match", ["get", "code"]];
    // Codes DUPLIQUÉS dans les collections réelles : une seule branche par code.
    const seenCodes = new Set<string>();
    for (const zone of zones) {
      const code = zone.properties.code;
      if (seenCodes.has(code)) continue;
      seenCodes.add(code);
      let opacity: number;
      if (hasZoneSelection) {
        // La zone sélectionnée ressort ; les autres s'estompent (l'exergue
        // orange est portée par la couche highlight du socle).
        opacity =
          code === selectedZoneCode
            ? ZONE_SELECTED_OPACITY
            : FILTER_DIMMED_OPACITY;
      } else {
        opacity = code.startsWith(CITY_FALLBACK_ZONE_PREFIX)
          ? ZONE_FALLBACK_OPACITY
          : ZONE_BASE_OPACITY;
      }
      expr.push(code, opacity);
    }
    expr.push(hasZoneSelection ? FILTER_DIMMED_OPACITY : ZONE_BASE_OPACITY);
    return expr as ExpressionSpecification;
  }

  /**
   * (Re)peint la couche zones via le socle (aucun lot dans la vue Sources —
   * le drill montre les ZONES de la ville, la sémantique lots reste à Signaux).
   * No-op tant que la carte n'est pas prête.
   */
  function updateZoneLayers(): void {
    if (!mapApi) return;
    const zones = zonesResponse?.featureCollection ?? EMPTY_ZONES;
    const el = mapApi.themeElement;
    // Sélection exclusive : décore `isSelected` (exergue orange du socle).
    const zonesForPaint = decorateSelectedFlag(
      decorateZonesWithKindColor(zones, new Set(), el),
      (props) => selectedZoneCode !== null && props.code === selectedZoneCode,
    );
    const zoneNeutralColor = resolveMapColor(
      ZONE_KIND_NEUTRAL.token,
      ZONE_KIND_NEUTRAL.fallback,
      el,
    );
    const lotNeutralColor = resolveMapColor(
      LOT_NEUTRAL_TOKEN,
      LOT_NEUTRAL_FALLBACK,
      el,
    );
    mapApi.syncGeoLayers({
      zones: zonesForPaint,
      lots: EMPTY_LOTS,
      // Parité SignauxMapView.zoneKindFillColorExpression : teinte par kind
      // portée par la propriété décorée `kindColor`, repli neutre.
      zoneFillColor: withHoverNeutralTint(
        ["coalesce", ["get", "kindColor"], lotNeutralColor],
        zoneNeutralColor,
      ),
      zoneFillOpacity: withHoverOpacityBoost(
        buildZoneOpacityExpression(zones.features),
        ZONE_HOVER_MIN_OPACITY,
      ),
      // Couche lots vide : expressions constantes valides (jamais peintes).
      lotFillColor: lotNeutralColor,
      lotFillOpacity: 0,
      lotLineColor: lotNeutralColor,
    });
  }

  function handleMapReady(api: GeoCityMapApi): void {
    mapApi = api;
    // Si une ville était déjà sélectionnée avant que la carte soit prête, le
    // cadrage est parti dans le vide — on cadre maintenant (parité Signaux).
    if (selectedCity) fitCityBounds(selectedCity.citySlug);
    updateZoneLayers();
  }
</script>

<ViewLayout controlsWidth="w-80" selWidth="w-96">
  <!-- ── RAIL gauche : portée (radio exclusif) + liste plate de villes ────── -->
  <svelte:fragment slot="controls">
    {#if error}
      <div class="p-4">
        <Alert tone="error" title="Couverture indisponible" message={error} />
      </div>
    {/if}
    <SourcesRail
      {cities}
      selectedSlug={selectedCity?.citySlug ?? null}
      {loading}
      dataUnavailable={error !== null}
      {scope}
      onScopeChange={handleScopeChange}
      onSelectCity={handleRailSelect}
      onRefresh={onReload}
    />
  </svelte:fragment>

  <!-- ── CANVAS : carte choroplèthe (socle partagé) ────────────────────────── -->
  <!-- La légende est UNIQUE (overlay du socle) : couverture au niveau province,
       zonage quand une ville est drillée. -->
  <GeoCityMapBase
    {fillColorExpression}
    {fillOpacityExpression}
    activeCitySlug={selectedCity?.citySlug ?? null}
    segments={geoSegments}
    {activeSegment}
    onSegmentClick={handleSegmentClick}
    onCityClick={handleCityClick}
    onZoneClick={handleZoneClick}
    {legend}
    onReady={handleMapReady}
  >
    <svelte:fragment slot="overlay-top-left">
      {#if !selectedCity && headline}
        <div
          class="max-w-md rounded border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm"
          data-testid="province-headline"
        >
          <p class="font-semibold text-slate-700">{headlineText}</p>
          {#if headline.cheapZonage > 0}
            <p class="mt-0.5 text-amber-700">
              {headline.cheapZonage} complétion{headline.cheapZonage !== 1 ? "s" : ""} zonage rapide{headline.cheapZonage !== 1 ? "s" : ""}
            </p>
          {/if}
        </div>
      {/if}
      {#if selectedCity && (zonesLoading || zonesError || geoNotices.length > 0)}
        <div class="max-w-sm space-y-1 rounded border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm">
          <!-- Waiter/erreur/notices de la couche zones (parité Signaux). -->
          {#if zonesLoading}
            <p class="m-0 font-semibold text-slate-500">Chargement des zones…</p>
          {/if}
          {#if zonesError}
            <p class="m-0 flex items-center gap-2 text-amber-700">
              <span>Zones indisponibles.</span>
              <button type="button" class="font-semibold underline hover:text-amber-900" on:click={retryZones}>Réessayer</button>
            </p>
          {/if}
          {#each geoNotices as notice (notice)}
            <p class="m-0 text-slate-600">{notice}</p>
          {/each}
        </div>
      {/if}
    </svelte:fragment>
  </GeoCityMapBase>

  <!-- ── DRAWER droit : scorecard couverture de la ville sélectionnée (D6) ── -->
  <svelte:fragment slot="sel">
    {#if selectedCity}
      <SourceScorecard city={selectedCity} {focusScope} onClose={() => clearSelection()} />
    {:else}
      <div class="flex flex-1 items-center justify-center p-6 text-center">
        <div>
          <MapPin class="mx-auto mb-3 h-8 w-8 text-slate-300" aria-hidden="true" />
          <p class="text-sm text-slate-400">
            Cliquez une ville pour voir le détail de sa couverture.
          </p>
          <p class="mt-2 text-xs text-slate-300">
            Vert = servi · ambre = partiel · gris = non couvert.
          </p>
        </div>
      </div>
    {/if}
  </svelte:fragment>
</ViewLayout>
