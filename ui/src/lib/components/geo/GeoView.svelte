<script lang="ts">
  /**
   * GeoView — Vue Géo (G3 WP géo-intégration).
   *
   * Affiche les zones de zonage + lots + opportunités sur une carte GeoMap
   * de @sentropic/geo-ui-svelte (remplace l'implémentation MapLibre bespoke).
   *
   * Sélecteur de ville → charge les FeatureCollections via /api/geo/features/:city.
   * GeoMap reçoit une FeatureCollection unifiée (zones + lots + opportunités).
   * Panneau détail au clic via GeoDetailPanel de la lib.
   * Empty-state FR si aucune donnée.
   *
   * Loi 25 : zonage public, aucune PII.
   * Ne modifie pas SignauxMapView ni EvaluationMapView.
   */
  import { MapPin, RefreshCw, Layers, Info, ChevronDown } from "@lucide/svelte";
  import { GeoMap, GeoDetailPanel } from "@sentropic/geo-ui-svelte";
  import type { GeoFeatureHit } from "@sentropic/geo-ui-svelte";
  import type { FeatureCollection, Feature } from "@sentropic/geo-core";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import {
    fetchGeoCities,
    fetchGeoFeatures,
    type GeoCityInfo,
  } from "./geo-client.js";
  import {
    GEO_CATEGORIES,
    GEO_ZONE_DETAIL_SCHEMA,
    GEO_LOT_DETAIL_SCHEMA,
    GEO_OPPORTUNITE_DETAIL_SCHEMA,
    type GeoDetailSchema,
  } from "./geo-categories.js";

  // ── State global ───────────────────────────────────────────────────────────
  let cities: GeoCityInfo[] = [];
  let citiesLoading = true;
  let citiesError: string | null = null;
  let selectedCity: string = "";

  // Données géo pour la ville sélectionnée
  let zonesCount = 0;
  let lotsCount = 0;
  let oppsCount = 0;
  let dataLoading = false;
  let dataError: string | null = null;

  // FeatureCollection unifiée pour GeoMap
  let unifiedFeatures: FeatureCollection | undefined = undefined;

  // Panneau détail
  let selectedHit: GeoFeatureHit | null = null;
  let selectedSchema: GeoDetailSchema | null = null;

  // ── Chargement villes ──────────────────────────────────────────────────────
  async function loadCities(): Promise<void> {
    citiesLoading = true;
    citiesError = null;
    try {
      const res = await fetchGeoCities();
      cities = res.cities;
      // Pré-sélectionner la première ville avec des zones ou des résolutions
      const first = cities.find((c) => c.zoneCount > 0 || c.signalCount > 0);
      if (first) selectedCity = first.citySlug;
    } catch (e) {
      citiesError = e instanceof Error ? e.message : "Erreur chargement villes";
    } finally {
      citiesLoading = false;
    }
  }

  // ── Chargement données géo ─────────────────────────────────────────────────
  async function loadGeoData(citySlug: string): Promise<void> {
    if (!citySlug) return;
    dataLoading = true;
    dataError = null;
    selectedHit = null;
    selectedSchema = null;
    unifiedFeatures = undefined;
    try {
      const res = await fetchGeoFeatures(citySlug);
      zonesCount = res.zoneCount;
      lotsCount = res.lotCount;
      oppsCount = res.opportuniteCount;

      // Fusionner les 3 collections en une seule FeatureCollection
      // GeoMap rend polygones (zones/lots) + points (opportunités) dans la même couche
      const allFeatures: Feature[] = [
        ...res.zones.features,
        ...res.lots.features,
        ...res.opportunites.features,
      ] as Feature[];

      if (allFeatures.length > 0) {
        unifiedFeatures = {
          type: "FeatureCollection",
          features: allFeatures,
        };
      } else {
        unifiedFeatures = undefined;
      }
    } catch (e) {
      dataError = e instanceof Error ? e.message : "Erreur chargement données géo";
      zonesCount = 0;
      lotsCount = 0;
      oppsCount = 0;
      unifiedFeatures = undefined;
    } finally {
      dataLoading = false;
    }
  }

  // ── Gestionnaire sélection feature ────────────────────────────────────────
  function handleSelect(hit: GeoFeatureHit): void {
    selectedHit = hit;
    // Choisir le bon schéma selon featureKind
    const kind = hit.properties["featureKind"];
    if (kind === "lot") {
      selectedSchema = GEO_LOT_DETAIL_SCHEMA;
    } else if (kind === "opportunite" || kind === "signal") {
      selectedSchema = GEO_OPPORTUNITE_DETAIL_SCHEMA;
    } else {
      // zone par défaut
      selectedSchema = GEO_ZONE_DETAIL_SCHEMA;
    }
  }

  // ── Réactivité ville sélectionnée ─────────────────────────────────────────
  $: if (selectedCity) {
    void loadGeoData(selectedCity);
  }

  // ── Cycle de vie ──────────────────────────────────────────────────────────
  import { onMount } from "svelte";
  onMount(async () => {
    await loadCities();
  });

  // ── Helpers UI ─────────────────────────────────────────────────────────────
  function cityLabel(slug: string): string {
    return slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("-");
  }

  // ── Titre panneau selon featureKind ───────────────────────────────────────
  function detailTitleFr(hit: GeoFeatureHit | null): string {
    if (!hit) return "Détail";
    const kind = hit.properties["featureKind"];
    if (kind === "lot") return "Lot cadastral";
    if (kind === "opportunite" || kind === "signal") return "Opportunité";
    return "Zone de zonage";
  }
</script>

