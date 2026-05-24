<script lang="ts">
  import { ArrowUpRight, CheckCircle2, FileSearch } from "@lucide/svelte";
  import type { RadarOpportunity, RadarSignal } from "$lib/demo/radar-demo-data";

  export let opportunity: RadarOpportunity;
  export let selectedSignal: RadarSignal;
</script>

<section class="flex min-h-0 flex-col rounded-md border border-slate-200 bg-white">
  <div class="border-b border-slate-200 p-5">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
          Opportunite prioritaire
        </p>
        <h2 class="mt-2 text-xl font-semibold tracking-normal text-slate-950">
          {opportunity.title}
        </h2>
        <p class="mt-1 text-sm text-slate-500">{opportunity.address}</p>
      </div>
      <div class="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-center">
        <p class="text-xs text-amber-700">Score</p>
        <p class="text-2xl font-semibold text-amber-900">{opportunity.score}</p>
      </div>
    </div>
  </div>

  <div class="grid min-h-0 flex-1 gap-4 overflow-auto p-5 lg:grid-cols-[1fr_0.8fr]">
    <div class="space-y-4">
      <div>
        <h3 class="text-sm font-semibold text-slate-950">Signal selectionne</h3>
        <div class="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-semibold text-slate-950">{selectedSignal.title}</p>
              <p class="mt-1 text-xs text-slate-500">{selectedSignal.evidenceLabel}</p>
            </div>
            <span class="rounded-md bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">
              {Math.round(selectedSignal.confidence * 100)} %
            </span>
          </div>
          <p class="mt-3 text-sm leading-6 text-slate-700">{selectedSignal.summary}</p>
        </div>
      </div>

      <div>
        <h3 class="text-sm font-semibold text-slate-950">Potentiel</h3>
        <p class="mt-2 text-sm leading-6 text-slate-700">{opportunity.densityPotential}</p>
      </div>

      <div>
        <h3 class="text-sm font-semibold text-slate-950">Contraintes a verifier</h3>
        <ul class="mt-2 space-y-2">
          {#each opportunity.constraints as constraint}
            <li class="flex gap-2 text-sm text-slate-700">
              <CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
              <span>{constraint}</span>
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <div class="rounded-md border border-slate-200 bg-slate-50 p-4">
      <div class="flex items-center gap-2">
        <FileSearch class="h-4 w-4 text-slate-600" aria-hidden="true" />
        <h3 class="text-sm font-semibold text-slate-950">Preuves</h3>
      </div>
      <div class="mt-4 space-y-2">
        {#each opportunity.evidence as evidence}
          <div class="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm text-slate-700">
            <span>{evidence}</span>
            <ArrowUpRight class="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          </div>
        {/each}
      </div>
      <p class="mt-4 text-xs leading-5 text-slate-500">{selectedSignal.timingLabel}</p>
    </div>
  </div>
</section>
