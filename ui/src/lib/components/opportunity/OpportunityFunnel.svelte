<script lang="ts">
  import { valleyfieldDossiers } from "@radar/domain";
  import { appMode } from "$lib/state/mode.js";
  import {
    filterDossiersBySignalId,
  } from "$lib/opportunites/funnel.js";
  import DossierCard from "./DossierCard.svelte";

  /** Optional: render only the dossier linked to this signal. */
  export let selectedSignalId: string | undefined = undefined;

  /** Callback to clear the signal filter (parent may also clear it via prop). */
  export let onClearFilter: (() => void) | undefined = undefined;

  $: mode = $appMode;

  $: filtered = filterDossiersBySignalId(valleyfieldDossiers, selectedSignalId);

  function handleClearFilter(): void {
    if (onClearFilter) {
      onClearFilter();
    } else {
      // Local reset when no parent callback is wired
      selectedSignalId = undefined;
    }
  }
</script>

<section class="min-h-full bg-slate-50 p-6">
  <!-- ── Header ─────────────────────────────────────────────────────── -->
  <header class="mb-5">
    <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
      Analyse d'opportunité : Valleyfield
    </p>
    <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
      Dossiers d'opportunité foncière
    </h1>
    <p class="mt-1 text-sm text-slate-500">
      3 dossiers réels ; entonnoir PROCESS 6 phases, preuves tracées, score agrégé honnête.
    </p>
  </header>

  <!-- ── Signal filter banner ───────────────────────────────────────── -->
  {#if selectedSignalId !== undefined}
    <div class="mb-5 flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5">
      <p class="flex-1 text-sm text-teal-800">
        Filtré par signal <span class="font-mono font-semibold">{selectedSignalId}</span>
      </p>
      <button
        type="button"
        class="shrink-0 text-xs font-medium text-teal-700 underline hover:text-teal-900"
        on:click={handleClearFilter}
      >
        Tout afficher
      </button>
    </div>
  {/if}

  <!-- ── Mode badge ─────────────────────────────────────────────────── -->
  {#if mode === "real"}
    <div class="mb-5 flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5">
      <span class="h-2 w-2 shrink-0 rounded-full bg-slate-500"></span>
      <p class="text-sm text-slate-700">
        <span class="font-semibold">Mode réel :</span> seules les preuves confirmées comptent.
        Les axes dont le niveau repose sur une hypothèse (confiance faible) sont exclus du calcul et grisés.
      </p>
    </div>
  {:else}
    <div class="mb-5 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5">
      <span class="h-2 w-2 shrink-0 rounded-full bg-violet-500"></span>
      <p class="text-sm text-violet-800">
        <span class="font-semibold">Mode simulation :</span> hypothèses incluses. Le score affiché est la cible optimiste.
      </p>
    </div>
  {/if}

  <!-- ── Dossier list or empty state ────────────────────────────────── -->
  {#if filtered.length === 0}
    <div class="flex min-h-[12rem] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p class="text-sm font-semibold text-slate-700">Aucun dossier qualifié pour ce signal pour l'instant.</p>
      {#if selectedSignalId !== undefined}
        <button
          type="button"
          class="mt-3 text-xs font-medium text-teal-700 underline hover:text-teal-900"
          on:click={handleClearFilter}
        >
          Afficher tous les dossiers
        </button>
      {/if}
    </div>
  {:else}
    <div class="space-y-8">
      {#each filtered as dossier (dossier.id)}
        <DossierCard {dossier} {mode} />
      {/each}
    </div>
  {/if}
</section>
