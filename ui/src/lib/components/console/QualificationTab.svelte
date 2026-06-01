<script lang="ts">
  import { Search, ChevronDown, ChevronRight } from "@lucide/svelte";
  import type { SourceEvaluation, RecommendationKind } from "$lib/source-review/source-evaluation-data";
  import Acronym from "$lib/components/Acronym.svelte";
  import { getAcronym } from "$lib/glossary/acronyms.js";
  import { sourceEvaluations } from "$lib/source-review/source-evaluation-data.js";
  import { qualificationStatus } from "$lib/console/console-data.js";
  import {
    accessLabels,
    costLabels,
    recommendationLabels,
  } from "$lib/source-review/source-review-labels.js";
  import SourceDeepDive from "$lib/components/source-review/SourceDeepDive.svelte";
  import SourceQuadrant from "$lib/components/source-review/SourceQuadrant.svelte";

  let selectedSourceId = "avis-publics-valleyfield";

  $: statusRows = qualificationStatus();

  /** Id de la source dépliée dans l'accordéon (null = toutes repliées). */
  let expandedSourceId: string | null = null;

  /** Bascule l'accordéon : clic sur une ligne déplie le détail en place (ou le replie). */
  function toggleSource(source: SourceEvaluation): void {
    expandedSourceId = expandedSourceId === source.id ? null : source.id;
  }

  function recoBadgeClass(rec: RecommendationKind): string {
    switch (rec) {
      case "build-now":
        return "bg-teal-100 text-teal-800";
      case "qualify-access-now":
        return "bg-amber-100 text-amber-800";
      case "build-later":
        return "bg-slate-100 text-slate-700";
      case "manual-check":
        return "bg-orange-100 text-orange-800";
      case "drop-phase-1":
        return "bg-red-50 text-red-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  }

  function recoCountClass(rec: RecommendationKind): string {
    switch (rec) {
      case "build-now":
        return "bg-teal-600 text-white";
      case "qualify-access-now":
        return "bg-amber-500 text-white";
      case "build-later":
        return "bg-slate-400 text-white";
      case "manual-check":
        return "bg-orange-500 text-white";
      case "drop-phase-1":
        return "bg-red-400 text-white";
      default:
        return "bg-slate-400 text-white";
    }
  }
</script>

<div class="space-y-6">
  <!-- S3-B1 : cadran sources integre ici (fusion onglet Cadran) -->
  <SourceQuadrant
    sources={sourceEvaluations}
    {selectedSourceId}
    onSelectSource={(sourceId) => { selectedSourceId = sourceId; }}
  />

  <!-- Compteurs par groupe -->
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
    {#each statusRows as row}
      <div class="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">{row.label}</p>
        <p class={`mt-1 inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xl font-bold ${recoCountClass(row.recommendation)}`}>
          {row.count}
        </p>
      </div>
    {/each}
  </div>

  <!-- Catalogue sources : cartes accordéon (clic = déplie le détail en place) -->
  <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div class="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
      <Search class="h-4 w-4 text-teal-600" aria-hidden="true" />
      <h1 class="text-sm font-semibold text-slate-950">
        Catalogue sources ({sourceEvaluations.length})
      </h1>
      <span class="ml-auto text-xs text-slate-400">
        Cliquer une source pour déplier son détail
      </span>
    </div>

    <div class="divide-y divide-slate-100">
      {#each sourceEvaluations as source (source.id)}
        {@const isExpanded = expandedSourceId === source.id}
        <div>
          <!-- En-tête de carte : clic déplie / replie le détail en place -->
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
            aria-expanded={isExpanded}
            on:click={() => toggleSource(source)}
          >
            <span class="shrink-0 text-slate-400">
              {#if isExpanded}
                <ChevronDown class="h-4 w-4" aria-hidden="true" />
              {:else}
                <ChevronRight class="h-4 w-4" aria-hidden="true" />
              {/if}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block font-medium text-slate-950">
                {#if getAcronym(source.name)}
                  <Acronym term={source.name} />
                {:else}
                  {source.name}
                {/if}
              </span>
              <span class="mt-0.5 block text-xs text-slate-500">{source.family}</span>
            </span>
            <span class={`hidden shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold sm:inline-block ${recoBadgeClass(source.recommendation)}`}>
              {recommendationLabels[source.recommendation]}
            </span>
            <span class="hidden shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 md:inline-block">
              {accessLabels[source.accessMode]}
            </span>
            <span class="hidden shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 md:inline-block">
              {costLabels[source.costLevel]}
            </span>
          </button>

          <!-- Détail déplié en place (remplace l'ancien drawer slide-over) -->
          {#if isExpanded}
            <div class="border-t border-slate-100 bg-slate-50 p-4">
              <SourceDeepDive {source} />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
