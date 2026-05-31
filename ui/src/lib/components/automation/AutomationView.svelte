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
  import { Badge, Button } from "@sentropic/design-system-svelte";
  import {
    TREATMENTS,
    CONNECTORS,
    STATUS_LABELS_FR,
    benchmarkRecap,
  } from "$lib/automation/automation-data.js";
  import type { TreatmentKind } from "$lib/automation/automation-data.js";
  import Acronym from "$lib/components/Acronym.svelte";
  import { getAcronym } from "$lib/glossary/acronyms.js";
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

  function statusBadgeTone(status: string): "neutral" | "warning" | "success" {
    if (status === "connecte") return "success";
    if (status === "manuel") return "warning";
    return "neutral";
  }

  /**
   * Extract acronym tokens from a connector label for wrapping.
   * Only wraps discrete tokens that are known acronyms (e.g. "BDZI", "GRHQ").
   * Returns array of parts: { text, isAcronym }.
   */
  function splitLabelAcronyms(label: string): Array<{ text: string; isAcronym: boolean }> {
    const parts: Array<{ text: string; isAcronym: boolean }> = [];
    // Tokenize by spaces and common separators, preserving them
    const tokens = label.split(/(\s*\/\s*|\s+)/);
    for (const token of tokens) {
      const trimmed = token.trim();
      if (trimmed && getAcronym(trimmed)) {
        parts.push({ text: trimmed, isAcronym: true });
      } else {
        parts.push({ text: token, isAcronym: false });
      }
    }
    return parts;
  }
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
      <Button
        variant={activeTab === tab.id ? "primary" : "ghost"}
        size="sm"
        type="button"
        onclick={() => { activeTab = tab.id; }}
      >
        {tab.label}
      </Button>
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
              <Badge tone="success">
                <Clock class="h-3 w-3" aria-hidden="true" />
                {treatment.cadence}
              </Badge>
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
              <td class="p-3 font-medium text-slate-800">
                {#each splitLabelAcronyms(connector.label) as part}
                  {#if part.isAcronym}<Acronym term={part.text} />{:else}{part.text}{/if}
                {/each}
              </td>
              <td class="p-3">
                <Badge tone={statusBadgeTone(connector.status)}>
                  {STATUS_LABELS_FR[connector.status]}
                </Badge>
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
                  <Badge tone="error">
                    <ShieldAlert class="h-3 w-3" aria-hidden="true" /> Fabrications détectées
                  </Badge>
                {:else}
                  <Badge tone="success">
                    <ShieldCheck class="h-3 w-3" aria-hidden="true" /> Aucune
                  </Badge>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <p class="text-xs text-slate-500">
      Pour le détail métrique (M1-M7), les notes par piste et le verdict complet →
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onclick={() => { activeTab = "comparaison"; }}
      >
        Voir la comparaison détaillée
      </Button>.
    </p>
  {:else}
    <!-- Comparaison détaillée (BenchmarkComparison intégrée) --------------->
    <BenchmarkComparison />
  {/if}
</section>
