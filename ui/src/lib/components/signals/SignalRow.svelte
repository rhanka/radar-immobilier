<script lang="ts">
  import { Zap, BookOpen } from "@lucide/svelte";
  import type { SignalT } from "@radar/domain";
  import Acronym from "$lib/components/Acronym.svelte";

  export let signal: SignalT;
  export let onApprofondir: (s: SignalT) => void;

  // Étiquettes françaises pour les types de signaux (S1.3 : types VISION + §4.1 uniquement)
  const TYPE_LABELS: Record<string, string> = {
    "residential-rezoning": "Rezonage résidentiel",
    "cptaq": "CPTAQ",
    "ppcmoi": "PPCMOI",
    "public-consultation": "Consultation publique",
    "plan-urbanisme": "Plan d'urbanisme",
    "grid-cos-modification": "Modification grille/COS",
    // S1.2 : dérogations = filtre pur ; conservées pour rétrocompatibilité démo
    "derogation-relevant": "Dérogation pertinente",
    "derogation-irrelevant": "Dérogation non pertinente",
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
    // Only format strings that strictly match YYYY-MM-DD; render raw otherwise.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const [y, m, d] = iso.split("-");
    const months = ["janv.", "févr.", "mars", "avr.", "mai", "juin",
                    "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
  }

  $: typeLabel = TYPE_LABELS[signal.type] ?? signal.type;
  $: isEcarte = signal.status === "écarté";
  $: isSimulation = signal.mode === "simulation";
  // S1.2: dérogations = filtre pur, pas de score /10
  $: isDerogation = signal.type === "derogation-relevant" || signal.type === "derogation-irrelevant";
</script>

<!-- SI1 : simulation = légèrement atténuée (opacity-80) mais toujours visible -->
<div class={`flex items-center gap-4 rounded-lg border bg-white px-4 py-3 shadow-sm transition ${isEcarte ? "border-slate-100 opacity-60" : isSimulation ? "border-slate-200 opacity-80" : "border-slate-200"}`}>
  <!-- Type + bylaw/zone -->
  <div class="min-w-0 flex-1">
    <div class="flex flex-wrap items-center gap-2">
      <p class="text-sm font-semibold text-slate-950">
        {#if signal.type === "cptaq" || signal.type === "ppcmoi"}
          <Acronym term={typeLabel} />
        {:else if signal.type === "grid-cos-modification"}
          Modification grille/<Acronym term="COS" />
        {:else}
          {typeLabel}
        {/if}
      </p>
      {#if isSimulation}
        <!-- SI1 + SI2 : badge explicite "Exemple (simulation)" -->
        <span class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          Exemple (simulation)
        </span>
      {/if}
    </div>
    {#if signal.bylaw || signal.zone}
      <p class="mt-0.5 text-xs text-slate-500">
        {#if signal.bylaw}Règl. {signal.bylaw}{/if}{#if signal.bylaw && signal.zone}, {/if}{#if signal.zone}Zone {signal.zone}{/if}
      </p>
    {/if}
  </div>

  <!-- SI4 — Valeur /10 avec libellé explicite ; dérogations = filtre pur (S1.2) -->
  <div class="flex shrink-0 flex-col items-center gap-0.5" title={isDerogation ? "Dérogation : filtre pur, pas de score /10 (VISION §6)" : "Valeur de triage /10 (priorité par type, VISION §6)"}>
    <span class="text-[10px] font-medium uppercase tracking-wide text-slate-400">Valeur</span>
    {#if isDerogation}
      <span class="text-[11px] font-semibold text-slate-400 italic">Filtre (pas de score)</span>
    {:else}
      <span class="text-base font-bold text-slate-900">
        {signal.value}<span class="text-[11px] font-normal text-slate-400">/10</span>
      </span>
      <div class="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div
          class="h-full rounded-full bg-teal-500"
          style="width: {(signal.value / 10) * 100}%"
        ></div>
      </div>
    {/if}
  </div>

  <!-- SI4 — Confiance avec libellé explicite -->
  <div class="flex shrink-0 flex-col items-center gap-0.5" title="Confiance (qualité de la détection)">
    <span class="text-[10px] font-medium uppercase tracking-wide text-slate-400">Confiance</span>
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
