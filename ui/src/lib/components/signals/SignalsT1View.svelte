<script lang="ts">
  import { AlertCircle, Filter, HelpCircle } from "@lucide/svelte";
  import { demoSignalsT1 } from "$lib/demo/radar-t1-signals.js";
  import { filterByStatus, sortSignals, markApprofondir } from "$lib/signals/feed.js";
  import type { SortKey, SortDir } from "$lib/signals/feed.js";
  import type { SignalT, SignalStatusT } from "@radar/domain";
  import { appMode } from "$lib/state/mode.js";
  import SignalRow from "./SignalRow.svelte";

  // ── Props ────────────────────────────────────────────────────────────────────
  export let onApprofondir: (s: SignalT) => void = () => {};

  // ── Copie locale mutable des signaux (en-mémoire ; persistance hors-périmètre ÉV3) ──
  let signals: SignalT[] = demoSignalsT1.map((s) => ({ ...s }));

  // ── Contrôles ────────────────────────────────────────────────────────────────
  // S1.4 : deux modes de tri — par score /10 (défaut) ou par priorité VISION
  let sortMode: "score" | "vision" = "score";
  let sortDir: SortDir = "desc";
  let statusFilter: SignalStatusT | "tous" = "tous";

  // ── Bulle d'aide VISION (S1.4) ───────────────────────────────────────────────
  let helpOpen = false;
  function toggleHelp() { helpOpen = !helpOpen; }
  function closeHelp() { helpOpen = false; }

  // ── Clé de tri dérivée du mode ───────────────────────────────────────────────
  $: sortKey = (sortMode === "vision" ? "vision-priority" : "value") as SortKey;

  // ── SI1 : pool = toutes les 6 lignes (simulation jamais masquée dans ce feed) ──
  $: statusFiltered = filterByStatus(signals, statusFilter);
  $: visible = sortSignals(statusFiltered, sortKey, sortDir);

  // ── Action Approfondir ────────────────────────────────────────────────────────
  let lastApprofondie: string | null = null;

  function handleApprofondir(signal: SignalT) {
    signals = markApprofondir(signals, signal.id);
    lastApprofondie = signal.id;
    onApprofondir({ ...signal, status: "à-approfondir" });
  }

  const STATUS_OPTIONS: Array<{ value: SignalStatusT | "tous"; label: string }> = [
    { value: "tous", label: "Tous" },
    { value: "nouveau", label: "Nouveau" },
    { value: "à-approfondir", label: "À approfondir" },
    { value: "surveillance", label: "Surveillance" },
    { value: "écarté", label: "Écarté" },
  ];

  // Mode global
  $: mode = $appMode;

  // Compteurs affichés dans l'en-tête
  $: countReal = signals.filter((s) => s.mode === "real").length;
  $: countSim = signals.filter((s) => s.mode === "simulation").length;
  // Nombre de signaux visibles dans le fil courant (avant filtre statut mais après mode)
  $: countPool = mode === "real" ? countReal : signals.length;
</script>