<ViewLayout controlsWidth="w-72" stickyControlsFooter>
  <!-- Bande de contrôles gauche -->
  <svelte:fragment slot="controls">
    <div class="flex flex-col gap-4 p-4">
      <div class="flex items-center gap-2">
        <Layers class="h-4 w-4 text-teal-600 shrink-0" aria-hidden="true" />
        <span class="text-sm font-semibold text-slate-800">Vue Géo</span>
      </div>

      <!-- Sélecteur de ville -->
      <div>
        <label for="geo-city-select" class="mb-1 block text-xs font-medium text-slate-600">
          Municipalité
        </label>
        {#if citiesLoading}
          <div class="flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw class="h-3 w-3 animate-spin" aria-hidden="true" />
            Chargement...
          </div>
        {:else if citiesError}
          <p class="text-xs text-red-500">{citiesError}</p>
        {:else if cities.length === 0}
          <p class="text-xs text-slate-400 italic">
            Aucune ville avec données géo disponibles.
          </p>
        {:else}
          <div class="relative">
            <select
              id="geo-city-select"
              bind:value={selectedCity}
              class="w-full appearance-none rounded-md border border-slate-200 bg-white py-2 pl-3 pr-8 text-sm text-slate-800 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="" disabled>Choisir une ville…</option>
              {#each cities as city}
                <option value={city.citySlug}>
                  {cityLabel(city.citySlug)}
                  {#if city.zoneCount > 0}
                    ({city.zoneCount} zones)
                  {:else if city.signalCount > 0}
                    ({city.signalCount} signaux)
                  {/if}
                </option>
              {/each}
            </select>
            <ChevronDown
              class="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
          </div>
        {/if}
      </div>

      <!-- Compteurs données -->
      {#if selectedCity && !dataLoading}
        <div class="rounded-md border border-slate-100 bg-slate-50 p-3 text-xs">
          <p class="mb-2 font-medium text-slate-700">Données chargées</p>
          <div class="space-y-1">
            <div class="flex justify-between">
              <span class="text-slate-500">Zones</span>
              <span class="font-semibold text-slate-800">{zonesCount}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Lots</span>
              <span class="font-semibold text-slate-800">{lotsCount}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Opportunités</span>
              <span class="font-semibold text-slate-800">{oppsCount}</span>
            </div>
          </div>
          {#if zonesCount === 0 && lotsCount === 0 && oppsCount === 0}
            <p class="mt-2 text-slate-400 italic text-xs">
              Aucune donnée géoréférencée pour cette ville.
            </p>
          {/if}
        </div>
      {:else if dataLoading}
        <div class="flex items-center gap-2 text-xs text-slate-500">
          <RefreshCw class="h-3 w-3 animate-spin" aria-hidden="true" />
          Chargement…
        </div>
      {/if}

      {#if dataError}
        <p class="rounded-md bg-red-50 p-2 text-xs text-red-600">{dataError}</p>
      {/if}

      <!-- Panneau détail (dans la colonne contrôles) -->
      {#if selectedHit && selectedSchema}
        <div class="mt-2">
          <GeoDetailPanel
            feature={selectedHit}
            schema={selectedSchema}
            titleFr={detailTitleFr(selectedHit)}
          />
          <p class="mt-2 text-xs text-slate-400 italic">
            Données de zonage publiques — aucune PII (Loi 25).
          </p>
        </div>
      {/if}
    </div>
  </svelte:fragment>

  <!-- Zone principale : carte GeoMap -->
  <div class="relative flex h-full flex-1 overflow-hidden">
    {#if dataLoading}
      <div class="flex h-full w-full items-center justify-center text-slate-400 text-sm bg-slate-100">
        <RefreshCw class="h-5 w-5 animate-spin mr-2" aria-hidden="true" />
        Chargement des données géo…
      </div>
    {:else if !selectedCity && !citiesLoading}
      <!-- Empty-state si pas de ville sélectionnée -->
      <div class="flex h-full w-full items-center justify-center bg-slate-100">
        <div class="max-w-sm rounded-xl border border-slate-200 bg-white/90 p-6 shadow-lg text-center">
          <MapPin class="mx-auto mb-3 h-8 w-8 text-teal-500" aria-hidden="true" />
          <p class="text-sm font-semibold text-slate-800 mb-1">Aucune ville sélectionnée</p>
          {#if cities.length === 0}
            <p class="text-xs text-slate-500">
              Aucune donnée géoréférencée n'est encore disponible.<br />
              Les zones et lots seront affichés dès que le pipeline
              d'acquisition géo aura peuplé la base.
            </p>
          {:else}
            <p class="text-xs text-slate-500">
              Sélectionnez une municipalité dans le panneau de gauche
              pour afficher les zones, lots et opportunités.
            </p>
          {/if}
        </div>
      </div>
    {:else}
      <!-- GeoMap avec la FeatureCollection unifiée -->
      <div class="flex-1 h-full">
        <GeoMap
          data={unifiedFeatures}
          layerKind="choropleth"
          categories={GEO_CATEGORIES}
          categoryKey="category"
          legend={true}
          legendPosition="bottom-left"
          fitBounds={true}
          height="100%"
          labelFr="Carte des zones, lots et opportunités"
          onSelect={handleSelect}
        />
      </div>

      <!-- Empty-state si ville sélectionnée mais aucune donnée -->
      {#if selectedCity && !dataLoading && zonesCount === 0 && lotsCount === 0 && oppsCount === 0 && !dataError}
        <div class="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
          <div class="pointer-events-auto rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 shadow text-center">
            <Info class="mx-auto mb-1 h-5 w-5 text-amber-500" aria-hidden="true" />
            <p class="text-xs font-medium text-amber-800">
              Aucune donnée géo disponible pour {cityLabel(selectedCity)}.
            </p>
            <p class="text-xs text-amber-700 mt-0.5">
              La couche de zonage vectorielle n'a pas encore été acquise pour cette ville.
            </p>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</ViewLayout>
