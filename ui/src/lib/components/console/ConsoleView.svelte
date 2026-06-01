<script lang="ts">
  import { Search, Microscope, BarChart2, ListChecks, Zap } from "@lucide/svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import QualificationTab from "./QualificationTab.svelte";
  import DeepDiveTab from "./DeepDiveTab.svelte";
  import JobsTab from "./JobsTab.svelte";
  import SourceContributionTab from "./SourceContributionTab.svelte";
  import AutomationView from "$lib/components/automation/AutomationView.svelte";

  // S3-B1 : onglet "Cadran sources" supprimé — cadran fusionné dans QualificationTab
  // ÉV14 : "Automatisation" intégrée comme onglet (ex-vue de nav supprimée).
  type TabId =
    | "qualification"
    | "deepdive"
    | "contribution"
    | "jobs"
    | "automation";

  const tabs: { id: TabId; label: string; hint: string; icon: typeof Search }[] = [
    {
      id: "qualification",
      label: "Qualification",
      hint: "Évaluation et priorisation du catalogue de sources.",
      icon: Search,
    },
    {
      id: "deepdive",
      label: "Approfondissement",
      hint: "Détail d'accès et de couverture par source.",
      icon: Microscope,
    },
    {
      id: "contribution",
      label: "Contribution",
      hint: "Apport de chaque source au faisceau de preuves.",
      icon: BarChart2,
    },
    {
      id: "jobs",
      label: "Jobs",
      hint: "Exécutions unitaires : historique des runs d'ingestion et de scoring.",
      icon: ListChecks,
    },
    {
      id: "automation",
      label: "Automatisation",
      hint: "Cadences et connecteurs qui planifient ces jobs.",
      icon: Zap,
    },
  ];

  let activeTab: TabId = "qualification";

  $: activeHint = tabs.find((t) => t.id === activeTab)?.hint ?? "";
</script>

<ViewLayout>
  <!-- ── Bande laterale gauche : selection d'onglet (liste verticale) ───── -->
  <svelte:fragment slot="controls">
    <div class="space-y-5 p-4">
      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Sources & opérations
        </p>
        <div class="space-y-1.5">
          {#each tabs as tab}
            {@const Icon = tab.icon}
            <button
              type="button"
              class={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${
                activeTab === tab.id
                  ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-700 hover:border-teal-400 hover:bg-slate-50"
              }`}
              aria-current={activeTab === tab.id ? "true" : undefined}
              on:click={() => { activeTab = tab.id; }}
            >
              <Icon class="h-4 w-4 shrink-0" aria-hidden="true" />
              {tab.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          À propos de cet onglet
        </p>
        <p class="mt-1.5 text-sm leading-6 text-slate-600">
          {activeHint}
        </p>
      </div>
    </div>
  </svelte:fragment>

  <!-- ── Contenu principal : onglet actif ───────────────────────────────── -->
  <section class="min-h-full bg-slate-50 p-6">
    <!-- En-tête -->
    <header class="mb-6">
      <h1 class="text-2xl font-semibold tracking-normal text-slate-950">
        {tabs.find((t) => t.id === activeTab)?.label ?? "Sources"}
      </h1>
      <p class="mt-1 text-sm text-slate-500">{activeHint}</p>
    </header>

    <!-- Contenu du tab actif -->
    {#if activeTab === "qualification"}
      <QualificationTab />
    {:else if activeTab === "deepdive"}
      <DeepDiveTab />
    {:else if activeTab === "contribution"}
      <SourceContributionTab />
    {:else if activeTab === "jobs"}
      <JobsTab />
    {:else}
      <AutomationView />
    {/if}
  </section>
</ViewLayout>
