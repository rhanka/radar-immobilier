<script lang="ts">
  import { Layers, ChevronDown, ChevronRight } from "@lucide/svelte";
  import type { SourceEvaluation } from "$lib/source-review/source-evaluation-data";
  import { sourceEvaluations } from "$lib/source-review/source-evaluation-data.js";
  import {
    accessLabels,
    costLabels,
    recommendationLabels,
  } from "$lib/source-review/source-review-labels.js";
  import SourceDeepDive from "$lib/components/source-review/SourceDeepDive.svelte";
  import Acronym from "$lib/components/Acronym.svelte";
  import { getAcronym } from "$lib/glossary/acronyms.js";

  /** Id de la source depliee dans l'accordeon (null = toutes repliees). */
  let expandedSourceId: string | null = sourceEvaluations[0]?.id ?? null;

  function toggleSource(source: SourceEvaluation): void {
    expandedSourceId = expandedSourceId === source.id ? null : source.id;
  }

  function recoBadgeClass(rec: string): string {
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
</script>

<div class="space-y-4">
  <!-- En-tete de section -->
  <div class="flex items-center gap-2">
    <Layers class="h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
    <p class="text-sm font-semibold text-slate-950">
      Approfondissement par source ({sourceEvaluations.length})
    </p>
    <span class="ml-auto text-xs text-slate-400">Cliquer une source pour afficher le detail</span>
  </div>

  <!-- Catalogue en accordeon : chaque source se deplie avec son SourceDeepDive -->
  <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div class="divide-y divide-slate-100">
      {#each sourceEvaluations as source (source.id)}
        {@const isExpanded = expandedSourceId === source.id}
        <div>
          <!-- En-tete de carte : clic deplie / replie le detail en place -->
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

          <!-- Detail deplie en place : SourceDeepDive complet -->
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
