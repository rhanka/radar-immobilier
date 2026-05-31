<script lang="ts">
  import { ExternalLink, SearchCheck, ShieldAlert } from "@lucide/svelte";
  import type { SourceEvaluation } from "$lib/source-review/source-evaluation-data";
  import { getPotentialComplexity } from "$lib/source-review/source-evaluation-data";
  import {
    accessLabels,
    costLabels,
    recommendationLabels,
    visionLabels,
  } from "$lib/source-review/source-review-labels";

  export let source: SourceEvaluation;

  type ScoreRow = {
    label: string;
    value: number;
    detail: string;
    tone: "teal" | "amber" | "slate";
  };

  const barClassByTone: Record<ScoreRow["tone"], string> = {
    amber: "bg-amber-500",
    slate: "bg-slate-500",
    teal: "bg-teal-600",
  };

  $: valueRows = [
    {
      label: "Signal faible",
      value: source.weakSignalValue,
      detail: "Detection avant que l'opportunite soit evidente.",
      tone: "teal",
    },
    {
      label: "Precision",
      value: source.precisionValue,
      detail: "Adresse, lot, zone, dossier ou reglement actionnable.",
      tone: "teal",
    },
    {
      label: "Rappel",
      value: source.recallValue,
      detail: "Capacite a ne pas rater les variantes et suites de dossier.",
      tone: "teal",
    },
    {
      label: "Anti faux positifs",
      value: source.falsePositiveControl,
      detail: "Capacite a invalider les pistes seduisantes mais bloquees.",
      tone: "amber",
    },
    {
      label: "Apprentissage passe",
      value: source.historyLearningValue,
      detail: "Capacite a retrouver des patterns avant/apres historiques.",
      tone: "slate",
    },
  ] satisfies ScoreRow[];

  $: complexityRows = [
    {
      label: "Technique",
      value: source.technicalComplexity,
      detail: "Parsing, geospatial, OCR, NLP, graph linking.",
      tone: "amber",
    },
    {
      label: "Acces",
      value: source.accessComplexity,
      detail: "Compte, API, export, fournisseur ou flux municipal.",
      tone: "amber",
    },
    {
      label: "Legal",
      value: source.legalComplexity,
      detail: "Licence, ToS, donnees personnelles, reutilisation.",
      tone: "amber",
    },
    {
      label: "Cout",
      value: source.costComplexity,
      detail: "Abonnement, document, transcription, stockage ou LLM.",
      tone: "amber",
    },
  ] satisfies ScoreRow[];
</script>

