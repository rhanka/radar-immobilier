<script lang="ts">
  import {
    Rocket,
    RefreshCw,
    Microscope,
    Plug,
    Clock,
    AlertTriangle,
    ShieldAlert,
    ShieldCheck,
    BarChart3,
  } from "@lucide/svelte";
  import {
    TREATMENTS,
    CONNECTORS,
    STATUS_LABELS_FR,
    benchmarkRecap,
  } from "$lib/automation/automation-data.js";
  import type { TreatmentKind } from "$lib/automation/automation-data.js";
  import BenchmarkComparison from "$lib/components/comparison/BenchmarkComparison.svelte";

  type AutoTabId = "cadences" | "comparaison";

  const autoTabs: { id: AutoTabId; label: string }[] = [
    { id: "cadences", label: "Cadences & connecteurs" },
    { id: "comparaison", label: "Comparaison détaillée" },
  ];

  let activeTab: AutoTabId = "cadences";

  const recap = benchmarkRecap();

  const kindIcons: Record<TreatmentKind, typeof Rocket> = {
    initial: Rocket,
    recurrent: RefreshCw,
    approfondissement: Microscope,
  };

  const statusColors: Record<string, string> = {
    "a-venir": "bg-slate-100 text-slate-600",
    manuel: "bg-amber-100 text-amber-700",
    connecte: "bg-teal-100 text-teal-700",
  };
</script>

<section class="min-h-full bg-slate-50 p-6">
  <!-- Header ---------------------------------------------------------------->
  <header class="mb-6">
    <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
      Automatisation & traitements continus
    </h1>
    <p class="mt-1 text-sm text-slate-500">
      Le radar tourne en continu : traitement initial au démarrage, enrichissement récurrent quotidien et approfondissement à la demande.
    </p>
  </header>

  <!-- Barre de tabs --------------------------------------------------------->
  <div class="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm w-fit">
    {#each autoTabs as tab}
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

  {#if activeTab === "cadences"}
    <!-- Treatment cadence cards -------------------------------------------->
    <h2 class="mb-3 text-base font-semibold text-slate-950">Cadences de traitement</h2>
    <div class="mb-8 grid gap-4 sm:grid-cols-3">
      {#each TREATMENTS as treatment}
        {@const Icon = kindIcons[treatment.kind]}
        <article class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-3 flex items-start gap-3">
            <span class="rounded-md bg-teal-50 p-2 shrink-0">
              <Icon class="h-5 w-5 text-teal-600" aria-hidden="true" />
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-slate-950">{treatment.title}</h3>
              <span class="mt-1 inline-flex items-center gap-1 rounded bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-700">
                <Clock class="h-3 w-3" aria-hidden="true" />
                {treatment.cadence}
              </span>
            </div>
          </div>
          <p class="text-xs leading-5 text-slate-600">{treatment.description}</p>
          <p class="mt-3 flex items-start gap-1.5 text-[11px] text-slate-500">
            <span class="mt-0.5 shrink-0 font-semibold text-slate-400">Déclencheur</span>
            <span>{treatment.trigger}</span>
          </p>
        </article>
      {/each}
    </div>

    <!-- Connectors list ---------------------------------------------------->
    <div class="mb-3 flex items-center gap-2">
      <Plug class="h-4 w-4 text-teal-600" aria-hidden="true" />
      <h2 class="text-base font-semibold text-slate-950">Sources & connecteurs</h2>
    </div>

    <!-- Demo disclaimer -->
    <div class="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <p class="text-xs leading-5 text-amber-800">
        <span class="font-semibold">Démo :</span> connecteurs non branchés ; orchestration réelle à venir (côté serveur).
      </p>
    </div>

    <div class="mb-8 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-slate-200 bg-slate-50 text-left">
            <th class="p-3 font-semibold text-slate-950">Source</th>
            <th class="p-3 font-semibold text-slate-950">Statut</th>
            <th class="p-3 font-medium text-slate-600">Note</th>
          </tr>
        </thead>
        <tbody>
          {#each CONNECTORS as connector}
            <tr class="border-b border-slate-100 last:border-0">
              <td class="p-3 font-medium text-slate-800">{connector.label}</td>
              <td class="p-3">
                <span class={`rounded px-2 py-0.5 text-[11px] font-semibold ${statusColors[connector.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {STATUS_LABELS_FR[connector.status]}
                </span>
              </td>
              <td class="p-3 text-xs text-slate-500">{connector.note ?? ""}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Benchmark recap ---------------------------------------------------->
    <div class="mb-3 flex items-center gap-2">
      <BarChart3 class="h-4 w-4 text-teal-600" aria-hidden="true" />
      <h2 class="text-base font-semibold text-slate-950">Récapitulatif benchmark : 4 agents</h2>
    </div>
    <p class="mb-4 text-sm text-slate-500">
      Classement honnête issu du benchmark Salaberry-de-Valleyfield. Aucune valeur inventée.
    </p>

    <div class="mb-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-slate-200 bg-slate-50 text-left">
            <th class="p-3 text-center font-semibold text-slate-950">Rang</th>
            <th class="p-3 font-semibold text-slate-950">Nom</th>
            <th class="p-3 font-medium text-slate-600">Opérateur</th>
            <th class="p-3 text-center font-semibold text-slate-950">Total /35</th>
            <th class="p-3 font-medium text-slate-600">Fabrication</th>
          </tr>
        </thead>
        <tbody>
          {#each recap as entry}
            <tr class="border-b border-slate-100 last:border-0">
              <td class="p-3 text-center text-base font-bold text-slate-950">#{entry.rank}</td>
              <td class="p-3 font-medium text-slate-800">{entry.name}</td>
              <td class="p-3 text-xs text-slate-500 capitalize">{entry.operator}</td>
              <td class="p-3 text-center text-base font-semibold text-slate-950">{entry.total}</td>
              <td class="p-3">
                {#if entry.fabrication === "multiple"}
                  <span class="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                    <ShieldAlert class="h-3 w-3" aria-hidden="true" /> Fabrications détectées
                  </span>
                {:else}
                  <span class="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    <ShieldCheck class="h-3 w-3" aria-hidden="true" /> Aucune
                  </span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <p class="text-xs text-slate-500">
      Pour le détail métrique (M1-M7), les notes par piste et le verdict complet →
      <button
        type="button"
        class="font-medium text-teal-700 underline underline-offset-2 hover:text-teal-900"
        on:click={() => { activeTab = "comparaison"; }}
      >
        Voir la comparaison détaillée
      </button>.
    </p>
  {:else}
    <!-- Comparaison détaillée (BenchmarkComparison intégrée) --------------->
    <BenchmarkComparison />
  {/if}
</section>
