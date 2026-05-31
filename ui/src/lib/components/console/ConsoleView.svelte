<script lang="ts">
  import { Terminal } from "@lucide/svelte";
  import QualificationTab from "./QualificationTab.svelte";
  import DeepDiveTab from "./DeepDiveTab.svelte";
  import JobsTab from "./JobsTab.svelte";

  // S3-B1 : onglet "Cadran sources" supprimé — cadran fusionné dans QualificationTab
  type TabId = "qualification" | "deepdive" | "jobs";

  const tabs: { id: TabId; label: string }[] = [
    { id: "qualification", label: "Qualification" },
    { id: "deepdive", label: "Approfondissement" },
    { id: "jobs", label: "Jobs" },
  ];

  let activeTab: TabId = "qualification";
</script>

<section class="min-h-full bg-slate-50 p-6">
  <!-- En-tête -->
  <header class="mb-6">
    <div class="flex items-center gap-2">
      <Terminal class="h-5 w-5 text-teal-700" aria-hidden="true" />
      <p class="text-xs font-semibold uppercase tracking-wide text-teal-700">
        Console opérations, Radar Immobilier
      </p>
    </div>
    <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
      Console sources & jobs
    </h1>
    <p class="mt-1 text-sm text-slate-500">
      Qualification des sources (évaluation, approfondissement et priorisation du catalogue) et supervision des jobs d'ingestion et de scoring.
    </p>
  </header>

  <!-- Barre de tabs -->
  <div class="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm w-fit">
    {#each tabs as tab}
      <button
        type="button"
        class={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
          activeTab === tab.id
            ? "bg-teal-600 text-white shadow-sm"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
        }`}
        aria-pressed={activeTab === tab.id}
        on:click={() => { activeTab = tab.id; }}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Contenu du tab actif -->
  {#if activeTab === "qualification"}
    <QualificationTab />
  {:else if activeTab === "deepdive"}
    <DeepDiveTab />
  {:else}
    <JobsTab />
  {/if}
</section>
