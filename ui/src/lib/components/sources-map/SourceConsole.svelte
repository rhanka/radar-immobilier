<script lang="ts">
  /**
   * SourceConsole — onglet « Console » de la vue Source, RECONSTRUIT sur le VRAI
   * endpoint /api/source/coverage (l'ancienne Console est supprimée).
   *
   * Table tri-état par ville, une colonne par COUCHE RÉELLE (PV · Signaux ·
   * Zones · Normes (grilles) · Lots (cadastre) · TOD · Couverture), triée pires
   * statuts d'abord (l'action en tête), filtrable par statut, avec scorecard
   * détaillée au clic. Honnête de bout en bout : aucune couche n'est
   * « verified » sans preuve live ; une ville sans couverture reste « absent »
   * (Normes et TOD sont éparses aujourd'hui → « Non couvert » majoritaire).
   */
  import { Alert, Badge } from "@sentropic/design-system-svelte";
  import { Terminal, RefreshCw, Search } from "@lucide/svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import SourceScorecard from "./SourceScorecard.svelte";
  import {
    sortCitiesForConsole,
    formatProvinceHeadline,
    buildProvinceHeadline,
    computeFocusScope,
    isFocusCity,
    STATE_COLOR,
    STATE_LABEL,
    STATE_BADGE_TONE,
    type CityCoverage,
    type CoverageResponse,
    type CoverageState,
  } from "$lib/sources/source-coverage-client.js";

  export let cities: CityCoverage[] = [];
  export let response: CoverageResponse | null = null;
  export let loading = false;
  export let error: string | null = null;
  export let onReload: () => void = () => {};

  type Filter = "actives" | "all" | CoverageState;
  let filter: Filter = "actives";
  let query = "";
  let selectedCity: CityCoverage | null = null;

  // ── Périmètre : Province / Focus 30 (parité onglet « Couverture ») ─────────
  // Mêmes intitulés que le toggle de la carte Couverture ; même critère
  // (`computeFocusScope` : les 30 villes À SIGNAUX, classées par nombre de
  // signaux — plus jamais priorityRank ≤ 30) — ici c'est un FILTRE de lignes
  // (la carte, elle, atténue sans filtrer). Défaut : Province, comme la carte.
  const SEG_PROVINCE = "Province (1104)";
  const SEG_FOCUS = "Focus 30";
  const SEGMENTS = [SEG_PROVINCE, SEG_FOCUS] as const;
  let focusOnly = false;
  $: activeSegment = focusOnly ? SEG_FOCUS : SEG_PROVINCE;
  $: focusScope = computeFocusScope(cities);

  const FILTERS: { value: Filter; label: string }[] = [
    { value: "actives", label: "Actives" },
    { value: "all", label: "Toutes" },
    { value: "verified", label: "Servies" },
    { value: "declared", label: "Partielles" },
    { value: "absent", label: "Non couvertes" },
  ];

  /** Une ville est « active » si au moins une couche n'est pas absent. */
  function isActive(c: CityCoverage): boolean {
    return (
      c.l1Raw.state !== "absent" ||
      c.l2Graph.state !== "absent" ||
      c.signals.state !== "absent" ||
      c.l4Zonage.state !== "absent" ||
      c.normes.state !== "absent" ||
      c.l5Lots.state !== "absent" ||
      c.tod.state !== "absent"
    );
  }

  $: headline = response ? buildProvinceHeadline(response) : null;
  $: headlineText = response ? formatProvinceHeadline(response.totals) : "";

  $: sorted = sortCitiesForConsole(cities);
  $: filtered = sorted.filter((c) => {
    // Périmètre Focus 30 (villes à signaux) : EN PLUS des filtres statut + recherche.
    if (focusOnly && !isFocusCity(c, focusScope)) return false;
    if (filter === "actives") {
      if (!isActive(c)) return false;
    } else if (filter !== "all" && c.worstStatus !== filter) {
      return false;
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      if (
        !c.cityName.toLowerCase().includes(q) &&
        !c.citySlug.toLowerCase().includes(q) &&
        !(c.mrc ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  // Couches affichées en mini-cellules : une colonne = une COUCHE RÉELLE, dans
  // l'ordre PV · Signaux · Zones · Normes (grilles) · Lots (cadastre) · TOD
  // (copy client neutre — pas de jargon interne L1/L2/…).
  function layerStates(c: CityCoverage): { key: string; label: string; state: CoverageState }[] {
    return [
      { key: "pv", label: "PV collectés", state: c.l1Raw.state },
      { key: "signaux", label: "Signaux extraits", state: c.signals.state },
      { key: "zones", label: "Zones servies", state: c.l4Zonage.state },
      { key: "normes", label: "Normes (grilles de zonage)", state: c.normes.state },
      { key: "lots", label: "Lots (cadastre)", state: c.l5Lots.state },
      { key: "tod", label: "Périmètres TOD", state: c.tod.state },
    ];
  }
</script>

<ViewLayout controlsWidth="w-72" selWidth="w-96">
  <!-- ── Bande gauche : totaux + filtres ──────────────────────────────────── -->
  <svelte:fragment slot="controls">
    <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <h1 class="flex items-center gap-2 text-sm font-bold text-slate-900">
        <Terminal class="h-4 w-4 text-teal-600" aria-hidden="true" />
        Console sources
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

    {#if headline}
      <div class="border-b border-slate-100 px-4 py-3" data-testid="console-totals">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Province ({headline.cities})
        </p>
        <p class="mt-1 text-sm text-slate-700">
          <span class="font-bold tabular-nums">{headline.l2Graph}</span> graphés ·
          <span class="font-bold tabular-nums">{headline.l4Zonage}</span> zonage ·
          <span class="font-bold tabular-nums">{headline.l5Lots}</span> lots
        </p>
      </div>
    {/if}

    <!-- Périmètre Province / Focus 30 — même control segmenté que la carte
         Couverture (intitulés et style identiques), mais en FILTRE de lignes. -->
    <div class="border-b border-slate-100 px-4 py-3">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Périmètre</p>
      <div
        class="inline-flex w-fit overflow-hidden rounded border border-slate-200 bg-white text-xs shadow-sm"
        role="group"
        aria-label="Périmètre des villes listées"
        data-testid="console-scope"
      >
        {#each SEGMENTS as seg (seg)}
          <button
            type="button"
            class={`px-2.5 py-1 font-semibold transition-colors ${
              activeSegment === seg
                ? "bg-slate-900 text-white"
                : "cursor-pointer text-slate-600 hover:bg-slate-100"
            }`}
            aria-pressed={activeSegment === seg}
            on:click={() => { focusOnly = seg === SEG_FOCUS; }}
          >
            {seg}
          </button>
        {/each}
      </div>
    </div>

    <div class="px-4 py-3">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Filtrer</p>
      <div class="flex flex-wrap gap-1.5">
        {#each FILTERS as f (f.value)}
          <button
            type="button"
            class={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              filter === f.value
                ? "border-teal-300 bg-teal-50 font-semibold text-teal-800"
                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
            }`}
            on:click={() => { filter = f.value; }}
            aria-pressed={filter === f.value}
          >
            {f.label}
          </button>
        {/each}
      </div>
    </div>
  </svelte:fragment>

  <!-- ── Main : table tri-état par ville ──────────────────────────────────── -->
  <div class="flex h-full flex-col bg-slate-50">
    {#if error}
      <div class="p-4">
        <Alert tone="error" title="Console indisponible" message={error} />
      </div>
    {:else if loading}
      <div class="p-6 text-sm text-slate-400">Chargement de la couverture…</div>
    {:else}
      <div class="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <Search class="h-4 w-4 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          placeholder="Rechercher une ville / MRC…"
          bind:value={query}
          class="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-300"
        />
        <span class="shrink-0 text-xs text-slate-400" data-testid="console-count">
          {filtered.length} ville{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <table class="w-full text-xs">
          <thead class="sticky top-0 z-10 bg-slate-100 text-slate-500">
            <tr>
              <th class="px-4 py-2 text-left font-semibold uppercase tracking-wide">Ville</th>
              <th class="px-2 py-2 text-center font-semibold uppercase tracking-wide" title="Procès-verbaux et documents collectés">PV</th>
              <th class="px-2 py-2 text-center font-semibold uppercase tracking-wide" title="Signaux extraits">Signaux</th>
              <th class="px-2 py-2 text-center font-semibold uppercase tracking-wide" title="Zones de zonage servies">Zones</th>
              <th class="px-2 py-2 text-center font-semibold uppercase tracking-wide" title="Normes (grilles de zonage)">Normes (grilles)</th>
              <th class="px-2 py-2 text-center font-semibold uppercase tracking-wide" title="Lots (cadastre) servis">Lots (cadastre)</th>
              <th class="px-2 py-2 text-center font-semibold uppercase tracking-wide" title="Périmètres TOD servis">TOD</th>
              <th class="px-4 py-2 text-left font-semibold uppercase tracking-wide">Couverture</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white">
            {#each filtered as city (city.citySlug)}
              {@const isSelected = selectedCity?.citySlug === city.citySlug}
              <tr
                class={`cursor-pointer transition-colors ${isSelected ? "bg-teal-50" : "hover:bg-slate-50"}`}
                on:click={() => { selectedCity = isSelected ? null : city; }}
              >
                <td class="px-4 py-2">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-slate-800">{city.cityName}</span>
                    {#if isFocusCity(city, focusScope)}
                      <!-- Rang par NOMBRE DE SIGNAUX (critère focus), pas la proximité. -->
                      <Badge tone="info" class="text-[10px]">#{focusScope.rankBySlug.get(city.citySlug)}</Badge>
                    {/if}
                  </div>
                  {#if city.mrc}
                    <span class="text-slate-400">{city.mrc}</span>
                  {/if}
                </td>
                {#each layerStates(city) as layer (layer.key)}
                  <td class="px-2 py-2 text-center">
                    <span
                      class="inline-block h-3 w-3 rounded-sm border border-slate-300 align-middle"
                      style="background-color: {STATE_COLOR[layer.state]};"
                      title={`${layer.label} : ${STATE_LABEL[layer.state]}`}
                      aria-label={`${layer.label} : ${STATE_LABEL[layer.state]}`}
                    ></span>
                  </td>
                {/each}
                <td class="px-4 py-2">
                  <Badge tone={STATE_BADGE_TONE[city.worstStatus]} class="text-[10px]">
                    {STATE_LABEL[city.worstStatus]}
                  </Badge>
                </td>
              </tr>
            {/each}
            {#if filtered.length === 0}
              <tr>
                <td colspan="8" class="px-4 py-6 text-center text-slate-400">
                  Aucune ville ne correspond au filtre.
                </td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <!-- ── Panneau droit : scorecard détaillée ──────────────────────────────── -->
  <svelte:fragment slot="sel">
    {#if selectedCity}
      <SourceScorecard city={selectedCity} {focusScope} onClose={() => { selectedCity = null; }} />
    {:else}
      <div class="flex flex-1 items-center justify-center p-6 text-center">
        <p class="text-sm text-slate-400">
          {headlineText || "Sélectionnez une ville pour le détail de sa couverture."}
        </p>
      </div>
    {/if}
  </svelte:fragment>
</ViewLayout>