<section class="min-h-full bg-slate-50 p-6">
  <!-- En-tête -->
  <header class="mb-4">
    <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
      Signaux de triage
    </p>
    <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
      Fil de signaux
    </h1>
    <!-- SI4 — note courte : valeur /10 + confiance ≠ score d'opportunité -->
    <p class="mt-2 max-w-prose rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-600">
      <span class="font-semibold text-slate-800">Score de signal = valeur /10</span>
      (priorité par type, VISION §6)
      <span class="mx-1 text-slate-400">+</span>
      <span class="font-semibold text-slate-800">confiance</span>
      (Haute / Moyenne / Faible), distinct du
      <span class="font-semibold text-slate-800">score d'opportunité (/100)</span>.
      Ces deux axes ne sont jamais multipliés.
    </p>
  </header>

  <!-- Bandeau mode réel / simulation -->
  {#if mode === "real"}
    <div class="mb-4 flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5">
      <span class="h-2 w-2 shrink-0 rounded-full bg-teal-500"></span>
      <p class="text-sm text-teal-800">
        <span class="font-semibold">Mode réel :</span>
        {countReal} signal{countReal !== 1 ? "s" : ""} confirmé{countReal !== 1 ? "s" : ""}.
        Basculez en simulation pour voir les exemples de calibration.
      </p>
    </div>
  {:else}
    <div class="mb-4 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5">
      <span class="h-2 w-2 shrink-0 rounded-full bg-violet-500"></span>
      <p class="text-sm text-violet-800">
        <span class="font-semibold">Mode simulation :</span>
        {countPool} signal{countPool !== 1 ? "s" : ""}
        ({countReal} réel{countReal !== 1 ? "s" : ""} + {countSim} exemple{countSim !== 1 ? "s" : ""} synthétique{countSim !== 1 ? "s" : ""} badgé{countSim !== 1 ? "s" : ""}).
      </p>
    </div>
  {/if}

  <!-- Contrôles tri + filtre -->
  <div class="mb-5 flex flex-wrap items-center gap-3">

    <!-- S1.4 — tri par score /10 (défaut) -->
    <button
      type="button"
      class={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-teal-400 ${
        sortMode === "score"
          ? "border-teal-600 bg-teal-600 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
      on:click={() => { sortMode = "score"; sortDir = "desc"; }}
      title="Trier par valeur /10 (score de type calibré)"
    >
      Par score /10
    </button>

    <!-- S1.4 — tri par priorité VISION + bulle d'aide -->
    <div class="relative flex items-center gap-1">
      <button
        type="button"
        class={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-teal-400 ${
          sortMode === "vision"
            ? "border-teal-600 bg-teal-600 text-white"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
        }`}
        on:click={() => { sortMode = "vision"; sortDir = "desc"; }}
        title="Trier par priorité VISION (Priorité 1→4)"
      >
        Par priorité VISION
      </button>

      <!-- Bulle jaune d'aide (S1.4) -->
      <button
        type="button"
        class="inline-flex h-6 w-6 items-center justify-center rounded-full border border-yellow-400 bg-yellow-50 text-yellow-700 transition hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        on:click={toggleHelp}
        aria-label="Explication des deux tris"
        title="Pourquoi deux tris ?"
      >
        <HelpCircle class="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {#if helpOpen}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="absolute left-0 top-full z-20 mt-2 w-80 rounded-lg border border-yellow-300 bg-yellow-50 p-4 shadow-lg"
          role="tooltip"
        >
          <button
            type="button"
            class="absolute right-2 top-2 text-yellow-500 hover:text-yellow-700 focus:outline-none"
            on:click={closeHelp}
            aria-label="Fermer"
          >✕</button>
          <p class="pr-4 text-sm font-semibold text-yellow-900">Pourquoi deux tris ?</p>
          <p class="mt-1 text-sm leading-5 text-yellow-800">
            La VISION numérote Priorité&nbsp;1→4, mais les notes /10 ne suivent pas cet ordre :
            CPTAQ est «&nbsp;Priorité&nbsp;4&nbsp;» dans la VISION mais vaut
            <strong>8/10</strong>, supérieur à PPCMOI «&nbsp;Priorité&nbsp;2&nbsp;» à <strong>7/10</strong>.
          </p>
          <p class="mt-2 text-sm leading-5 text-yellow-800">
            → <strong>Par score /10</strong> : importance métier calibrée.<br />
            → <strong>Par priorité VISION</strong> : ordre Priorité&nbsp;1 (rezonage)
            → 2 (PPCMOI) → 3 (plan d'urb.) → 4 (CPTAQ / grille).
          </p>
        </div>
        <!-- Clic extérieur ferme la bulle -->
        <div class="fixed inset-0 z-10" role="presentation" on:click={closeHelp}></div>
      {/if}
    </div>

    <!-- Filtre par statut -->
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

    <!-- Compteur -->
    <span class="ml-auto text-xs text-slate-400">
      {visible.length} / {signals.length} signal{signals.length !== 1 ? "s" : ""}
      <span class="ml-1 text-slate-300">({countReal} réels + {countSim} exemples)</span>
    </span>
  </div>

  <!-- Liste (SI1 : toutes les 6 lignes ; simulation = badgée, non masquée) -->
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

  <!-- Note action Approfondir -->
  {#if lastApprofondie}
    <div class="mt-4 flex gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
      <p class="text-xs leading-5 text-blue-700">
        Action <span class="font-semibold">Approfondir</span> enregistrée en mémoire locale uniquement (la persistance est hors-périmètre ÉV3).
      </p>
    </div>
  {/if}

  <!-- Note de provenance -->
  <div class="mt-6 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
    <AlertCircle class="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
    <div>
      <h2 class="text-sm font-semibold text-slate-950">Provenance des signaux</h2>
      <p class="mt-1 text-sm leading-6 text-slate-700" style="max-width: 65ch">
        {countReal} signal{countReal !== 1 ? "s" : ""} réel{countReal !== 1 ? "s" : ""}
        (avis de consultation publique vérifiés, règlements 150-49, 150-49-1, 150-51)
        et {countSim} exemple{countSim !== 1 ? "s" : ""}
        (marqués <span class="font-medium text-amber-700">Exemple (simulation)</span>).
        Les exemples illustrent des types de signaux non encore détectés dans les données réelles
        et restent visibles dans tous les modes.
      </p>
    </div>
  </div>
</section>
