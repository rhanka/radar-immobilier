<script lang="ts">
  import { Check } from "@lucide/svelte";
  import { valleyfieldDossiers } from "@radar/domain";
  import { WEIGHTS, aggregate } from "@radar/scoring";
  import { Badge, Button, Card, EmptyState } from "@sentropic/design-system-svelte";
  import type { OpportunityDossierT } from "@radar/domain";
  import { appMode } from "$lib/state/mode.js";
  import { filterDossiersBySignalId, axesForMode } from "$lib/opportunites/funnel.js";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import DossierCard from "./DossierCard.svelte";

  /** Optional: render only the dossier linked to this signal. */
  export let selectedSignalId: string | undefined = undefined;

  /** Human-readable label for the signal filter chip (signal-2). */
  export let selectedSignalLabel: string | undefined = undefined;

  /** Callback to clear the signal filter (parent may also clear it via prop). */
  export let onClearFilter: (() => void) | undefined = undefined;

  $: mode = $appMode;

  $: filtered = filterDossiersBySignalId(valleyfieldDossiers, selectedSignalId);

  /** Selected dossier — defaults to first in the list. */
  let selectedId: string | undefined = undefined;
  $: selectedDossier = filtered.find((d) => d.id === selectedId) ?? filtered[0] ?? undefined;

  function handleSelect(dossier: OpportunityDossierT): void {
    selectedId = dossier.id;
  }

  function handleClearFilter(): void {
    if (onClearFilter) {
      onClearFilter();
    } else {
      selectedSignalId = undefined;
    }
  }

  function scoreHundred(dossier: OpportunityDossierT): number | null {
    const res = aggregate(axesForMode(dossier.axes, mode), WEIGHTS);
    if (res.tooThin || res.score === null) return null;
    return Math.round(res.score * 20);
  }

  function isEnAttenteDePreuve(dossier: OpportunityDossierT): boolean {
    if (mode !== "real") return false;
    const res = aggregate(axesForMode(dossier.axes, mode), WEIGHTS);
    return res.partial || res.tooThin;
  }

  function capLabel(cap: string): string {
    if (cap === "monter-dossier-acquisition") return "Acquérir";
    if (cap === "qualifier-avec-expert") return "Qualifier";
    if (cap === "approcher-proprietaire") return "Approcher";
    if (cap === "surveiller") return "Surveiller";
    if (cap === "rejeter") return "Rejeter";
    return cap;
  }

  function capTone(cap: string): "success" | "warning" | "info" | "neutral" | "error" {
    if (cap === "monter-dossier-acquisition") return "success";
    if (cap === "qualifier-avec-expert") return "warning";
    if (cap === "approcher-proprietaire") return "info";
    if (cap === "surveiller") return "neutral";
    return "error";
  }

  function scoreTone(s: number | null): "success" | "warning" | "error" | "neutral" {
    if (s === null) return "neutral";
    if (s >= 70) return "success";
    if (s >= 50) return "warning";
    return "error";
  }
</script>

