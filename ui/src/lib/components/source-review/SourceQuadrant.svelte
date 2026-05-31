<script lang="ts">
  import type { SourceEvaluation } from "$lib/source-review/source-evaluation-data";
  import {
    getPotentialComplexity,
    getQuadrant,
  } from "$lib/source-review/source-evaluation-data";
  import { quadrantLabels } from "$lib/source-review/source-review-labels";

  export let sources: SourceEvaluation[];
  export let selectedSourceId: string;
  export let onSelectSource: (sourceId: string) => void;

  type PlottedSource = {
    source: SourceEvaluation;
    labelIndex: number;
    complexityPercent: number;
    businessPercent: number;
    offsetX: number;
    offsetY: number;
  };

  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
  const normalize = (value: number) => clamp01((value - 1) / (5 - 1));

  const complexityToPercent = (complexity: number) => 12 + normalize(complexity) * 76;
  const businessToPercent = (business: number) => 88 - normalize(business) * 76;

  const getCollisionOffset = (sourceCountMap: Map<string, number>, key: string) => {
    const position = sourceCountMap.get(key) ?? 0;
    sourceCountMap.set(key, position + 1);

    const column = position % 4;
    const row = Math.floor(position / 4);
    return {
      x: (column - 1.5) * 6,
      y: row * 6,
    };
  };

  $: plottedSources = (() => {
    const occupancy = new Map<string, number>();
    return sources.map((source, index) => {
      const complexity = getPotentialComplexity(source);
      const complexityPercent = complexityToPercent(complexity);
      const businessPercent = businessToPercent(source.businessValue);
      const bucketX = Math.round(normalize(complexity) * 12);
      const bucketY = Math.round((1 - normalize(source.businessValue)) * 12);

      const { x: offsetX, y: offsetY } = getCollisionOffset(
        occupancy,
        `${bucketX}-${bucketY}`,
      );

      return {
        source,
        labelIndex: index + 1,
        complexityPercent,
        businessPercent,
        offsetX,
        offsetY,
      };
    });
  })();

  $: selectedSource =
    sources.find((source) => source.id === selectedSourceId) ?? sources[0];
  $: selectedComplexity = selectedSource
    ? getPotentialComplexity(selectedSource).toFixed(2)
    : null;
  $: selectedQuadrant = selectedSource
    ? getQuadrant(selectedSource)
    : "high-value-low-complexity";
</script>

<section class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
  <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-sm font-semibold text-slate-950">Cadran sources</h1>
      <p class="mt-1 text-xs text-slate-600">
        Valeur potentielle vs complexite incluant acces, risque legal et cout.
      </p>
    </div>
    <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
      <span>Y: valeur business</span>
      <span>X: complexite/cout</span>
    </div>
  </div>

  <div
    class="relative h-[440px] overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
  >
    <div class="absolute inset-6">
      <div class="relative h-full w-full">
        <div class="absolute left-0 right-0 top-1/2 h-px bg-slate-300"></div>
        <div class="absolute top-0 bottom-0 left-1/2 w-px bg-slate-300"></div>

        <div class="absolute -top-1 left-0 text-[10px] font-medium text-slate-500">
          Complexite faible
        </div>
        <div class="absolute -top-1 right-0 translate-x-2 text-[10px] font-medium text-slate-500">
          Complexite elevee
        </div>
        <div class="absolute left-0 top-0 -translate-y-5 text-[10px] font-medium text-slate-500">
          Valeur elevee
        </div>
        <div class="absolute left-0 bottom-0 translate-y-5 text-[10px] font-medium text-slate-500">
          Valeur faible
        </div>

        <div class="absolute left-2 top-2 text-[11px] font-semibold text-teal-800">
          {quadrantLabels["high-value-low-complexity"]}
        </div>
        <div class="absolute right-2 top-2 text-right text-[11px] font-semibold text-amber-800">
          {quadrantLabels["high-value-high-complexity"]}
        </div>
        <div class="absolute left-2 bottom-2 text-[11px] font-semibold text-slate-600">
          {quadrantLabels["low-value-low-complexity"]}
        </div>
        <div class="absolute right-2 bottom-2 text-right text-[11px] font-semibold text-rose-800">
          {quadrantLabels["low-value-high-complexity"]}
        </div>

        {#each plottedSources as plotted}
          {@const quadrant = getQuadrant(plotted.source)}
          {@const isSelected = plotted.source.id === selectedSourceId}
          <button
            type="button"
            class={`group absolute inline-flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold transition ${
              isSelected
                ? "z-20 border-teal-700 bg-teal-700 text-white shadow-lg"
                : "z-10 border-slate-200 bg-white text-slate-700 hover:border-teal-500"
            }`}
            style={`left: ${plotted.complexityPercent}%; top: ${plotted.businessPercent}%; transform: translate(-50%, -50%) translate(${plotted.offsetX}px, ${plotted.offsetY}px);`}
            title={`${plotted.source.name} - valeur ${plotted.source.businessValue}/5, complexite ${getPotentialComplexity(
              plotted.source,
            ).toFixed(2)}/5`}
            aria-label={`${plotted.source.name}, valeur ${plotted.source.businessValue}/5, complexite ${getPotentialComplexity(
              plotted.source,
            ).toFixed(2)}/5`}
            aria-pressed={isSelected}
            on:click={() => onSelectSource(plotted.source.id)}
          >
            {plotted.labelIndex}
            <span
              class="pointer-events-none invisible absolute left-1/2 top-full z-20 mt-2 w-52 -translate-x-1/2 rounded-md border border-slate-200 bg-white p-2 text-left text-[11px] leading-4 text-slate-700 shadow-sm transition-opacity opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
            >
              <span class="font-semibold">{plotted.source.name}</span>
              <span class="mt-1 block text-slate-500">
                {quadrantLabels[quadrant]}
              </span>
            </span>
          </button>
        {/each}
      </div>
    </div>

  </div>

  <div class="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2">
    <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      Source active
    </p>
    {#if selectedSource}
      <p class="mt-1 text-xs font-semibold text-slate-900">
        {selectedSource.name}
      </p>
      <p class="text-[11px] text-slate-600">
        {selectedComplexity} · {quadrantLabels[selectedQuadrant]}
      </p>
    {:else}
      <p class="text-xs text-slate-500">
        Selectionnez un point sur le cadran pour afficher le contexte.
      </p>
    {/if}
  </div>
  <div
    class="mt-2 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto pr-1 text-[11px] text-slate-600 sm:grid-cols-3"
  >
    {#each plottedSources as plotted}
      <button
        type="button"
        class={`inline-flex w-full max-w-full items-center gap-1 rounded border px-2 py-1 text-left ${
          plotted.source.id === selectedSourceId
            ? "border-teal-700 bg-teal-50 text-teal-800"
            : "border-slate-200 bg-white text-slate-700"
        }`}
        on:click={() => onSelectSource(plotted.source.id)}
      >
        <span class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-700">
          {plotted.labelIndex}
        </span>
        <span class="truncate">{plotted.source.name}</span>
      </button>
    {/each}
  </div>
</section>
