<script lang="ts">
  import { Layers } from "@lucide/svelte";
  import type { SourceEvaluation } from "$lib/source-review/source-evaluation-data";
  import { sourceEvaluations } from "$lib/source-review/source-evaluation-data.js";
  import {
    accessLabels,
    costLabels,
    recommendationLabels,
    visionLabels,
  } from "$lib/source-review/source-review-labels.js";
  import SourceDeepDive from "$lib/components/source-review/SourceDeepDive.svelte";

  let selectedId: string = sourceEvaluations[0]?.id ?? "";

  $: selectedSource = sourceEvaluations.find((s) => s.id === selectedId) ?? null;
</script>

<div class="space-y-4">
  <!-- Sélecteur de source -->
  <div class="flex items-center gap-3">
    <Layers class="h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
    <label for="source-select" class="text-sm font-semibold text-slate-950">
      Choisir une source à approfondir
    </label>
    <select
      id="source-select"
      bind:value={selectedId}
      class="ml-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-950 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
    >
      {#each sourceEvaluations as source}
        <option value={source.id}>{source.name}</option>
      {/each}
    </select>
  </div>

  <!-- Panneau de détail — réutilise SourceDeepDive -->
  {#if selectedSource}
    <SourceDeepDive source={selectedSource} />
  {/if}
</div>