{#snippet ScoreBar(row: ScoreRow)}
  <div>
    <div class="flex items-center justify-between gap-3">
      <div>
        <p class="text-sm font-semibold text-slate-900">{row.label}</p>
        <p class="text-xs leading-5 text-slate-600">{row.detail}</p>
      </div>
      <span class="shrink-0 text-sm font-bold text-slate-950">{row.value}/5</span>
    </div>
    <div class="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
      <div
        class={`h-full rounded-full ${barClassByTone[row.tone]}`}
        style={`width: ${(row.value / 5) * 100}%`}
      ></div>
    </div>
  </div>
{/snippet}

<section class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
  <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
    <div>
      <p class="text-xs font-semibold uppercase tracking-wide text-teal-700">
        Deep dive source
      </p>
      <h1 class="mt-1 text-xl font-bold text-slate-950">{source.name}</h1>
      <p class="mt-1 text-sm text-slate-600">{source.family}</p>
    </div>
    <div class="rounded-md bg-slate-950 px-3 py-2 text-right text-white">
      <p class="text-[11px] uppercase text-slate-300">Reco</p>
      <p class="text-sm font-semibold">{recommendationLabels[source.recommendation]}</p>
    </div>
  </div>

  <div class="mt-4 grid gap-3 md:grid-cols-4">
    <div class="rounded-md bg-teal-50 p-3">
      <p class="text-[11px] uppercase text-teal-900">Valeur</p>
      <p class="text-2xl font-bold text-teal-950">{source.businessValue}/5</p>
    </div>
    <div class="rounded-md bg-amber-50 p-3">
      <p class="text-[11px] uppercase text-amber-900">Complexite</p>
      <p class="text-2xl font-bold text-amber-950">{getPotentialComplexity(source)}/5</p>
    </div>
    <div class="rounded-md bg-slate-50 p-3">
      <p class="text-[11px] uppercase text-slate-600">Acces</p>
      <p class="text-sm font-semibold text-slate-950">{accessLabels[source.accessMode]}</p>
    </div>
    <div class="rounded-md bg-slate-50 p-3">
      <p class="text-[11px] uppercase text-slate-600">Cout</p>
      <p class="text-sm font-semibold text-slate-950">{costLabels[source.costLevel]}</p>
    </div>
  </div>

  <p class="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
    {source.costNotes}
  </p>

  <div class="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
    <div class="rounded-md border border-slate-200 p-3">
      <h2 class="text-sm font-semibold text-slate-950">Pourquoi ce placement</h2>
      <div class="mt-3 grid gap-4 md:grid-cols-2">
        {#each valueRows as row}
          {@render ScoreBar(row)}
        {/each}
      </div>
    </div>

    <div class="rounded-md border border-amber-200 bg-amber-50/50 p-3">
      <h2 class="text-sm font-semibold text-amber-950">Complexite a lever</h2>
      <div class="mt-3 space-y-4">
        {#each complexityRows as row}
          {@render ScoreBar(row)}
        {/each}
      </div>
    </div>
  </div>

  <div class="mt-4 flex flex-wrap gap-2">
    {#each source.visionAlignment as alignment}
      <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
        {visionLabels[alignment]}
      </span>
    {/each}
  </div>

  <div class="mt-5 grid gap-4 lg:grid-cols-3">
    <div class="rounded-md border border-slate-200 p-3">
      <h2 class="text-sm font-semibold text-slate-950">Fait</h2>
      <ul class="mt-2 space-y-2 text-sm text-slate-700">
        {#each source.done as item}
          <li>{item}</li>
        {/each}
      </ul>
    </div>
    <div class="rounded-md border border-teal-200 bg-teal-50/60 p-3">
      <h2 class="text-sm font-semibold text-teal-950">A faire (reco)</h2>
      <ul class="mt-2 space-y-2 text-sm text-slate-700">
        {#each source.next as item}
          <li>{item}</li>
        {/each}
      </ul>
    </div>
    <div class="rounded-md border border-amber-200 bg-amber-50/70 p-3">
      <h2 class="text-sm font-semibold text-amber-950">Attendus client</h2>
      <ul class="mt-2 space-y-2 text-sm text-slate-700">
        {#each source.clientExpected as item}
          <li>{item}</li>
        {/each}
      </ul>
    </div>
  </div>

  <div class="mt-5 grid gap-4 lg:grid-cols-2">
    <div class="rounded-md border border-slate-200 p-3">
      <div class="mb-2 flex items-center gap-2">
        <SearchCheck class="h-4 w-4 text-teal-700" aria-hidden="true" />
        <h2 class="text-sm font-semibold text-slate-950">Argument valeur</h2>
      </div>
      <p class="text-sm leading-6 text-slate-700">{source.auditFor}</p>
    </div>
    <div class="rounded-md border border-slate-200 p-3">
      <div class="mb-2 flex items-center gap-2">
        <ShieldAlert class="h-4 w-4 text-amber-700" aria-hidden="true" />
        <h2 class="text-sm font-semibold text-slate-950">Audit contradictoire</h2>
      </div>
      <p class="text-sm leading-6 text-slate-700">{source.auditAgainst}</p>
    </div>
  </div>

  <div class="mt-5">
    <h2 class="text-sm font-semibold text-slate-950">Illustrations concretes</h2>
    <div class="mt-2 grid gap-2 md:grid-cols-2">
      {#each source.concreteEvidence as evidence}
        <a
          class="rounded-md border border-slate-200 p-3 text-sm hover:border-teal-500 hover:bg-teal-50"
          href={evidence.href}
          target="_blank"
          rel="noreferrer"
        >
          <span class="flex items-center gap-2 font-semibold text-slate-950">
            {evidence.label}
            <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span class="mt-1 block text-xs leading-5 text-slate-600">{evidence.detail}</span>
        </a>
      {/each}
    </div>
  </div>
</section>
