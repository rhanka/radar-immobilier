<script lang="ts">
  /**
   * SourceCoverageMap — onglet « Couverture » de la vue Source.
   *
   * Carte choroplèthe qualité de données sur le socle partagé GeoCityMapBase :
   *  - couleur = PIRE statut honnête par ville (D2 : verified/declared/absent,
   *    jamais un score 0-100, jamais de vert fabriqué) ;
   *  - périmètre province 1104 + surbrillance focus-30 (D3, toggle de segments) ;
   *  - headline province en overlay (D7) + insight « complétions cheap » ;
   *  - clic ville → scorecard tri-état L1/L2/L4/L5 (D6) dans le panneau droit ;
   *  - légende 3 états (overlay du socle).
   *
   * La VUE ne porte que les données + expressions métier ; toute la mécanique
   * carto (MapLibre, drill, caméra) vit dans le socle (NE PAS le ré-altérer).
   */
  import { Alert, Badge } from "@sentropic/design-system-svelte";
  import { MapPin, RefreshCw } from "@lucide/svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import GeoCityMapBase, {
    type GeoCityMapApi,
    type GeoSegment,
    type GeoMapLegend,
  } from "$lib/components/maps/GeoCityMapBase.svelte";
  import SourceScorecard from "./SourceScorecard.svelte";
  import {
    buildFillColorExpression,
    buildFocusOpacityExpression,
    buildProvinceHeadline,
    formatProvinceHeadline,
    STATE_COLOR,
    STATE_LABEL,
    type CityCoverage,
    type CoverageResponse,
  } from "$lib/sources/source-coverage-client.js";
  import { geometryBounds } from "$lib/maps/geometry-bounds.js";
  import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

  export let cities: CityCoverage[] = [];
  export let response: CoverageResponse | null = null;
  export let loading = false;
  export let error: string | null = null;
  export let onReload: () => void = () => {};

  // ── Carte (socle) ──────────────────────────────────────────────────────────
  let mapApi: GeoCityMapApi | null = null;

  // ── Focus-30 : highlight visuel (pas un recompute, D3) ─────────────────────
  const SEG_PROVINCE = "Province (1104)";
  const SEG_FOCUS = "Focus 30";
  let focusOnly = false;
  $: geoSegments = [{ label: SEG_PROVINCE }, { label: SEG_FOCUS }] as GeoSegment[];
  $: activeSegment = focusOnly ? SEG_FOCUS : SEG_PROVINCE;
  function handleSegmentClick(label: string): void {
    focusOnly = label === SEG_FOCUS;
  }

  // ── Expressions choroplèthe (couleur = pire statut, opacité = focus) ───────
  $: fillColorExpression = buildFillColorExpression(cities);
  $: fillOpacityExpression = buildFocusOpacityExpression(
    cities,
    focusOnly,
  ) as ExpressionSpecification | number;

  // ── Légende 3 états (overlay socle) ────────────────────────────────────────
  const legend: GeoMapLegend = {
    title: "Pire statut honnête",
    items: [
      { color: STATE_COLOR.verified, label: STATE_LABEL.verified },
      { color: STATE_COLOR.declared, label: STATE_LABEL.declared },
      { color: STATE_COLOR.absent, label: `${STATE_LABEL.absent} / inconnu` },
    ],
  };

  // ── Headline province (D7) ─────────────────────────────────────────────────
  $: headline = response ? buildProvinceHeadline(response) : null;
  $: headlineText = response ? formatProvinceHeadline(response.totals) : "";

  // ── Sélection ville → scorecard ────────────────────────────────────────────
  let selectedCity: CityCoverage | null = null;
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
      l4Zonage: { state: "absent", served: false, freshness: "unknown" },
      l5Lots: { state: "absent", served: false, freshness: "unknown" },
      worstStatus: "absent",
      nextMarginalGain: null,
    };
  }

  function handleCityClick(slug: string): void {
    selectedCity = cityBySlug.get(slug) ?? syntheticAbsentCity(slug);
    // Cadrage caméra sur le contour de la ville (parité Signaux). Repli : si le
    // contour n'est pas en cache (géométrie absente), on ne force pas la caméra.
    const boundary = mapApi?.getCityBoundary(slug) ?? null;
    const bounds = geometryBounds(boundary);
    if (bounds) mapApi?.fitMapToBounds(bounds, { maxZoom: 11 });
  }

  function handleMapReady(api: GeoCityMapApi): void {
    mapApi = api;
  }
</script>

