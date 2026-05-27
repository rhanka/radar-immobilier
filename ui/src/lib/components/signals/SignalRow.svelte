<script lang="ts">
  import { Zap, BookOpen } from "@lucide/svelte";
  import type { SignalT } from "@radar/domain";

  export let signal: SignalT;
  export let onApprofondir: (s: SignalT) => void;

  // French label map for signal types
  const TYPE_LABELS: Record<string, string> = {
    "residential-rezoning": "Rezonage résidentiel",
    "cptaq": "CPTAQ",
    "ppcmoi": "PPCMOI",
    "derogation-relevant": "Dérogation pertinente",
    "derogation-irrelevant": "Dérogation non pertinente",
    "political-intention": "Intention politique",
    "public-consultation": "Consultation publique",
    "plan-urbanisme": "Plan d'urbanisme",
    "grid-cos-modification": "Modification grille/COS",
    "requalification-tod": "Requalification TOD",
    "public-investment": "Investissement public",
  };

  const CONFIDENCE_LABELS: Record<string, string> = {
    high: "Haute",
    medium: "Moyenne",
    low: "Faible",
  };

  const STATUS_LABELS: Record<string, string> = {
    "nouveau": "Nouveau",
    "à-approfondir": "À approfondir",
    "écarté": "Écarté",
    "surveillance": "Surveillance",
  };

  function confidenceBadgeClass(confidence: string): string {
    if (confidence === "high") return "bg-emerald-100 text-emerald-700";
    if (confidence === "medium") return "bg-amber-100 text-amber-700";
    return "bg-slate-100 text-slate-500";
  }

  function statusChipClass(status: string): string {
    if (status === "nouveau") return "bg-teal-100 text-teal-700";
    if (status === "à-approfondir") return "bg-blue-100 text-blue-700";
    if (status === "écarté") return "bg-slate-100 text-slate-400";
    if (status === "surveillance") return "bg-amber-100 text-amber-700";
    return "bg-slate-100 text-slate-500";
  }

  function formatDate(iso: string): string {
    // Expects YYYY-MM-DD
    const [y, m, d] = iso.split("-");
    const months = ["janv.", "févr.", "mars", "avr.", "mai", "juin",
                    "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
  }

  $: typeLabel = TYPE_LABELS[signal.type] ?? signal.type;
  $: isEcarte = signal.status === "écarté";
</script>

<div class={`flex items-center gap-4 rounded-lg border bg-white px-4 py-3 shadow-sm transition ${isEcarte ? "border-slate-100 opacity-60" : "border-slate-200"}`}>
  <!-- Type + bylaw/zone -->
  <div class="min-w-0 flex-1">
    <div class="flex flex-wrap items-center gap-2">
      <p class="text-sm font-semibold text-slate-950">{typeLabel}</p>
      {#if signal.mode === "simulation"}
        <span class="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
          Simulation
        </span>
      {/if}
    </div>
    {#if signal.bylaw || signal.zone}
      <p class="mt-0.5 text-xs text-slate-500">
        {#if signal.bylaw}Règl. {signal.bylaw}{/if}{#if signal.bylaw && signal.zone} — {/if}{#if signal.zone}Zone {signal.zone}{/if}
      </p>
    {/if}
  </div>

  <!-- Value /10 + mini bar -->
  <div class="flex shrink-0 flex-col items-center gap-1" title="Valeur de triage /10">
    <span class="text-base font-bold text-slate-900">
      {signal.value}<span class="text-[11px] font-normal text-slate-400">/10</span>
    </span>
    <div class="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
      <div
        class="h-full rounded-full bg-teal-500"
        style="width: {(signal.value / 10) * 100}%"
      ></div>
    </div>
  </div>

  <!-- Confidence badge -->
  <div class="shrink-0">
    <span class={`rounded px-2 py-0.5 text-[11px] font-semibold ${confidenceBadgeClass(signal.confidence)}`}>
      {CONFIDENCE_LABELS[signal.confidence] ?? signal.confidence}
    </span>
  </div>

  <!-- Status chip -->
  <div class="shrink-0">
    <span class={`rounded px-2 py-0.5 text-[11px] font-semibold ${statusChipClass(signal.status)}`}>
      {STATUS_LABELS[signal.status] ?? signal.status}
    </span>
  </div>

  <!-- DetectedAt -->
  <div class="hidden shrink-0 text-xs text-slate-400 sm:block">
    {formatDate(signal.detectedAt)}
  </div>

  <!-- Approfondir button -->
  <div class="shrink-0">
    {#if !isEcarte}
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-400"
        on:click={() => onApprofondir(signal)}
      >
        <BookOpen class="h-3.5 w-3.5" aria-hidden="true" />
        Approfondir
      </button>
    {:else}
      <span class="inline-flex items-center gap-1.5 rounded bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-400">
        <Zap class="h-3.5 w-3.5" aria-hidden="true" />
        Écarté
      </span>
    {/if}
  </div>
</div>
