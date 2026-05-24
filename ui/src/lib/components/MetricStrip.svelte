<script lang="ts">
  import { CalendarDays, Gauge, Radar, Target } from "@lucide/svelte";
  import type { DashboardMetrics } from "$lib/demo/radar-demo-data";

  export let metrics: DashboardMetrics;
</script>

<section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicateurs radar">
  <article class="rounded-md border border-slate-200 bg-white p-4">
    <div class="flex items-center gap-2 text-sm text-slate-500">
      <Radar class="h-4 w-4 text-teal-700" aria-hidden="true" />
      Signaux actifs
    </div>
    <p class="mt-3 text-2xl font-semibold text-slate-950">{metrics.activeSignals}</p>
  </article>

  <article class="rounded-md border border-slate-200 bg-white p-4">
    <div class="flex items-center gap-2 text-sm text-slate-500">
      <Target class="h-4 w-4 text-blue-700" aria-hidden="true" />
      Potentiel eleve
    </div>
    <p class="mt-3 text-2xl font-semibold text-slate-950">{metrics.highPotentialSignals}</p>
  </article>

  <article class="rounded-md border border-slate-200 bg-white p-4">
    <div class="flex items-center gap-2 text-sm text-slate-500">
      <Gauge class="h-4 w-4 text-amber-700" aria-hidden="true" />
      Meilleur score
    </div>
    <p class="mt-3 text-2xl font-semibold text-slate-950">{metrics.topScore}</p>
  </article>

  <article class="rounded-md border border-slate-200 bg-white p-4">
    <div class="flex items-center gap-2 text-sm text-slate-500">
      <CalendarDays class="h-4 w-4 text-rose-700" aria-hidden="true" />
      Prochain jalon
    </div>
    <p class="mt-3 text-sm font-semibold leading-5 text-slate-950">
      {metrics.nextMilestone}
    </p>
  </article>
</section>
