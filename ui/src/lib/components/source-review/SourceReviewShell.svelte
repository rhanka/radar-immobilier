<script lang="ts">
  import { ArrowLeft, LayoutDashboard } from "@lucide/svelte";
  import ChallengeResultsPanel from "./ChallengeResultsPanel.svelte";
  import CriteriaGlossary from "./CriteriaGlossary.svelte";
  import RecommendationBoard from "./RecommendationBoard.svelte";
  import SourceDeepDive from "./SourceDeepDive.svelte";
  import SourceQuadrant from "./SourceQuadrant.svelte";
  import { sourceEvaluations } from "$lib/source-review/source-evaluation-data";

  export let onBackToRadar: () => void;

  let selectedSourceId = "avis-publics-valleyfield";
  let activePanel: "sources" | "challenge" = "sources";

  $: selectedSource =
    sourceEvaluations.find((source) => source.id === selectedSourceId) ??
    sourceEvaluations[0];
</script>

<div class="min-h-screen bg-slate-100 text-slate-950">
  <header class="border-b border-slate-200 bg-white">
    <div class="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide text-teal-700">
          Proposition client - sources
        </p>
        <h1 class="mt-1 text-2xl font-bold text-slate-950">
          Revue valeur / complexite des sources
        </h1>
        <p class="mt-1 max-w-3xl text-sm text-slate-600">
          Lecture alignee sur la VISION: signaux faibles, faux positifs, apprentissage
          historique, couts d'acces et attendus client.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div class="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            class={`rounded px-3 py-2 text-sm font-semibold ${
              activePanel === "sources"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-600 hover:text-slate-950"
            }`}
            on:click={() => {
              activePanel = "sources";
            }}
          >
            Evaluation sources
          </button>
          <button
            type="button"
            class={`rounded px-3 py-2 text-sm font-semibold ${
              activePanel === "challenge"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-600 hover:text-slate-950"
            }`}
            on:click={() => {
              activePanel = "challenge";
            }}
          >
            Challenge agents
          </button>
        </div>

        <button
          type="button"
          class="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-teal-500"
          on:click={onBackToRadar}
        >
          <ArrowLeft class="h-4 w-4" aria-hidden="true" />
          Radar demo
        </button>
      </div>
    </div>
  </header>

  {#if activePanel === "sources"}
    <main class="grid gap-4 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div class="space-y-4">
        <CriteriaGlossary />
        <SourceQuadrant
          sources={sourceEvaluations}
          {selectedSourceId}
          onSelectSource={(sourceId) => {
            selectedSourceId = sourceId;
          }}
        />
        {#if selectedSource}
          <SourceDeepDive source={selectedSource} />
        {/if}
      </div>

      <div class="space-y-4">
        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div class="mb-3 flex items-center gap-2">
            <LayoutDashboard class="h-4 w-4 text-teal-700" aria-hidden="true" />
            <h2 class="text-sm font-semibold text-slate-950">Mode revue ecran</h2>
          </div>
          <p class="text-sm leading-6 text-slate-700">
            Cette v0 est faite pour etre corrigee visuellement: placement des sources,
            libelles, couts, attendus client et exemples concrets.
          </p>
        </div>

        <RecommendationBoard
          sources={sourceEvaluations}
          {selectedSourceId}
          onSelectSource={(sourceId) => {
            selectedSourceId = sourceId;
          }}
        />
      </div>
    </main>
  {:else}
    <main class="px-5 py-5">
      <ChallengeResultsPanel />
    </main>
  {/if}
</div>
