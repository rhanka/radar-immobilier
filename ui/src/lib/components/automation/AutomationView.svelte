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
    Play,
    Loader2,
    ExternalLink,
    FileText,
    Zap,
  } from "@lucide/svelte";
  import { Badge, Button } from "@sentropic/design-system-svelte";
  import {
    TREATMENTS,
    CONNECTORS,
    STATUS_LABELS_FR,
    benchmarkRecap,
    connectorActionHint,
  } from "$lib/automation/automation-data.js";
  import type { TreatmentKind, Connector } from "$lib/automation/automation-data.js";
  import { runCollect, avisTypeLabel } from "$lib/automation/collect.js";
  import type { CollectView } from "$lib/automation/collect.js";
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
    reel: "bg-emerald-100 text-emerald-700",
  };

  function statusBadgeTone(
    status: string,
  ): "neutral" | "warning" | "success" | "info" {
    if (status === "reel") return "success";
    if (status === "connecte") return "success";
    if (status === "manuel") return "warning";
    return "neutral";
  }

  // EV11: REAL collection state, keyed by connector id.
  let collecting: Record<string, boolean> = {};
  let results: Record<string, CollectView> = {};

  async function launchCollect(connector: Connector): Promise<void> {
    if (!connector.realCollectSource) return;
    collecting = { ...collecting, [connector.id]: true };
    try {
      const view = await runCollect(connector.realCollectSource);
      results = { ...results, [connector.id]: view };
    } finally {
      collecting = { ...collecting, [connector.id]: false };
    }
  }

  function formatFetchedAt(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("fr-CA", {
      dateStyle: "medium",
      timeStyle: "short",
    });
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

<div>
  <!-- Titre de section (H1 du contenu de l'onglet) -->
  <h1 class="sr-only">Automatisation et traitements continus</h1>

  <!-- Clarification Jobs vs Automatisation (ÉV14) --------------------------->
  <div class="mb-6 flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3">
    <Zap class="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
    <p class="text-xs leading-5 text-teal-800">
      <span class="font-semibold">Jobs</span> = exécutions unitaires (historique des runs d'ingestion et de scoring, onglet « Jobs »).
      <span class="font-semibold">Automatisation</span> = cadences et connecteurs qui <span class="font-semibold">planifient</span> ces jobs.
      Le radar tourne en continu : traitement initial au démarrage, enrichissement récurrent quotidien et approfondissement à la demande.
    </p>
  </div>

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

    <!-- Status disclaimer : honest per-connector status (no « simulé ») -->
    <div class="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
      <ShieldCheck class="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
      <p class="text-xs leading-5 text-emerald-800">
        <span class="font-semibold">Statut réel par connecteur :</span> le connecteur
        <span class="font-semibold">« Avis publics municipaux »</span> est
        <span class="font-semibold">RÉEL</span> (il interroge la page publique de
        Salaberry-de-Valleyfield côté serveur, sans clé, et affiche les avis réellement publiés).
        Les sources <span class="font-semibold">« Manuel »</span> sont alimentées par un apport
        manuel à l'onboarding ; les sources <span class="font-semibold">« À venir »</span> sont des
        intégrations planifiées, non encore branchées. Aucune donnée n'est simulée.
      </p>
    </div>

    <div class="mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-slate-200 bg-slate-50 text-left">
            <th class="p-3 font-semibold text-slate-950">Source</th>
            <th class="p-3 font-semibold text-slate-950">Statut</th>
            <th class="p-3 font-medium text-slate-600">Note</th>
            <th class="p-3 font-medium text-slate-600">Action</th>
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
              <td class="p-3">
                {#if connector.realCollectSource}
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    disabled={collecting[connector.id]}
                    onclick={() => launchCollect(connector)}
                  >
                    {#if collecting[connector.id]}
                      <Loader2 class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Collecte en cours…
                    {:else}
                      <Play class="h-3.5 w-3.5" aria-hidden="true" />
                      Lancer la collecte
                    {/if}
                  </Button>
                {:else}
                  <span class="text-xs italic text-slate-400">{connectorActionHint(connector)}</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- REAL collection results (ÉV11) ------------------------------------->
    {#each CONNECTORS as connector}
      {#if connector.realCollectSource && results[connector.id]}
        {@const view = results[connector.id]}
        <div class="mb-8 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          {#if view.kind === "error"}
            <div class="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
              <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
              <div>
                <p class="text-sm font-semibold text-rose-800">{view.label}</p>
                <p class="mt-0.5 text-xs text-rose-700">{view.detail}</p>
              </div>
            </div>
          {:else}
            <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <Badge tone="success">
                  <ShieldCheck class="h-3 w-3" aria-hidden="true" /> RÉEL
                </Badge>
                <h3 class="text-sm font-semibold text-slate-950">
                  {view.result.count} avis collectés en direct
                </h3>
              </div>
              <a
                class="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline"
                href={view.result.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink class="h-3 w-3" aria-hidden="true" /> Source publique
              </a>
            </div>
            <p class="mb-4 text-xs text-slate-500">
              Collecté le {formatFetchedAt(view.result.fetchedAt)} · données issues de la source,
              aucune valeur inventée.
            </p>
            <ul class="divide-y divide-slate-100">
              {#each view.result.items as item}
                <li class="flex items-start gap-3 py-2.5">
                  <FileText class="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <div class="min-w-0 flex-1">
                    <a
                      class="block truncate text-sm font-medium text-slate-800 hover:text-teal-700 hover:underline"
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={item.title}
                    >
                      {item.title}
                    </a>
                    <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <Badge tone="neutral">{avisTypeLabel(item.type)}</Badge>
                      <span>{item.dateLabel}</span>
                      {#each item.bylaws as bylaw}
                        <Badge tone="info">Règl. {bylaw}</Badge>
                      {/each}
                    </div>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    {/each}

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
</div>