<ViewLayout controlsWidth="w-72" stickyControlsFooter selWidth="w-96">
  <!-- ── Bande gauche : titre + insight actionnable ────────────────────────── -->
  <svelte:fragment slot="controls">
    <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <h1 class="flex items-center gap-2 text-sm font-bold text-slate-900">
        <MapPin class="h-4 w-4 text-teal-600" aria-hidden="true" />
        Couverture qualité
      </h1>
      <button
        type="button"
        aria-label="Actualiser"
        class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        on:click={onReload}
        disabled={loading}
      >
        <RefreshCw class={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
      </button>
    </div>

    {#if error}
      <div class="p-4">
        <Alert tone="error" title="Couverture indisponible" message={error} />
      </div>
    {:else if loading}
      <div class="p-4 text-sm text-slate-400">Chargement de la couverture…</div>
    {:else if headline}
      <div class="space-y-3 p-4" data-testid="coverage-insight">
        <div class="rounded-lg border border-teal-100 bg-teal-50 px-3 py-2.5">
          <p class="text-xs font-semibold uppercase tracking-wide text-teal-600">
            Province ({headline.cities} villes)
          </p>
          <ul class="mt-1.5 space-y-1 text-sm text-teal-900">
            <li><span class="font-bold tabular-nums">{headline.l2Graph}</span>/{headline.cities} graphés</li>
            <li><span class="font-bold tabular-nums">{headline.l4Zonage}</span>/{headline.cities} zonage servi</li>
            <li><span class="font-bold tabular-nums">{headline.l5Lots}</span>/{headline.cities} lots servis</li>
          </ul>
        </div>

        {#if headline.cheapZonage > 0}
          <div class="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5" data-testid="cheap-completions">
            <p class="text-xs text-amber-800">
              <span class="font-bold tabular-nums">{headline.cheapZonage}</span>
              ville{headline.cheapZonage !== 1 ? "s" : ""} graphée{headline.cheapZonage !== 1 ? "s" : ""}
              sans zonage servi — complétions « cheap » à portée.
            </p>
          </div>
        {/if}

        <p class="text-xs text-slate-400">
          Cliquez une ville pour le détail tri-état (L1 raw · L2 graphe · L4 zonage · L5 lots).
        </p>
      </div>
    {/if}
  </svelte:fragment>

  <!-- Légende épinglée en bas de la bande -->
  <svelte:fragment slot="controls-footer">
    <div class="p-4">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Légende — pire statut honnête
      </p>
      <ul class="space-y-1">
        {#each legend.items as item (item.label)}
          <li class="flex items-center gap-2 text-xs text-slate-600">
            <span
              class="h-3 w-3 shrink-0 rounded-sm border border-slate-300"
              style="background-color: {item.color};"
            ></span>
            {item.label}
          </li>
        {/each}
      </ul>
    </div>
  </svelte:fragment>

  <!-- ── Canvas : carte choroplèthe (socle) ───────────────────────────────── -->
  <GeoCityMapBase
    {fillColorExpression}
    {fillOpacityExpression}
    activeCitySlug={selectedCity?.citySlug ?? null}
    segments={geoSegments}
    {activeSegment}
    onSegmentClick={handleSegmentClick}
    onCityClick={handleCityClick}
    {legend}
    onReady={handleMapReady}
  >
    <svelte:fragment slot="overlay-top-left">
      {#if headline}
        <div
          class="max-w-md rounded border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm"
          data-testid="province-headline"
        >
          <p class="font-semibold text-slate-700">{headlineText}</p>
          {#if headline.cheapZonage > 0}
            <p class="mt-0.5 text-amber-700">
              {headline.cheapZonage} complétion{headline.cheapZonage !== 1 ? "s" : ""} zonage « cheap »
            </p>
          {/if}
        </div>
      {/if}
    </svelte:fragment>
  </GeoCityMapBase>

  <!-- ── Panneau droit : scorecard de la ville cliquée (D6) ────────────────── -->
  <svelte:fragment slot="sel">
    {#if selectedCity}
      <SourceScorecard city={selectedCity} onClose={() => { selectedCity = null; }} />
    {:else}
      <div class="flex flex-1 items-center justify-center p-6 text-center">
        <div>
          <MapPin class="mx-auto mb-3 h-8 w-8 text-slate-300" aria-hidden="true" />
          <p class="text-sm text-slate-400">
            Cliquez une ville pour voir sa scorecard qualité (tri-état honnête).
          </p>
          <p class="mt-2 text-xs text-slate-300">
            Vert = vérifié live · ambre = déclaré non substantié · gris = absent.
          </p>
        </div>
      </div>
    {/if}
  </svelte:fragment>
</ViewLayout>
