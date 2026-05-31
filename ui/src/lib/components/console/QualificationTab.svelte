<script lang="ts">
  import { Search } from "@lucide/svelte";
  import { Drawer, Button, Badge } from "@sentropic/design-system-svelte";
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

  let drawerOpen = false;
  let selectedSource: SourceEvaluation | null = null;

  function openSource(source: SourceEvaluation): void {
    selectedSource = source;
    drawerOpen = true;
  }

  function closeDrawer(): void {
    drawerOpen = false;
    selectedSource = null;
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

  <!-- Table des sources -->
  <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div class="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
      <Search class="h-4 w-4 text-teal-600" aria-hidden="true" />
      <h1 class="text-sm font-semibold text-slate-950">
        Catalogue sources ({sourceEvaluations.length})
      </h1>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th class="px-4 py-2.5">Source</th>
            <th class="px-3 py-2.5">Famille</th>
            <th class="px-3 py-2.5">Recommandation</th>
            <th class="px-3 py-2.5">Accès</th>
            <th class="px-3 py-2.5">Coût</th>
            <th class="px-3 py-2.5 sr-only">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each sourceEvaluations as source}
            <tr
              class="cursor-pointer hover:bg-slate-50"
              on:click={() => openSource(source)}
            >
              <td class="px-4 py-2.5">
                <p class="font-medium text-slate-950">
                  {#if getAcronym(source.name)}
                    <Acronym term={source.name} />
                  {:else}
                    {source.name}
                  {/if}
                </p>
              </td>
              <td class="px-3 py-2.5 text-xs text-slate-500">{source.family}</td>
              <td class="px-3 py-2.5">
                <span class={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${recoBadgeClass(source.recommendation)}`}>
                  {recommendationLabels[source.recommendation]}
                </span>
              </td>
              <td class="px-3 py-2.5">
                <span class="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                  {accessLabels[source.accessMode]}
                </span>
              </td>
              <td class="px-3 py-2.5">
                <span class="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                  {costLabels[source.costLevel]}
                </span>
              </td>
              <td class="px-3 py-2.5">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onclick={(e) => { e.stopPropagation(); openSource(source); }}
                >
                  Détails
                </Button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- Drawer détail source -->
<Drawer
  open={drawerOpen}
  title={selectedSource?.name ?? ""}
  description={selectedSource?.family ?? ""}
  side="right"
  onclose={closeDrawer}
>
  {#if selectedSource}
    <div class="p-4">
      <SourceDeepDive source={selectedSource} />
    </div>
  {/if}
</Drawer>
