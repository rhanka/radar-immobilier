<script lang="ts">
  /**
   * SourcesMapView — "Sources" nav view (WP A.1.4).
   *
   * Displays a list of cities (from the live API) color-coded by scraping
   * maturity. Clicking a city opens the CityDetailPanel in the main area.
   *
   * Anti-invention: cities are only shown if the API has ScrapeStatus records
   * for them. No hardcoded city list. On first deploy the view shows an empty
   * state — data is populated by scraping agents calling PUT /api/scrape-status.
   */
  import { onMount } from "svelte";
  import { MapPin, RefreshCw } from "@lucide/svelte";
  import { Badge, EmptyState } from "@sentropic/design-system-svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import CityDetailPanel from "./CityDetailPanel.svelte";
  import { fetchScrapeStatus } from "$lib/sources/scrape-status-client.js";
  import {
    groupByCity,
    cityMaturityColor,
    maturityLabel,
    type CityMaturitySummary,
  } from "$lib/sources/maturity.js";

  // ── State ──────────────────────────────────────────────────────────────────
  let loading = false;
  let loadError: string | null = null;
  let summaries: CityMaturitySummary[] = [];
  let selectedCity: CityMaturitySummary | null = null;

  // ── Color CSS mapping ──────────────────────────────────────────────────────
  const DOT_BG: Record<string, string> = {
    green: "bg-green-500",
    teal: "bg-teal-500",
    amber: "bg-amber-400",
    red: "bg-red-400",
    slate: "bg-slate-300",
  };

  const BADGE_TONE: Record<
    string,
    "success" | "info" | "warning" | "error" | "neutral"
  > = {
    green: "success",
    teal: "info",
    amber: "warning",
    red: "error",
    slate: "neutral",
  };

  // ── Load data ──────────────────────────────────────────────────────────────
  async function load() {
    loading = true;
    loadError = null;
    try {
      const res = await fetchScrapeStatus();
      summaries = groupByCity(res.items);
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Erreur de chargement";
      summaries = [];
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  function selectCity(summary: CityMaturitySummary) {
    selectedCity = summary;
  }
</script>

<ViewLayout controlsWidth="w-80">
  <!-- ── Left sidebar: city list ────────────────────────────────────────── -->
  <svelte:fragment slot="controls">
    <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <h1 class="flex items-center gap-2 text-sm font-bold text-slate-900">
        <MapPin class="h-4 w-4 text-teal-600" aria-hidden="true" />
        Sources
      </h1>
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

    {#if loadError}
      <div class="p-4 text-sm text-red-600">{loadError}</div>
    {:else if loading}
      <div class="p-4 text-sm text-slate-400">Chargement…</div>
    {:else if summaries.length === 0}
      <div class="p-4">
        <EmptyState
          title="Aucune donnée"
          message="Aucune ville ne dispose encore de statuts de recueil. Les agents de scraping alimentent cette vue via PUT /api/scrape-status."
        />
      </div>
    {:else}
      <ul class="divide-y divide-slate-100">
        {#each summaries as summary (summary.citySlug)}
          {@const isSelected = selectedCity?.citySlug === summary.citySlug}
          <li>
            <button
              type="button"
              class={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                isSelected ? "bg-teal-50" : "hover:bg-slate-50"
              }`}
              on:click={() => selectCity(summary)}
            >
              <span
                class={`h-3 w-3 shrink-0 rounded-full ${DOT_BG[summary.color]}`}
                aria-hidden="true"
              ></span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium capitalize text-slate-900">
                  {summary.citySlug}
                </span>
                <span class="block text-xs text-slate-500">
                  {maturityLabel(summary.maturity)} — {summary.maturity}%
                </span>
              </span>
              <Badge tone={BADGE_TONE[summary.color]} class="shrink-0">
                {summary.items.length} src
              </Badge>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- Legend -->
    <div class="border-t border-slate-100 p-4">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Légende
      </p>
      <ul class="space-y-1">
        {#each [
          { color: "green", label: "Complet (100%)" },
          { color: "teal", label: "Avancé (50–99%)" },
          { color: "amber", label: "Partiel (25–49%)" },
          { color: "red", label: "Démarrage (1–24%)" },
          { color: "slate", label: "Aucune donnée" },
        ] as entry (entry.color)}
          <li class="flex items-center gap-2 text-xs text-slate-600">
            <span class={`h-2.5 w-2.5 rounded-full ${DOT_BG[entry.color]}`}
            ></span>
            {entry.label}
          </li>
        {/each}
      </ul>
    </div>
  </svelte:fragment>

  <!-- ── Main: city detail or placeholder ───────────────────────────────── -->
  {#if selectedCity}
    <CityDetailPanel
      citySlug={selectedCity.citySlug}
      items={selectedCity.items}
    />
  {:else}
    <div class="flex flex-1 items-center justify-center p-8 text-center">
      <div>
        <MapPin
          class="mx-auto mb-3 h-8 w-8 text-slate-300"
          aria-hidden="true"
        />
        <p class="text-sm text-slate-400">
          Sélectionnez une ville pour voir le détail des données recueillies.
        </p>
      </div>
    </div>
  {/if}
</ViewLayout>
