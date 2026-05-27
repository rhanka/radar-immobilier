<script lang="ts">
  import { AlertCircle, SortAsc, SortDesc, Filter } from "@lucide/svelte";
  import { demoSignalsT1 } from "$lib/demo/radar-t1-signals.js";
  import { filterRealMode } from "@radar/scoring";
  import { filterByStatus, sortSignals, markApprofondir } from "$lib/signals/feed.js";
  import type { SortKey, SortDir } from "$lib/signals/feed.js";
  import type { SignalT, SignalStatusT } from "@radar/domain";
  import SignalRow from "./SignalRow.svelte";

  // ── Props ────────────────────────────────────────────────────────────────────
  export let onApprofondir: (s: SignalT) => void = () => {};

  // ── Mutable local copy of signals (in-memory; persistence is ÉV3) ────────────
  let signals: SignalT[] = demoSignalsT1.map((s) => ({ ...s }));

  // ── Controls ─────────────────────────────────────────────────────────────────
  let sortKey: SortKey = "value";
  let sortDir: SortDir = "desc";
  let statusFilter: SignalStatusT | "tous" = "tous";
  let hideSimulations = false;

  // ── Derived feed ─────────────────────────────────────────────────────────────
  $: pool = hideSimulations ? filterRealMode(signals) : signals;
  $: statusFiltered = filterByStatus(pool, statusFilter);
  $: visible = sortSignals(statusFiltered, sortKey, sortDir);

  // ── Approfondir action ────────────────────────────────────────────────────────
  let lastApprofondie: string | null = null;

  function handleApprofondir(signal: SignalT) {
    signals = markApprofondir(signals, signal.id);
    lastApprofondie = signal.id;
    onApprofondir({ ...signal, status: "à-approfondir" });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      sortDir = sortDir === "desc" ? "asc" : "desc";
    } else {
      sortKey = key;
      sortDir = "desc";
    }
  }

  const STATUS_OPTIONS: Array<{ value: SignalStatusT | "tous"; label: string }> = [
    { value: "tous", label: "Tous" },
    { value: "nouveau", label: "Nouveau" },
    { value: "à-approfondir", label: "À approfondir" },
    { value: "surveillance", label: "Surveillance" },
    { value: "écarté", label: "Écarté" },
  ];
</script>

<section class="min-h-full bg-slate-50 p-6">
  <!-- Header -->
  <header class="mb-6">
    <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
      Radar T1 — Signaux de triage
    </p>
    <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
      Fil de signaux T1
    </h1>
    <p class="mt-1 text-sm leading-6 text-slate-500">
      Chaque signal est évalué selon deux dimensions indépendantes : la <span class="font-medium text-slate-700">valeur /10</span> (priorité de type, fixée par la grille T1) et la <span class="font-medium text-slate-700">confiance</span> (qualité de la détection). Ces deux axes sont triables séparément — ils ne sont jamais multipliés. Les signaux <span class="font-medium text-violet-600">simulation</span> sont des données synthétiques de calibration.
    </p>
  </header>

  <!-- Controls -->
  <div class="mb-5 flex flex-wrap items-center gap-3">
    <!-- Sort by value -->
    <button
      type="button"
      class={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-teal-400 ${
        sortKey === "value"
          ? "border-teal-600 bg-teal-600 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
      on:click={() => toggleSort("value")}
      title="Trier par valeur /10"
    >
      {#if sortKey === "value" && sortDir === "asc"}
        <SortAsc class="h-4 w-4" aria-hidden="true" />
      {:else}
        <SortDesc class="h-4 w-4" aria-hidden="true" />
      {/if}
      Valeur
    </button>

    <!-- Sort by confidence -->
    <button
      type="button"
      class={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-teal-400 ${
        sortKey === "confidence"
          ? "border-teal-600 bg-teal-600 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
      on:click={() => toggleSort("confidence")}
      title="Trier par confiance"
    >
      {#if sortKey === "confidence" && sortDir === "asc"}
        <SortAsc class="h-4 w-4" aria-hidden="true" />
      {:else}
        <SortDesc class="h-4 w-4" aria-hidden="true" />
      {/if}
      Confiance
    </button>

    <!-- Status filter -->
    <div class="flex items-center gap-1.5">
      <Filter class="h-4 w-4 text-slate-500" aria-hidden="true" />
      <select
        bind:value={statusFilter}
        class="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
        aria-label="Filtrer par statut"
      >
        {#each STATUS_OPTIONS as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </div>

    <!-- Real/sim toggle -->
    <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        bind:checked={hideSimulations}
        class="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
      />
      Masquer les simulations
    </label>

    <!-- Count -->
    <span class="ml-auto text-xs text-slate-400">
      {visible.length} signal{visible.length !== 1 ? "s" : ""}
    </span>
  </div>

  <!-- Signal list -->
  {#if visible.length === 0}
    <div class="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400">
      Aucun signal pour ce filtre.
    </div>
  {:else}
    <div class="space-y-2">
      {#each visible as signal (signal.id)}
        <SignalRow {signal} onApprofondir={handleApprofondir} />
      {/each}
    </div>
  {/if}

  <!-- In-memory note -->
  {#if lastApprofondie}
    <div class="mt-4 flex gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
      <p class="text-xs leading-5 text-blue-700">
        Action <span class="font-semibold">Approfondir</span> enregistrée en mémoire locale uniquement — la persistance est hors-périmètre ÉV2 (prévue ÉV3).
      </p>
    </div>
  {/if}

  <!-- Provenance disclaimer -->
  <div class="mt-6 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
    <AlertCircle class="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
    <div>
      <h3 class="text-sm font-semibold text-slate-950">Provenance des signaux</h3>
      <p class="mt-1 text-sm leading-6 text-slate-700">
        3 signaux réels (avis de consultation publique vérifiés — règlements 150-49, 150-49-1, 150-51) et 3 signaux synthétiques de calibration (marqués <span class="font-medium text-violet-600">Simulation</span>). Les signaux simulation sont exclus du fil réel via <code class="rounded bg-amber-100 px-1 text-[11px]">filterRealMode</code>.
      </p>
    </div>
  </div>
</section>
