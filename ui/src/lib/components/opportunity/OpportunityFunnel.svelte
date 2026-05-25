<script lang="ts">
  import { ExternalLink, TrendingUp } from "@lucide/svelte";
  import {
    valleyfieldDossiers,
    weightedScore,
    PROCESS_WEIGHTS,
    type OpportunityDossierT,
    type EvidenceItemT,
  } from "@radar/domain";

  const PHASES: Array<{ id: string; label: string }> = [
    { id: "signal", label: "Signal réglementaire" },
    { id: "ancrage", label: "Ancrage cadastral" },
    { id: "contraintes", label: "Contraintes géo" },
    { id: "marche", label: "Marché" },
    { id: "contexte", label: "Contexte" },
    { id: "scoring", label: "Scoring" },
  ];

  const SCORE_LABELS: Record<string, string> = {
    potentiel: "Potentiel réglementaire",
    risque: "Risque",
    timing: "Timing",
    faisabilite: "Faisabilité foncière",
    marche: "Valeur marché",
  };

  const SCORE_WEIGHTS: Record<string, number> = {
    potentiel: PROCESS_WEIGHTS.potentiel,
    risque: PROCESS_WEIGHTS.risque,
    timing: PROCESS_WEIGHTS.timing,
    faisabilite: PROCESS_WEIGHTS.faisabilite,
    marche: PROCESS_WEIGHTS.marche,
  };

  let selectedId: string = valleyfieldDossiers[0].id;

  $: selected = valleyfieldDossiers.find((d) => d.id === selectedId) ?? valleyfieldDossiers[0];

  function evidenceForPhase(dossier: OpportunityDossierT, phase: string): EvidenceItemT[] {
    return dossier.evidence.filter((e) => e.phase === phase);
  }

  function verificationClass(v: string): string {
    if (v === "fait") return "bg-emerald-100 text-emerald-700";
    if (v === "hypothese") return "bg-amber-100 text-amber-700";
    return "bg-slate-100 text-slate-500";
  }

  function verificationLabel(v: string): string {
    if (v === "fait") return "Fait";
    if (v === "hypothese") return "Hypothèse";
    return "N/D";
  }

  function scoreColor(s: number): string {
    if (s >= 4) return "bg-emerald-100 text-emerald-800";
    if (s >= 3) return "bg-amber-100 text-amber-800";
    return "bg-red-100 text-red-700";
  }

  function globalScoreColor(s: number): string {
    if (s >= 3.5) return "text-emerald-700";
    if (s >= 2.5) return "text-amber-700";
    return "text-red-700";
  }
</script>

