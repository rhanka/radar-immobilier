<script lang="ts">
  import { Trophy, ShieldCheck, ShieldAlert, ScrollText } from "@lucide/svelte";
  import {
    benchmarkMetrics,
    benchmarkTracks,
    benchmarkVerdict,
    benchmarkMethod,
  } from "$lib/demo/benchmark-data";

  const ranked = [...benchmarkTracks].sort((a, b) => a.rank - b.rank);
  const medals: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
</script>

<section class="min-h-full bg-slate-50 p-6">
  <header class="mb-5">
    <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
      Restitution : benchmark multi-agents
    </p>
    <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
      Comparaison des 4 analyses du PROMPT, Salaberry-de-Valleyfield
    </h1>
    <p class="mt-1 text-sm text-slate-500">
      Même prompt, modes d'exécution tracés, runs isolés, scoring neutre, sans tricher vs l'humain.
    </p>
  </header>

  <!-- Ranking cards -->
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {#each ranked as track}
      <article
        class={`rounded-lg border bg-white p-4 shadow-sm ${
          track.rank === 1 ? "border-amber-300 ring-1 ring-amber-200" : "border-slate-200"
        }`}
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-slate-950">
              {medals[track.rank] ?? `#${track.rank}`} {track.name}
            </p>
            <p class="mt-0.5 text-xs text-slate-500">{track.mode}</p>
          </div>
          <div class="shrink-0 rounded-md bg-slate-900 px-2 py-1 text-sm font-semibold text-white">
            {track.total}<span class="text-xs font-normal text-slate-300">/35</span>
          </div>
        </div>
        <div class="mt-2">
          {#if track.fabrication === "none"}
            <span class="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              <ShieldCheck class="h-3 w-3" aria-hidden="true" /> Aucune fabrication
            </span>
          {:else}
            <span class="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
              <ShieldAlert class="h-3 w-3" aria-hidden="true" /> Fabrications
            </span>
          {/if}
        </div>
        <p class="mt-2 text-xs leading-5 text-slate-600">{track.note}</p>
      </article>
    {/each}
  </div>

  <!-- Score matrix -->
  <div class="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
    <table class="w-full border-collapse text-sm">
      <thead>
        <tr class="border-b border-slate-200 bg-slate-50 text-left">
          <th class="p-3 font-semibold text-slate-950">Track</th>
          {#each benchmarkMetrics as metric}
            <th class="p-3 text-center font-medium text-slate-600" title={metric.hint}>
              <span class="block text-xs font-semibold text-slate-900">{metric.id}</span>
              <span class="block text-[10px] font-normal leading-3 text-slate-500">{metric.label}</span>
            </th>
          {/each}
          <th class="p-3 text-center font-semibold text-slate-950">/35</th>
        </tr>
      </thead>
      <tbody>
        {#each ranked as track}
          <tr class="border-b border-slate-100 last:border-0">
            <td class="p-3">
              <span class="font-semibold text-slate-950">{medals[track.rank] ?? ""} {track.id}</span>
              <span class="ml-1 text-xs text-slate-500">{track.name}</span>
            </td>
            {#each track.scores as score}
              <td class="p-3 text-center">
                <span
                  class={`inline-block w-7 rounded ${
                    score >= 5
                      ? "bg-emerald-100 text-emerald-800"
                      : score >= 3
                        ? "bg-amber-100 text-amber-800"
                        : "bg-red-100 text-red-700"
                  } py-0.5 text-xs font-semibold`}
                >
                  {score}
                </span>
              </td>
            {/each}
            <td class="p-3 text-center text-base font-semibold text-slate-950">{track.total}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Verdict -->
  <div class="mt-6 flex gap-3 rounded-lg border border-teal-200 bg-teal-50 p-4">
    <Trophy class="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
    <div>
      <h2 class="text-sm font-semibold text-slate-950">Verdict honnête</h2>
      <p class="mt-1 text-sm leading-6 text-slate-700">{benchmarkVerdict}</p>
    </div>
  </div>

  <!-- Methodology -->
  <div class="mt-4 rounded-lg border border-slate-200 bg-white p-4">
    <div class="flex items-center gap-2">
      <ScrollText class="h-4 w-4 text-slate-600" aria-hidden="true" />
      <h2 class="text-sm font-semibold text-slate-950">Méthode (anti-triche)</h2>
    </div>
    <ul class="mt-2 space-y-1">
      {#each benchmarkMethod as item}
        <li class="flex gap-2 text-xs leading-5 text-slate-600">
          <span class="mt-0.5 text-teal-700">•</span><span>{item}</span>
        </li>
      {/each}
    </ul>
  </div>
</section>
