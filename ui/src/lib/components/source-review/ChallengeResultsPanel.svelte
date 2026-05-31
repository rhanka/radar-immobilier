<script lang="ts">
  import { AlertTriangle, Bot, CheckCircle2 } from "@lucide/svelte";
  import { challengeAgentResults } from "$lib/source-review/source-challenge-results";
</script>

<section class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
  <div class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
    <div>
      <p class="text-xs font-semibold uppercase tracking-wide text-teal-700">
        Presentation separee
      </p>
      <h1 class="mt-1 text-xl font-bold text-slate-950">
        Challenge agents sur les sources client
      </h1>
      <p class="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
        Lecture contradictoire de PROMPT.md, VISION.md, PROCESS.md et des spikes
        BR05. Les points ci-dessous servent a challenger le cadrage commercial,
        pas a remplacer la matrice source par source.
      </p>
    </div>
    <div class="rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white">
      {challengeAgentResults.length} agents
    </div>
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-3">
    {#each challengeAgentResults as result}
      <article class="rounded-md border border-slate-200 p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-start gap-2">
            <Bot class="mt-0.5 h-4 w-4 text-teal-700" aria-hidden="true" />
            <div>
              <h2 class="text-sm font-semibold text-slate-950">{result.name}</h2>
              <p class="mt-0.5 text-xs text-slate-500">{result.modelNote}</p>
            </div>
          </div>
          {#if result.status === "complete"}
            <span
              class="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800"
            >
              <CheckCircle2 class="h-3 w-3" aria-hidden="true" />
              complet
            </span>
          {:else}
            <span
              class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800"
            >
              <AlertTriangle class="h-3 w-3" aria-hidden="true" />
              partiel
            </span>
          {/if}
        </div>

        <p class="mt-3 text-xs font-semibold uppercase text-slate-500">Focus</p>
        <p class="mt-1 text-sm leading-6 text-slate-700">{result.focus}</p>

        <p class="mt-3 rounded-md bg-slate-950 p-3 text-sm font-semibold leading-6 text-white">
          {result.strongestChallenge}
        </p>

        <div class="mt-3">
          <h3 class="text-sm font-semibold text-slate-950">Constats</h3>
          <ul class="mt-2 space-y-2 text-sm leading-6 text-slate-700">
            {#each result.findings as finding}
              <li>{finding}</li>
            {/each}
          </ul>
        </div>

        <div class="mt-3 rounded-md bg-teal-50 p-3">
          <h3 class="text-sm font-semibold text-teal-950">A faire (reco)</h3>
          <ul class="mt-2 space-y-2 text-sm leading-6 text-slate-700">
            {#each result.recommendedActions as action}
              <li>{action}</li>
            {/each}
          </ul>
        </div>

        <div class="mt-3 rounded-md bg-amber-50 p-3">
          <h3 class="text-sm font-semibold text-amber-950">Attendus client</h3>
          <ul class="mt-2 space-y-2 text-sm leading-6 text-slate-700">
            {#each result.clientExpected as item}
              <li>{item}</li>
            {/each}
          </ul>
        </div>

        <div class="mt-3">
          <h3 class="text-sm font-semibold text-slate-950">Preuves / traces</h3>
          <dl class="mt-2 space-y-2 text-xs leading-5">
            {#each result.evidence as evidence}
              <div class="rounded-md bg-slate-50 p-2">
                <dt class="font-semibold text-slate-900">{evidence.label}</dt>
                <dd class="mt-1 text-slate-600">{evidence.detail}</dd>
              </div>
            {/each}
          </dl>
        </div>
      </article>
    {/each}
  </div>
</section>