<section class="min-h-full bg-slate-50 p-6">
  <!-- Header -->
  <header class="mb-5">
    <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
      Analyse d'opportunité — Valleyfield
    </p>
    <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
      Dossiers d'opportunité foncière
    </h1>
    <p class="mt-1 text-sm text-slate-500">
      3 dossiers réels — entonnoir PROCESS 6 phases, preuves tracées, score pondéré.
    </p>
  </header>

  <!-- Dossier switcher -->
  <div class="mb-6 flex flex-wrap gap-2">
    {#each valleyfieldDossiers as dossier}
      <button
        type="button"
        class={`rounded-lg border px-4 py-2.5 text-left transition ${
          selectedId === dossier.id
            ? "border-teal-500 bg-teal-600 text-white shadow-sm"
            : "border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:bg-teal-50"
        }`}
        on:click={() => (selectedId = dossier.id)}
      >
        <p class="text-sm font-semibold leading-tight">{dossier.zone}</p>
        <p class={`text-xs leading-tight ${selectedId === dossier.id ? "text-teal-100" : "text-slate-500"}`}>
          Règl. {dossier.bylaw}
        </p>
      </button>
    {/each}
  </div>

  <!-- Dossier title & address -->
  <div class="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <h2 class="text-lg font-semibold text-slate-950">{selected.title}</h2>
    <p class="mt-0.5 text-sm text-slate-500">{selected.address}</p>
    <div class="mt-2 flex flex-wrap gap-2">
      <span class="rounded bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700">
        Zone {selected.zone}
      </span>
      <span class="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
        Règl. {selected.bylaw}
      </span>
    </div>
  </div>

  <!-- 6-phase rail -->
  <div class="mb-6 space-y-4">
    {#each PHASES as phase}
      {@const items = evidenceForPhase(selected, phase.id)}
      {#if items.length > 0}
        <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
          <!-- Phase header -->
          <div class="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
            <span class="h-2 w-2 rounded-full bg-teal-500"></span>
            <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-700">
              {phase.label}
            </h3>
            <span class="ml-auto rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">
              {items.length} indice{items.length > 1 ? "s" : ""}
            </span>
          </div>
          <!-- Evidence cards -->
          <div class="divide-y divide-slate-100">
            {#each items as item}
              <div class="px-4 py-3">
                <div class="flex flex-wrap items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <p class="text-sm font-medium text-slate-900">{item.label}</p>
                      {#if item.url}
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="inline-flex shrink-0 items-center gap-0.5 text-xs text-teal-600 hover:text-teal-800"
                        >
                          <ExternalLink class="h-3 w-3" aria-hidden="true" />
                          Source
                        </a>
                      {/if}
                    </div>
                    {#if item.value}
                      <p class="mt-1 text-xs leading-5 text-slate-600">{item.value}</p>
                    {/if}
                    <p class="mt-1 text-[10px] text-slate-400">
                      {item.date} · {item.obtentionMode} · confiance: {item.confidence}
                    </p>
                  </div>
                  <span
                    class={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${verificationClass(item.verification)}`}
                  >
                    {verificationLabel(item.verification)}
                  </span>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/each}
  </div>

  <!-- Lots table -->
  <div class="mb-6 rounded-lg border border-slate-200 bg-white shadow-sm">
    <div class="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
      <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-700">
        Lots cadastraux
      </h3>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-slate-100 text-left text-xs text-slate-500">
            <th class="px-4 py-2 font-semibold">No lot</th>
            <th class="px-4 py-2 font-semibold">Usage</th>
            <th class="px-4 py-2 font-semibold">Superficie</th>
            <th class="px-4 py-2 font-semibold">Valeur rôle</th>
          </tr>
        </thead>
        <tbody>
          {#each selected.lots as lot}
            <tr class="border-b border-slate-50 last:border-0">
              <td class="px-4 py-2 font-mono text-xs text-slate-700">{lot.noLot}</td>
              <td class="px-4 py-2 text-xs text-slate-600">{lot.usage ?? "—"}</td>
              <td class="px-4 py-2 text-xs text-slate-600">{lot.superficie ?? "—"}</td>
              <td class="px-4 py-2 text-xs text-slate-600">{lot.valeur ?? "—"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Weighted score block -->
  <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div class="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
      <TrendingUp class="h-4 w-4 text-teal-600" aria-hidden="true" />
      <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-700">
        Score pondéré PROCESS
      </h3>
    </div>
    <div class="p-4">
      <!-- Criteria rows -->
      <div class="mb-4 space-y-2">
        {#each Object.entries(SCORE_LABELS) as [key, label]}
          {@const score = selected.scores[key as keyof typeof selected.scores]}
          {@const weight = SCORE_WEIGHTS[key]}
          <div class="flex items-center gap-3">
            <span class="w-40 shrink-0 text-sm text-slate-600">{label}</span>
            <div class="flex flex-1 items-center gap-2">
              <div class="flex gap-1">
                {#each [1, 2, 3, 4, 5] as dot}
                  <span
                    class={`h-3 w-3 rounded-full ${
                      dot <= score ? "bg-teal-500" : "bg-slate-200"
                    }`}
                  ></span>
                {/each}
              </div>
              <span class={`rounded px-1.5 py-0.5 text-xs font-semibold ${scoreColor(score)}`}>
                {score}/5
              </span>
            </div>
            <span class="shrink-0 text-xs text-slate-400">{(weight * 100).toFixed(0)} %</span>
          </div>
        {/each}
      </div>

      <!-- Global score -->
      <div class="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
        <span class="text-sm font-semibold text-slate-700">Score global</span>
        <span class={`text-2xl font-bold ${globalScoreColor(selected.scoreGlobal)}`}>
          {selected.scoreGlobal.toFixed(2)}<span class="text-base font-normal text-slate-400">/5</span>
        </span>
      </div>

      <!-- Recommendation -->
      <div class="mt-3 rounded-lg border border-teal-100 bg-teal-50 px-4 py-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-teal-700">Recommandation</p>
        <p class="mt-1 text-sm leading-6 text-slate-700">{selected.recommendation}</p>
      </div>
    </div>
  </div>
</section>
