<script lang="ts">
  import { CircleDollarSign, ClipboardList, Handshake } from "@lucide/svelte";
  import type { SourceEvaluation } from "$lib/source-review/source-evaluation-data";
  import {
    getAccessPrioritySources,
    getRecommendationSummary,
  } from "$lib/source-review/source-evaluation-data";
  import {
    accessLabels,
    costLabels,
    recommendationLabels,
  } from "$lib/source-review/source-review-labels";

  export let sources: SourceEvaluation[];
  export let selectedSourceId: string;
  export let onSelectSource: (sourceId: string) => void;

  $: summary = getRecommendationSummary(sources);
  $: accessPriority = getAccessPrioritySources(sources).slice(0, 6);
  $: buildNow = sources.filter((source) => source.recommendation === "build-now");
  $: selectedSource =
    sources.find((source) => source.id === selectedSourceId) ?? sources[0];
</script>

<aside class="space-y-4">
  {#if selectedSource}
    <section class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <p class="text-[11px] font-semibold uppercase text-teal-700">
            Source selectionnee
          </p>
          <h1 class="mt-1 text-sm font-semibold text-slate-950">
            {selectedSource.name}
          </h1>
        </div>
        <span class="rounded-md bg-slate-950 px-2 py-1 text-[11px] font-semibold text-white">
          {selectedSource.businessValue}/5
        </span>
      </div>

      <div class="space-y-3 text-xs leading-5">
        <div>
          <h2 class="font-semibold text-slate-950">Fait</h2>
          <p class="mt-1 text-slate-600">{selectedSource.done[0]}</p>
        </div>
        <div class="rounded-md bg-teal-50 p-2">
          <h2 class="font-semibold text-teal-950">A faire (reco)</h2>
          <p class="mt-1 text-slate-700">{selectedSource.next[0]}</p>
        </div>
        <div class="rounded-md bg-amber-50 p-2">
          <h2 class="font-semibold text-amber-950">Attendus client</h2>
          <p class="mt-1 text-slate-700">{selectedSource.clientExpected[0]}</p>
        </div>
      </div>
    </section>
  {/if}

  <section class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div class="mb-3 flex items-center gap-2">
      <ClipboardList class="h-4 w-4 text-teal-700" aria-hidden="true" />
      <h2 class="text-sm font-semibold text-slate-950">Synthese reco</h2>
    </div>
    <dl class="grid grid-cols-2 gap-2 text-xs">
      <div class="rounded-md bg-teal-50 p-2">
        <dt class="text-slate-600">{recommendationLabels["build-now"]}</dt>
        <dd class="text-lg font-bold text-teal-900">{summary.buildNow}</dd>
      </div>
      <div class="rounded-md bg-amber-50 p-2">
        <dt class="text-slate-600">{recommendationLabels["qualify-access-now"]}</dt>
        <dd class="text-lg font-bold text-amber-900">{summary.qualifyAccessNow}</dd>
      </div>
      <div class="rounded-md bg-slate-50 p-2">
        <dt class="text-slate-600">{recommendationLabels["build-later"]}</dt>
        <dd class="text-lg font-bold text-slate-900">{summary.buildLater}</dd>
      </div>
      <div class="rounded-md bg-rose-50 p-2">
        <dt class="text-slate-600">Manuel / drop</dt>
        <dd class="text-lg font-bold text-rose-900">
          {summary.manualCheck + summary.dropPhase1}
        </dd>
      </div>
    </dl>
  </section>

  <section class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div class="mb-3 flex items-center gap-2">
      <CircleDollarSign class="h-4 w-4 text-amber-700" aria-hidden="true" />
      <h2 class="text-sm font-semibold text-slate-950">Acces et couts a qualifier</h2>
    </div>
    <div class="space-y-2">
      {#each accessPriority as source}
        <button
          type="button"
          class={`w-full rounded-md border p-2 text-left text-xs transition ${
            source.id === selectedSourceId
              ? "border-amber-600 bg-amber-50"
              : "border-slate-200 bg-white hover:border-amber-400"
          }`}
          on:click={() => onSelectSource(source.id)}
        >
          <span class="block font-semibold text-slate-900">{source.name}</span>
          <span class="mt-1 block text-slate-600">
            {accessLabels[source.accessMode]} - {costLabels[source.costLevel]}
          </span>
        </button>
      {/each}
    </div>
  </section>

  <section class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div class="mb-3 flex items-center gap-2">
      <Handshake class="h-4 w-4 text-teal-700" aria-hidden="true" />
      <h2 class="text-sm font-semibold text-slate-950">A construire en premier</h2>
    </div>
    <div class="space-y-2">
      {#each buildNow.slice(0, 6) as source}
        <button
          type="button"
          class="w-full rounded-md border border-slate-200 bg-slate-50 p-2 text-left text-xs hover:border-teal-500"
          on:click={() => onSelectSource(source.id)}
        >
          <span class="font-semibold text-slate-900">{source.name}</span>
          <span class="mt-1 block text-slate-600">{source.next[0]}</span>
        </button>
      {/each}
    </div>
  </section>
</aside>