<ViewLayout>
  <!-- ── Bande laterale gauche : liste maitre des opportunites ──────────── -->
  <svelte:fragment slot="controls">
    <div class="flex flex-col gap-2 p-4">
      <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Opportunités · {filtered.length} dossier{filtered.length > 1 ? "s" : ""}
      </p>

      {#if selectedSignalId !== undefined}
        <div class="mb-1 flex items-center justify-between gap-2 rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5">
          <span class="min-w-0 flex-1 truncate text-xs text-teal-800" title={selectedSignalLabel ?? selectedSignalId}>
            Filtré : {selectedSignalLabel ?? selectedSignalId}
          </span>
          <button
            type="button"
            class="shrink-0 text-xs font-semibold text-teal-700 underline hover:text-teal-900"
            on:click={handleClearFilter}
          >
            Tout afficher
          </button>
        </div>
      {/if}

      {#if filtered.length === 0}
        <p class="rounded-md border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
          Aucun dossier pour ce signal.
        </p>
      {:else}
        {#each filtered as dossier (dossier.id)}
          {@const res = aggregate(axesForMode(dossier.axes, mode), WEIGHTS)}
          {@const s100 = scoreHundred(dossier)}
          {@const isSelected = selectedDossier?.id === dossier.id}
          {@const enAttente = isEnAttenteDePreuve(dossier)}
          <button
            type="button"
            class="w-full text-left"
            aria-current={isSelected ? "true" : undefined}
            on:click={() => handleSelect(dossier)}
          >
            <Card
              interactive
              class={isSelected
                ? "ring-2 ring-teal-600 ring-offset-1 bg-teal-600"
                : "hover:border-teal-300"}
            >
              <div class={`p-3 ${isSelected ? "border-l-4 border-teal-300 pl-2.5" : ""}`}>
                {#if isSelected}
                  <div class="mb-1.5 flex items-center gap-1.5">
                    <span class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white">
                      <Check class="h-3 w-3 text-teal-700" aria-hidden="true" />
                    </span>
                    <span class="text-[10px] font-bold uppercase tracking-wide text-white">
                      Sélectionnée
                    </span>
                  </div>
                {/if}
                <p class={`text-sm font-semibold leading-5 ${isSelected ? "text-white" : "text-slate-900"}`}>
                  {dossier.title}
                </p>
                <p class={`mt-0.5 text-xs ${isSelected ? "text-teal-50" : "text-slate-500"}`}>
                  {dossier.address}
                </p>
                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral">{dossier.zone}</Badge>
                  {#if s100 === null}
                    <Badge tone="neutral">– /100</Badge>
                  {:else}
                    <Badge tone={scoreTone(s100)}>{s100}/100</Badge>
                  {/if}
                  <Badge tone={capTone(res.recommendationCap)}>
                    {capLabel(res.recommendationCap)}
                  </Badge>
                  {#if enAttente}
                    <Badge tone="warning">En attente de preuve (surveillance)</Badge>
                  {:else if res.partial}
                    <Badge tone="warning">Partiel</Badge>
                  {/if}
                </div>
              </div>
            </Card>
          </button>
        {/each}
      {/if}
    </div>
  </svelte:fragment>

  <!-- ── Contenu principal : detail ancre du dossier selectionne ────────── -->
  <section class="flex min-h-full flex-col bg-slate-50 p-6">
    <!-- En-tete unique : fil d'Ariane + titre (dossier selectionne, sinon vue) -->
    <header class="mb-5">
      <nav class="text-xs text-slate-400" aria-label="Fil d'Ariane">
        <span>Opportunités</span>
        <span class="mx-1.5 text-slate-300">/</span>
        <span class="text-teal-700">Valleyfield</span>
        {#if selectedDossier}
          <span class="mx-1.5 text-slate-300">/</span>
          <span class="font-medium text-slate-600">{selectedDossier.title}</span>
        {/if}
      </nav>
      <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
        {selectedDossier ? selectedDossier.title : "Dossiers d'opportunité foncière"}
      </h1>
      {#if selectedDossier}
        <p class="mt-1 text-sm text-slate-500">
          {selectedDossier.address} · Dossier d'opportunité foncière, entonnoir PROCESS 6 phases, preuves tracées.
        </p>
      {/if}
    </header>

    {#if !selectedDossier}
      <EmptyState
        title="Aucun dossier qualifié pour ce signal"
        message="Aucun dossier d'opportunité ne correspond au signal sélectionné pour l'instant."
      >
        {#snippet action()}
          {#if selectedSignalId !== undefined}
            <Button variant="secondary" size="sm" onclick={handleClearFilter}>
              Afficher tous les dossiers
            </Button>
          {/if}
        {/snippet}
      </EmptyState>
    {:else}
      <div class="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white p-4">
        <DossierCard dossier={selectedDossier} {mode} />
      </div>
    {/if}
  </section>
</ViewLayout>
