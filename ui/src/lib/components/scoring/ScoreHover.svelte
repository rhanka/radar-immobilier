<script lang="ts">
  import type { AxisScoreT } from "@radar/domain";
  import type { GrilleRow } from "$lib/scoring/grilles-data.js";

  /** The AxisScore envelope from the dossier. */
  export let axisScore: AxisScoreT;
  /** The corresponding GrilleRow (grid definition for this axis). */
  export let grid: GrilleRow;
  /** French display label for this axis. */
  export let axisLabel: string;

  function confidenceClass(c: string): string {
    if (c === "high") return "bg-emerald-100 text-emerald-700";
    if (c === "medium") return "bg-amber-100 text-amber-700";
    return "bg-slate-100 text-slate-500";
  }

  function confidenceLabel(c: string): string {
    if (c === "high") return "Haute";
    if (c === "medium") return "Moyenne";
    return "Faible";
  }
</script>

<div class="w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
  <!-- Header -->
  <div class="mb-2 flex items-center justify-between gap-2">
    <p class="text-sm font-semibold text-slate-950">{axisLabel}</p>
    {#if axisScore.availability === "non-disponible"}
      <span class="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
        Non disponible
      </span>
    {:else}
      <span class="shrink-0 rounded bg-teal-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
        Niveau {axisScore.level}/5
      </span>
    {/if}
  </div>

  <!-- Mini-grid: 6 levels 0–5 -->
  <div class="mb-3 space-y-0.5">
    {#each [0, 1, 2, 3, 4, 5] as lvl}
      <div
        class={`flex gap-2 rounded px-1.5 py-1 text-[11px] leading-4 ${
          axisScore.availability === "available" && axisScore.level === lvl
            ? "bg-teal-600 text-white"
            : "text-slate-600 odd:bg-slate-50"
        }`}
      >
        <span class="shrink-0 font-semibold">{lvl}</span>
        <span>{grid.levels[lvl as 0 | 1 | 2 | 3 | 4 | 5]}</span>
      </div>
    {/each}
  </div>

  <!-- Rationale -->
  {#if axisScore.rationale}
    <div class="mb-2 rounded bg-slate-50 px-2 py-1.5">
      <p class="text-[11px] italic leading-4 text-slate-600">{axisScore.rationale}</p>
    </div>
  {/if}

  <!-- Metadata footer -->
  <div class="flex flex-wrap items-center gap-1.5">
    <span
      class={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${confidenceClass(axisScore.confidence)}`}
    >
      Confiance : {confidenceLabel(axisScore.confidence)}
    </span>
    <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
      Grille {axisScore.gridVersion}
    </span>
  </div>
</div>
