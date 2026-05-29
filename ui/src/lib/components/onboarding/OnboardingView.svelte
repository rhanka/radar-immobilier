<script lang="ts">
  import { CheckSquare, Square, Info, PlayCircle, AlertCircle } from "@lucide/svelte";
  import type { RecommendationKind } from "$lib/source-review/source-evaluation-data.js";
  import {
    groupByRecommendation,
    defaultSelection,
    summarize,
    RECOMMENDATION_LABELS_FR,
    VISION_ALIGNMENT_LABELS_FR,
    RETRO_WINDOW_MONTHS_DEFAULT,
  } from "$lib/onboarding/onboarding-data.js";
  import { accessLabels, costLabels } from "$lib/source-review/source-review-labels.js";

  // ── Selection state ────────────────────────────────────────────────────────
  let selectedIds: string[] = defaultSelection();

  function toggleSource(id: string) {
    if (selectedIds.includes(id)) {
      selectedIds = selectedIds.filter((s) => s !== id);
    } else {
      selectedIds = [...selectedIds, id];
    }
  }

  // ── Retro-analysis window ──────────────────────────────────────────────────
  const windowOptions = [12, 24, 36];
  let retroWindow: number = RETRO_WINDOW_MONTHS_DEFAULT;

  // Illustrative estimate: selectedCount × (window/12) × 8 signals/source/year
  // Labelled "estimation indicative" — not a forecast.
  const SIGNAL_RATE_PER_SOURCE_PER_YEAR = 8;
  $: estimatedSignals =
    selectedIds.length * (retroWindow / 12) * SIGNAL_RATE_PER_SOURCE_PER_YEAR;

  // ── Groups ─────────────────────────────────────────────────────────────────
  const groups = groupByRecommendation();

  // ── CTA / summary ─────────────────────────────────────────────────────────
  let showSummary = false;
  $: summary = summarize(selectedIds);

  function recommendationBadgeClass(rec: RecommendationKind): string {
    if (rec === "build-now") return "bg-teal-100 text-teal-800";
    if (rec === "qualify-access-now") return "bg-amber-100 text-amber-800";
    if (rec === "build-later") return "bg-slate-100 text-slate-700";
    if (rec === "manual-check") return "bg-violet-100 text-violet-800";
    return "bg-rose-100 text-rose-700";
  }
</script>

