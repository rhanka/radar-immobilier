<script lang="ts">
  /**
   * SignauxMapView — Vue Signaux (maille Québec→villes).
   *
   * Carte du Québec avec les villes prioritisées (QC_MUNICIPALITIES / prioritizedCities).
   * Chaque ville est représentée par un point coloré selon son compteur de signaux
   * de changements de zonage sur 6 mois. Clic ville → liste des signaux.
   *
   * Source des données : GET /api/signals/by-city — compte les DesignationEvent
   * canonicaux de l'état projet ontologie (résultats exploitation réels).
   *
   * Anti-invention: seules les villes avec un état projet récent (< 6 mois) ont un
   * compteur > 0. Toutes les autres villes affichent 0. Aucun signal n'est inventé.
   *
   * Carte: SVG pur (pas de lib externe). Les coordonnées WGS-84 sont projetées en
   * espace SVG via une projection équirectangulaire simple — suffisant pour la région
   * Québec (biais de distorsion acceptable à ces latitudes pour un usage de démo).
   * Choix justifié: tree-shakeable (0 ko supplémentaire), pas de dépendance réseau,
   * et la distorsion reste acceptable sur la zone 44°–63° N.
   */
  import { onMount } from "svelte";
  import { Map as MapIcon, Radio, RefreshCw } from "@lucide/svelte";
  import { Badge, Alert } from "@sentropic/design-system-svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import {
    buildCityMapEntries,
    computeBbox,
    projectToSvg,
    signalCountTier,
    PILOT_CITY_SLUG,
    type CityMapEntry,
  } from "$lib/maps/maps-data.js";
  import {
    fetchSignalsByCity,
    type SignalCityItem,
  } from "$lib/signals/signals-by-city-client.js";

  // ── State ──────────────────────────────────────────────────────────────────
  let selectedCity: CityMapEntry | null = null;
  let loading = true;
  let loadError: string | null = null;
  let apiItems: SignalCityItem[] = [];

  // ── Données réactives ──────────────────────────────────────────────────────
  // Rebuilt whenever apiItems changes (after fetch).
  $: allEntries = buildCityMapEntries(apiItems);
  // Limit displayed cities to the top 80 (closest to MTL) to keep SVG readable
  $: mapEntries = allEntries.slice(0, 80);
  $: allMunis = mapEntries.map((e) => e.municipality);

  // ── Projection SVG ─────────────────────────────────────────────────────────
  const SVG_W = 700;
  const SVG_H = 480;
  $: bbox = computeBbox(allMunis);

  function toSvg(lon: number, lat: number, currentBbox: ReturnType<typeof computeBbox>): { x: number; y: number } {
    return projectToSvg(lon, lat, currentBbox, SVG_W, SVG_H);
  }

  // ── Compteurs globaux ──────────────────────────────────────────────────────
  $: totalSignals = allEntries.reduce((s, e) => s + e.signalCount6m, 0);
  $: citiesWithSignals = allEntries.filter((e) => e.signalCount6m > 0).length;

  // ── Ville sélectionnée ─────────────────────────────────────────────────────
  function selectCity(entry: CityMapEntry): void {
    selectedCity = selectedCity?.municipality.slug === entry.municipality.slug
      ? null
      : entry;
  }

  // ── Aperçu de ville dans la liste (hover) ─────────────────────────────────
  let hoveredSlug: string | null = null;

  // ── Chargement API ─────────────────────────────────────────────────────────
  async function load() {
    loading = true;
    loadError = null;
    try {
      const res = await fetchSignalsByCity();
      apiItems = res.items;
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Erreur de chargement";
      // Keep apiItems empty → all cities show 0 (honest placeholder).
      apiItems = [];
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<ViewLayout controlsWidth="w-80">
  <!-- ── Left sidebar: city list ───────────────────────────────────────────── -->
  <svelte:fragment slot="controls">
    <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <h1 class="flex items-center gap-2 text-sm font-bold text-slate-900">
        <Radio class="h-4 w-4 text-teal-600" aria-hidden="true" />
        Signaux : Villes
      </h1>
      <div class="flex items-center gap-2">
        <span class="text-xs text-slate-400">6 mois</span>
        <button
          type="button"
          aria-label="Actualiser"
          class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          on:click={load}
          disabled={loading}
        >
          <RefreshCw
            class={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>

    {#if loadError}
      <div class="px-4 py-2 text-xs text-red-600">
        {loadError} (compteurs affichés à 0, données indisponibles)
      </div>
    {/if}

    <!-- Compteur global -->
    <div class="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
      {#if loading}
        <span class="text-slate-400">Chargement…</span>
      {:else}
        <span class="font-semibold text-slate-700">{totalSignals}</span> signal{totalSignals !== 1 ? "s" : ""} ·
        <span class="font-semibold text-slate-700">{citiesWithSignals}</span> ville{citiesWithSignals !== 1 ? "s" : ""}
      {/if}
    </div>

    <!-- Liste des villes avec signaux (en premier), puis les autres -->
    <ul class="divide-y divide-slate-100 overflow-y-auto" style="max-height: calc(100vh - 180px);">
      {#each allEntries.slice(0, 40) as entry (entry.municipality.slug)}
        {@const tier = signalCountTier(entry.signalCount6m)}
        {@const isSelected = selectedCity?.municipality.slug === entry.municipality.slug}
        <li>
          <button
            type="button"
            class={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
              isSelected ? "bg-teal-50" : "hover:bg-slate-50"
            }`}
            on:click={() => selectCity(entry)}
            on:mouseenter={() => { hoveredSlug = entry.municipality.slug; }}
            on:mouseleave={() => { hoveredSlug = null; }}
          >
            <!-- Dot couleur signal -->
            <span
              class={`h-2.5 w-2.5 shrink-0 rounded-full ${
                entry.signalCount6m > 0 ? "bg-teal-500" : "bg-slate-200"
              }`}
              aria-hidden="true"
            ></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-slate-900">
                {entry.municipality.name}
              </span>
              {#if entry.municipality.mrc}
                <span class="block truncate text-xs text-slate-400">{entry.municipality.mrc}</span>
              {/if}
            </span>
            {#if entry.signalCount6m > 0}
              <Badge tone="warning" class="shrink-0 text-xs">
                {entry.signalCount6m}
              </Badge>
            {:else}
              <span class="text-xs text-slate-300">0</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>

    <!-- Légende -->
    <div class="border-t border-slate-100 p-4">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Légende</p>
      <ul class="space-y-1">
        {#each [
          { cls: "bg-red-500", label: "6+ signaux" },
          { cls: "bg-orange-500", label: "3–5 signaux" },
          { cls: "bg-amber-400", label: "1–2 signaux" },
          { cls: "bg-slate-200", label: "Aucun signal (0)" },
        ] as item (item.label)}
          <li class="flex items-center gap-2 text-xs text-slate-600">
            <span class={`h-2.5 w-2.5 rounded-full ${item.cls}`}></span>
            {item.label}
          </li>
        {/each}
      </ul>
    </div>
  </svelte:fragment>

  <!-- ── Main: carte SVG + détail ville ────────────────────────────────────── -->
  <div class="flex h-full flex-col bg-slate-50 p-4 gap-4">
    <!-- Carte SVG -->
    <div class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div class="border-b border-slate-100 px-4 py-2 flex items-center justify-between">
        <span class="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Québec, villes prioritisées (80 plus proches de MTL)
        </span>
        <span class="text-xs text-slate-400">
          {loading ? "chargement…" : "DesignationEvent ontologie · GeoNames CC-BY"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        aria-label="Carte des villes du Québec avec compteurs de signaux de changements de zonage"
        role="img"
        class="block"
        style="max-height: 400px;"
      >
        <!-- Fond de carte -->
        <rect width={SVG_W} height={SVG_H} class="fill-blue-50" rx="2" />

        <!-- Points de villes -->
        {#each mapEntries as entry (entry.municipality.slug)}
          {@const pos = toSvg(entry.municipality.lon, entry.municipality.lat, bbox)}
          {@const tier = signalCountTier(entry.signalCount6m)}
          {@const isSelected = selectedCity?.municipality.slug === entry.municipality.slug}
          {@const isHovered = hoveredSlug === entry.municipality.slug}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <g
            class="cursor-pointer"
            on:click={() => selectCity(entry)}
            on:mouseenter={() => { hoveredSlug = entry.municipality.slug; }}
            on:mouseleave={() => { hoveredSlug = null; }}
            role="button"
            aria-label="{entry.municipality.name} : {entry.signalCount6m} signal(s)"
            tabindex="0"
          >
            <!-- Anneau de sélection -->
            {#if isSelected || isHovered}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={isSelected ? 10 : 8}
                class={isSelected ? "fill-teal-500 opacity-20" : "fill-slate-400 opacity-10"}
              />
            {/if}
            <!-- Point principal -->
            <circle
              cx={pos.x}
              cy={pos.y}
              r={entry.signalCount6m > 0 ? (isSelected ? 7 : 5) : (isSelected ? 5 : 3)}
              class={`${tier.fill} transition-all`}
              stroke={isSelected ? "#0d9488" : "white"}
              stroke-width={isSelected ? "2" : "0.5"}
            />
            <!-- Label ville pilote toujours visible -->
            {#if entry.municipality.slug === PILOT_CITY_SLUG}
              <text
                x={pos.x + 8}
                y={pos.y + 4}
                class="fill-teal-700 font-semibold"
                style="font-size: 12px; font-weight: 600;"
              >
                {entry.municipality.name}
              </text>
            {:else if isSelected || isHovered}
              <text
                x={pos.x + 7}
                y={pos.y + 3}
                class="fill-slate-700"
                style="font-size: 12px;"
              >
                {entry.municipality.name}
              </text>
            {/if}
          </g>
        {/each}
      </svg>
    </div>

    <!-- Détail ville sélectionnée -->
    {#if selectedCity}
      <div class="rounded-xl border border-teal-200 bg-white shadow-sm p-4">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <h2 class="text-base font-semibold text-slate-900">
              {selectedCity.municipality.name}
            </h2>
            {#if selectedCity.municipality.mrc}
              <p class="text-xs text-slate-400 mt-0.5">MRC : {selectedCity.municipality.mrc}</p>
            {/if}
          </div>
          <button
            type="button"
            class="text-xs text-slate-400 hover:text-slate-600"
            on:click={() => { selectedCity = null; }}
            aria-label="Fermer le détail"
          >✕</button>
        </div>

        {#if selectedCity.signalCount6m === 0}
          <Alert
            tone="info"
            title="Aucun signal disponible pour cette ville."
            message="Les signaux de changements de zonage sont dérivés des DesignationEvent de l'état projet ontologie. Cette ville n'a pas encore de données recueillies ou son état projet date de plus de 6 mois."
          />
        {:else}
          <div class="rounded-lg border border-teal-100 bg-teal-50 px-4 py-3">
            <p class="text-sm font-semibold text-teal-800">
              {selectedCity.signalCount6m} DesignationEvent{selectedCity.signalCount6m > 1 ? "s" : ""} (6 mois)
            </p>
            <p class="mt-1 text-xs text-teal-600">
              Changements de zonage détectés depuis l'état projet ontologie.
              Consultez la vue <em>Ontologie</em> pour le détail des entités canoniques.
            </p>
          </div>
        {/if}
      </div>
    {:else}
      <div class="flex flex-1 items-center justify-center rounded-xl border border-slate-100 bg-white p-6 text-center">
        <div>
          <MapIcon class="mx-auto mb-3 h-8 w-8 text-slate-300" aria-hidden="true" />
          <p class="text-sm text-slate-400">
            Cliquez sur une ville pour voir ses signaux de changements de zonage.
          </p>
          <p class="mt-1 text-xs text-slate-300">
            Données réelles : DesignationEvent de l'état projet ontologie.
          </p>
        </div>
      </div>
    {/if}
  </div>
</ViewLayout>
