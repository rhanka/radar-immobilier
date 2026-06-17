<script lang="ts">
  /**
   * SourcesMapView — "Sources" nav view (WP A.1.4).
   *
   * Displays the "grand filet" coverage: all scanned cities color-coded by
   * scraping maturity, with a clear visual distinction between cities that
   * have real designation-event (zonage change) detections vs those scanned
   * with 0 signals so far.
   *
   * Summary header: "N villes scannées · M avec changement de zonage"
   * (derived from live API data — never hard-coded).
   *
   * Data sources:
   *   GET /api/scrape-status       → scraping maturity per city×source
   *   GET /api/signals/by-city     → designationEventCount per city
   *
   * No PII: citySlug is a non-identifying technical identifier (Loi 25).
   */
  import { onMount } from "svelte";
  import { MapPin, RefreshCw, Zap } from "@lucide/svelte";
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
  import { fetchSignalsByCity } from "$lib/signals/signals-by-city-client.js";
  import {
    buildCoverageEntries,
    computeCoverageStats,
    type CoverageCityEntry,
  } from "$lib/sources/coverage.js";
  import { fetchSignalDetail, type DesignationEventDetail } from "$lib/signals/signal-detail-client.js";
  import { fetchDataQuality } from "$lib/sources/data-quality-client.js";
  import type {
    DataQualityCitySummaryT,
    DataQualityCollectionSummaryT,
    DataQualityGeoSummaryT,
    DataQualityOntologySummaryT,
    DataQualityStateT,
  } from "@radar/domain";

  // ── State ──────────────────────────────────────────────────────────────────
  let loading = false;
  let loadError: string | null = null;
  let entries: CoverageCityEntry[] = [];
  let selectedCity: CoverageCityEntry | null = null;

  // Detail panel state (zonage events for selected city)
  let detailLoading = false;
  let detailError: string | null = null;
  let detailEvents: DesignationEventDetail[] = [];
  let dataQualityLoading = false;
  let dataQualityError: string | null = null;
  let dataQualitySummary: DataQualityCitySummaryT | null = null;

  // ── Derived stats ──────────────────────────────────────────────────────────
  $: stats = computeCoverageStats(entries);
  $: withZonage = entries.filter((e) => e.hasZonage);
  $: withoutZonage = entries.filter((e) => !e.hasZonage);

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
    selectedCity = null;
    detailEvents = [];
    try {
      // Fetch both APIs in parallel; scrape-status is optional (may be empty)
      const [scrapeResult, signalsResult] = await Promise.all([
        fetchScrapeStatus().catch(() => ({ items: [] })),
        fetchSignalsByCity(),
      ]);
      const maturitySummaries = groupByCity(scrapeResult.items);
      entries = buildCoverageEntries(maturitySummaries, signalsResult.items);
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Erreur de chargement";
      entries = [];
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  // ── City selection ─────────────────────────────────────────────────────────
  async function selectCity(entry: CoverageCityEntry) {
    selectedCity = entry;
    detailEvents = [];
    detailError = null;
    void loadDataQuality(entry.citySlug);

    if (entry.hasZonage) {
      detailLoading = true;
      try {
        const res = await fetchSignalDetail(entry.citySlug);
        detailEvents = res.events;
      } catch (e) {
        detailError = e instanceof Error ? e.message : "Erreur détail";
      } finally {
        detailLoading = false;
      }
    }
  }

  async function loadDataQuality(citySlug: string): Promise<void> {
    dataQualityLoading = true;
    dataQualityError = null;
    dataQualitySummary = null;
    try {
      dataQualitySummary = await fetchDataQuality(citySlug);
    } catch (e) {
      dataQualityError = e instanceof Error ? e.message : "Erreur qualité données";
    } finally {
      dataQualityLoading = false;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function colorForEntry(entry: CoverageCityEntry): string {
    if (entry.maturitySummary) return entry.maturitySummary.color;
    return "slate";
  }

  function labelForEntry(entry: CoverageCityEntry): string {
    if (entry.maturitySummary) {
      return `${maturityLabel(entry.maturitySummary.maturity)} — ${entry.maturitySummary.maturity}%`;
    }
    return "Recueil non initié";
  }

  const QUALITY_TONE: Record<
    DataQualityStateT,
    "success" | "info" | "warning" | "neutral"
  > = {
    fresh: "success",
    partial: "info",
    stale: "warning",
    unknown: "neutral",
  };

  const QUALITY_LABEL: Record<DataQualityStateT, string> = {
    fresh: "frais",
    partial: "partiel",
    stale: "périmé",
    unknown: "inconnu",
  };

  function collectionDetail(summary: DataQualityCollectionSummaryT): string {
    const c = summary.counts;
    return `${c.graphified} graphifié(s) · ${c.scraped} scrappé(s) · ${c.error} erreur(s)`;
  }

  function ontologyDetail(summary: DataQualityOntologySummaryT): string {
    const c = summary.counts;
    return `${c.nodes} nœuds · ${c.edges} liens · ${c.signals} signaux`;
  }

  function geoDetail(summary: DataQualityGeoSummaryT): string {
    const c = summary.counts;
    return `${c.currentVersions} version(s) · ${c.withGeometry} avec géométrie`;
  }
</script>

<ViewLayout controlsWidth="w-80" stickyControlsFooter>
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
    {:else if entries.length === 0}
      <div class="p-4">
        <EmptyState
          title="Aucune donnée"
          message="Aucune ville scannée. Les agents de scraping alimentent cette vue via PUT /api/scrape-status et l'ontologie via /api/signals/by-city."
        />
      </div>
    {:else}
      <!-- Coverage summary banner -->
      <div
        class="border-b border-slate-100 bg-teal-50 px-4 py-3"
        data-testid="coverage-summary"
        aria-label="Résumé de couverture"
      >
        <p class="text-sm font-semibold text-teal-900">
          {stats.totalScanned} ville{stats.totalScanned !== 1 ? "s" : ""} scannée{stats.totalScanned !== 1 ? "s" : ""}
          <span class="mx-1 text-teal-400">·</span>
          <span class="text-teal-700">
            {stats.totalWithZonage} avec changement de zonage
          </span>
        </p>
      </div>

      <!-- Category 1: villes avec changement de zonage -->
      {#if withZonage.length > 0}
        <div class="border-b border-slate-100">
          <p class="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-teal-600">
            Changement de zonage détecté
          </p>
          <ul class="divide-y divide-slate-100">
            {#each withZonage as entry (entry.citySlug)}
              {@const isSelected = selectedCity?.citySlug === entry.citySlug}
              {@const color = colorForEntry(entry)}
              <li>
                <button
                  type="button"
                  class={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                    isSelected ? "bg-teal-50" : "hover:bg-slate-50"
                  }`}
                  on:click={() => selectCity(entry)}
                >
                  <span
                    class={`h-3 w-3 shrink-0 rounded-full ${DOT_BG[color]}`}
                    aria-hidden="true"
                  ></span>
                  <span class="min-w-0 flex-1">
                    <span class="block text-sm font-medium capitalize text-slate-900">
                      {entry.citySlug}
                    </span>
                    <span class="block text-xs text-slate-500">
                      {labelForEntry(entry)}
                    </span>
                  </span>
                  <span class="flex shrink-0 items-center gap-1">
                    <Zap class="h-3.5 w-3.5 text-teal-500" aria-hidden="true" />
                    <Badge tone="info">
                      {entry.designationEventCount} signal{entry.designationEventCount !== 1 ? "s" : ""}
                    </Badge>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- Category 2: villes scannées à 0 signal -->
      {#if withoutZonage.length > 0}
        <div>
          <p class="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Scannées — 0 signal pour l'instant
          </p>
          <ul class="divide-y divide-slate-100">
            {#each withoutZonage as entry (entry.citySlug)}
              {@const isSelected = selectedCity?.citySlug === entry.citySlug}
              {@const color = colorForEntry(entry)}
              <li>
                <button
                  type="button"
                  class={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                    isSelected ? "bg-slate-100" : "hover:bg-slate-50"
                  }`}
                  on:click={() => selectCity(entry)}
                >
                  <span
                    class={`h-3 w-3 shrink-0 rounded-full ${DOT_BG[color]}`}
                    aria-hidden="true"
                  ></span>
                  <span class="min-w-0 flex-1">
                    <span class="block text-sm font-medium capitalize text-slate-400">
                      {entry.citySlug}
                    </span>
                    <span class="block text-xs text-slate-400">
                      {labelForEntry(entry)}
                    </span>
                  </span>
                  <Badge tone="neutral">0</Badge>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}

  </svelte:fragment>

  <!-- Légende maturité épinglée en bas de la bande (footer de menu DS) -->
  <svelte:fragment slot="controls-footer">
    <div class="p-4">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Légende (maturité recueil)
      </p>
      <ul class="space-y-1">
        {#each [
          { color: "green", label: "Complet (100%)" },
          { color: "teal", label: "Avancé (50–99%)" },
          { color: "amber", label: "Partiel (25–49%)" },
          { color: "red", label: "Démarrage (1–24%)" },
          { color: "slate", label: "Aucune donnée recueil" },
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
    {@const entry = selectedCity}
    <div class="flex flex-col gap-0">
      <div class="border-b border-slate-200 bg-white px-6 py-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold text-slate-900">
            Qualité des données — <span class="capitalize">{entry.citySlug}</span>
          </h2>
          {#if dataQualitySummary}
            <span class="text-xs text-slate-400">
              {new Date(dataQualitySummary.generatedAt).toLocaleDateString("fr-CA")}
            </span>
          {/if}
        </div>

        {#if dataQualityLoading}
          <p class="text-sm text-slate-400">Chargement de la qualité des données…</p>
        {:else if dataQualityError}
          <p class="text-sm text-amber-700">{dataQualityError}</p>
        {:else if dataQualitySummary}
          <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            <div class="rounded-md border border-slate-200 px-3 py-2">
              <div class="mb-1 flex items-center justify-between gap-2">
                <span class="text-xs font-semibold uppercase tracking-wide text-slate-400">PV</span>
                <Badge tone={QUALITY_TONE[dataQualitySummary.councilMinutes.status]}>
                  {QUALITY_LABEL[dataQualitySummary.councilMinutes.status]}
                </Badge>
              </div>
              <p class="text-xs text-slate-600">{collectionDetail(dataQualitySummary.councilMinutes)}</p>
            </div>
            <div class="rounded-md border border-slate-200 px-3 py-2">
              <div class="mb-1 flex items-center justify-between gap-2">
                <span class="text-xs font-semibold uppercase tracking-wide text-slate-400">YouTube</span>
                <Badge tone={QUALITY_TONE[dataQualitySummary.youtube.status]}>
                  {QUALITY_LABEL[dataQualitySummary.youtube.status]}
                </Badge>
              </div>
              <p class="text-xs text-slate-600">{collectionDetail(dataQualitySummary.youtube)}</p>
            </div>
            <div class="rounded-md border border-slate-200 px-3 py-2">
              <div class="mb-1 flex items-center justify-between gap-2">
                <span class="text-xs font-semibold uppercase tracking-wide text-slate-400">Ontologie</span>
                <Badge tone={QUALITY_TONE[dataQualitySummary.ontology.status]}>
                  {QUALITY_LABEL[dataQualitySummary.ontology.status]}
                </Badge>
              </div>
              <p class="text-xs text-slate-600">{ontologyDetail(dataQualitySummary.ontology)}</p>
            </div>
            <div class="rounded-md border border-slate-200 px-3 py-2">
              <div class="mb-1 flex items-center justify-between gap-2">
                <span class="text-xs font-semibold uppercase tracking-wide text-slate-400">Zones</span>
                <Badge tone={QUALITY_TONE[dataQualitySummary.zones.status]}>
                  {QUALITY_LABEL[dataQualitySummary.zones.status]}
                </Badge>
              </div>
              <p class="text-xs text-slate-600">{geoDetail(dataQualitySummary.zones)}</p>
            </div>
            <div class="rounded-md border border-slate-200 px-3 py-2">
              <div class="mb-1 flex items-center justify-between gap-2">
                <span class="text-xs font-semibold uppercase tracking-wide text-slate-400">Lots</span>
                <Badge tone={QUALITY_TONE[dataQualitySummary.lots.status]}>
                  {QUALITY_LABEL[dataQualitySummary.lots.status]}
                </Badge>
              </div>
              <p class="text-xs text-slate-600">{geoDetail(dataQualitySummary.lots)}</p>
            </div>
          </div>
        {/if}
      </div>

      <!-- Zonage events (only for cities with detected zonage) -->
      {#if entry.hasZonage}
        <div class="border-b border-slate-200 bg-teal-50 px-6 py-4">
          <h2 class="flex items-center gap-2 text-base font-semibold capitalize text-slate-900">
            <Zap class="h-4 w-4 text-teal-600" aria-hidden="true" />
            {entry.citySlug} — {entry.designationEventCount} changement{entry.designationEventCount !== 1 ? "s" : ""} de zonage
          </h2>
          {#if entry.generatedAt}
            <p class="mt-0.5 text-xs text-teal-600">
              Mis à jour : {new Date(entry.generatedAt).toLocaleDateString("fr-CA")}
            </p>
          {/if}

          {#if detailLoading}
            <p class="mt-2 text-sm text-slate-400">Chargement des détails…</p>
          {:else if detailError}
            <p class="mt-2 text-sm text-red-600">{detailError}</p>
          {:else if detailEvents.length > 0}
            <ul class="mt-3 space-y-2">
              {#each detailEvents as event (event.sourceRef)}
                <li class="rounded-lg border border-teal-200 bg-white p-3 shadow-sm">
                  <p class="text-sm font-medium text-slate-800">{event.label}</p>
                  {#if event.reglementNumbers.length > 0}
                    <p class="mt-1 text-xs text-slate-500">
                      Règlement{event.reglementNumbers.length !== 1 ? "s" : ""} :
                      <span class="font-mono text-slate-700">{event.reglementNumbers.join(", ")}</span>
                    </p>
                  {/if}
                  {#if event.zoneRefs.length > 0}
                    <p class="mt-0.5 text-xs text-slate-500">
                      Zone{event.zoneRefs.length !== 1 ? "s" : ""} :
                      <span class="font-mono text-slate-700">{event.zoneRefs.join(", ")}</span>
                    </p>
                  {/if}
                  <p class="mt-1 text-xs text-slate-400">
                    Observé : {new Date(event.dateObserved).toLocaleDateString("fr-CA")}
                  </p>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="mt-2 text-sm text-slate-400">Détails non encore disponibles.</p>
          {/if}
        </div>
      {/if}

      <!-- Scrape-status detail -->
      {#if entry.maturitySummary}
        <CityDetailPanel
          citySlug={entry.citySlug}
          items={entry.maturitySummary.items}
        />
      {:else}
        <div class="flex flex-1 items-center justify-center p-8 text-center">
          <div>
            <MapPin class="mx-auto mb-3 h-8 w-8 text-slate-300" aria-hidden="true" />
            <p class="text-sm font-medium capitalize text-slate-700">{entry.citySlug}</p>
            <p class="mt-1 text-sm text-slate-400">
              Aucun statut de recueil enregistré pour cette ville.
            </p>
          </div>
        </div>
      {/if}
    </div>
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