<section class="min-h-full bg-slate-50 p-6">
  <!-- Header ---------------------------------------------------------------->
  <header class="mb-6">
    <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
      Onboarding
    </p>
    <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
      Onboarding d'une municipalité
    </h1>
    <p class="mt-1 text-sm text-slate-500">
      Sélectionnez les sources à activer pour la municipalité, puis lancez la
      rétro-analyse initiale — cela peuplera le radar avec les signaux historiques
      avant que les scans quotidiens ne prennent le relais.
    </p>
  </header>

  <!-- Source checklist ------------------------------------------------------>
  <div class="mb-8 space-y-6">
    {#each groups as group}
      <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
        <!-- Group header -->
        <div class="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
          <span
            class={`rounded px-2 py-0.5 text-xs font-semibold ${recommendationBadgeClass(group.recommendation)}`}
          >
            {group.label}
          </span>
          <span class="text-xs text-slate-500">
            {group.sources.length} source{group.sources.length > 1 ? "s" : ""}
          </span>
        </div>

        <!-- Sources list -->
        <div class="divide-y divide-slate-100">
          {#each group.sources as source}
            {@const checked = selectedIds.includes(source.id)}
            <button
              type="button"
              class={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                checked ? "bg-white" : "bg-white opacity-70"
              }`}
              on:click={() => toggleSource(source.id)}
            >
              <!-- Checkbox icon -->
              <span class="mt-0.5 shrink-0 text-teal-600">
                {#if checked}
                  <CheckSquare class="h-4 w-4" aria-hidden="true" />
                {:else}
                  <Square class="h-4 w-4 text-slate-400" aria-hidden="true" />
                {/if}
              </span>

              <!-- Source info -->
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-slate-950">{source.name}</p>

                <!-- Chips row -->
                <div class="mt-1 flex flex-wrap gap-1.5">
                  <span
                    class={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${recommendationBadgeClass(source.recommendation)}`}
                  >
                    {RECOMMENDATION_LABELS_FR[source.recommendation]}
                  </span>
                  <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                    {accessLabels[source.accessMode]}
                  </span>
                  <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                    {costLabels[source.costLevel]}
                  </span>
                </div>

                <!-- Vision alignment -->
                {#if source.visionAlignment.length > 0}
                  <p class="mt-1 text-[11px] text-slate-500">
                    {source.visionAlignment
                      .map((v) => VISION_ALIGNMENT_LABELS_FR[v])
                      .join(" · ")}
                  </p>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- Retro-analysis panel -------------------------------------------------->
  <div class="mb-8 rounded-lg border border-teal-200 bg-teal-50 p-5 shadow-sm">
    <div class="mb-3 flex items-center gap-2">
      <Info class="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
      <h2 class="text-base font-semibold text-slate-950">Rétro-analyse initiale</h2>
    </div>
    <p class="mb-4 text-sm text-slate-600">
      L'onboarding d'une nouvelle municipalité commence par une rétro-analyse
      historique : toutes les sources sélectionnées sont parcourues sur la fenêtre
      choisie pour reconstituer les signaux passés. Les scans quotidiens prennent
      ensuite le relais automatiquement.
    </p>

    <!-- Window selector -->
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <label for="retro-window" class="text-sm font-medium text-slate-700">
        Fenêtre rétro-analyse :
      </label>
      <select
        id="retro-window"
        bind:value={retroWindow}
        class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
      >
        {#each windowOptions as months}
          <option value={months}>{months} mois</option>
        {/each}
      </select>
      <span class="text-xs text-slate-500">
        (défaut : {RETRO_WINDOW_MONTHS_DEFAULT} mois)
      </span>
    </div>

    <!-- Indicative estimate -->
    <div class="rounded-md border border-teal-300 bg-white px-4 py-3">
      <p class="text-xs font-semibold uppercase tracking-wide text-teal-700">
        Estimation indicative
      </p>
      <p class="mt-1 text-2xl font-bold text-slate-950">
        ~{Math.round(estimatedSignals).toLocaleString("fr-CA")} signaux
      </p>
      <p class="mt-0.5 text-xs text-slate-500">
        {selectedIds.length} source{selectedIds.length !== 1 ? "s" : ""} ×
        {retroWindow} mois — estimation illustrative uniquement, non garantie.
        Le volume réel dépend de l'activité de chaque source.
      </p>
    </div>

    <p class="mt-3 text-xs text-slate-500">
      Après la rétro-analyse, chaque source activée passe en
      <span class="font-semibold text-teal-700">scan quotidien</span> automatique.
    </p>
  </div>

  <!-- CTA ------------------------------------------------------------------>
  <div class="mb-6">
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow transition hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-50"
      disabled={selectedIds.length === 0}
      on:click={() => { showSummary = !showSummary; }}
    >
      <PlayCircle class="h-4 w-4" aria-hidden="true" />
      Lancer l'onboarding
    </button>
    {#if selectedIds.length === 0}
      <p class="mt-2 text-xs text-rose-600">
        Sélectionnez au moins une source pour continuer.
      </p>
    {/if}
  </div>

  <!-- Confirmation summary (demo stub) ------------------------------------->
  {#if showSummary}
    <div class="rounded-lg border border-amber-300 bg-amber-50 p-5 shadow-sm">
      <!-- Demo disclaimer -->
      <div class="mb-4 flex items-start gap-2">
        <AlertCircle class="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <p class="text-sm font-semibold text-amber-800">
          Démo — aucune ingestion réelle n'est déclenchée (orchestration des jobs : ÉV6/ÉV7).
        </p>
      </div>

      <h2 class="mb-3 text-base font-semibold text-slate-950">
        Récapitulatif de l'onboarding
      </h2>

      <!-- Total + window -->
      <dl class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div class="rounded-md bg-white p-3 shadow-sm">
          <dt class="text-xs text-slate-500">Sources sélectionnées</dt>
          <dd class="mt-1 text-2xl font-bold text-teal-800">{summary.total}</dd>
        </div>
        <div class="rounded-md bg-white p-3 shadow-sm">
          <dt class="text-xs text-slate-500">Fenêtre rétro-analyse</dt>
          <dd class="mt-1 text-2xl font-bold text-teal-800">{retroWindow} mois</dd>
        </div>
        <div class="rounded-md bg-white p-3 shadow-sm">
          <dt class="text-xs text-slate-500">Signaux estimés (indicatif)</dt>
          <dd class="mt-1 text-2xl font-bold text-slate-700">
            ~{Math.round(estimatedSignals).toLocaleString("fr-CA")}
          </dd>
        </div>
      </dl>

      <!-- Breakdown by recommendation -->
      <h3 class="mb-2 text-sm font-semibold text-slate-700">
        Répartition par recommandation
      </h3>
      <ul class="space-y-1.5">
        {#each Object.entries(summary.byRecommendation) as [rec, count]}
          <li class="flex items-center gap-2">
            <span
              class={`rounded px-2 py-0.5 text-xs font-semibold ${recommendationBadgeClass(rec as RecommendationKind)}`}
            >
              {RECOMMENDATION_LABELS_FR[rec as RecommendationKind] ?? rec}
            </span>
            <span class="text-sm font-semibold text-slate-950">{count}</span>
            <span class="text-xs text-slate-500">
              source{count !== 1 ? "s" : ""}
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
