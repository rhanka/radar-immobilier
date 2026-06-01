<script lang="ts">
  import { valleyfieldDossiers } from "@radar/domain";
  import { WEIGHTS, aggregate } from "@radar/scoring";
  import { Alert, Badge, Button, Card, EmptyState } from "@sentropic/design-system-svelte";
  import type { OpportunityDossierT } from "@radar/domain";
  import { appMode } from "$lib/state/mode.js";
  import { filterDossiersBySignalId, axesForMode } from "$lib/opportunites/funnel.js";
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

<section class="flex min-h-full flex-col bg-slate-50 p-6">
  <!-- ── Header ─────────────────────────────────────────────────────── -->
  <header class="mb-5">
    <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
      Analyse d'opportunité : Valleyfield
    </p>
    <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
      Dossiers d'opportunité foncière
    </h1>
    <p class="mt-1 text-sm text-slate-500">
      3 dossiers réels, entonnoir PROCESS 6 phases, preuves tracées, score agrégé honnête.
    </p>
  </header>

  <!-- ── Signal filter banner ───────────────────────────────────────── -->
  {#if selectedSignalId !== undefined}
    <div class="mb-5">
      <Alert tone="info" title="Filtré par signal : {selectedSignalLabel ?? selectedSignalId}">
        {#snippet actions()}
          <Button variant="ghost" size="sm" onclick={handleClearFilter}>
            Tout afficher
          </Button>
        {/snippet}
      </Alert>
    </div>
  {/if}

  <!-- ── Empty state ─────────────────────────────────────────────────── -->
  {#if filtered.length === 0}
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
    <!-- ── Master-detail layout ─────────────────────────────────────── -->
    <div class="grid min-h-0 flex-1 grid-cols-12 gap-5">

      <!-- ── LEFT: liste maître des opportunités (col-span-4) ────────── -->
      <div class="col-span-4 flex flex-col gap-2">
        <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Opportunités · {filtered.length} dossier{filtered.length > 1 ? "s" : ""}
        </p>
        {#each filtered as dossier (dossier.id)}
          {@const res = aggregate(axesForMode(dossier.axes, mode), WEIGHTS)}
          {@const s100 = scoreHundred(dossier)}
          {@const isSelected = (selectedDossier?.id ?? filtered[0]?.id) === dossier.id}
          {@const enAttente = isEnAttenteDePreuve(dossier)}
          <button
            type="button"
            class="w-full text-left"
            aria-current={isSelected ? "true" : undefined}
            on:click={() => handleSelect(dossier)}
          >
            <Card
              interactive
              class={isSelected ? "ring-2 ring-teal-500 ring-offset-1 bg-teal-50" : ""}
            >
              <div class={`p-3 ${isSelected ? "border-l-4 border-teal-500 pl-2.5" : ""}`}>
                <div class="flex items-center gap-1.5">
                  {#if isSelected}
                    <span class="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      Sélectionnée
                    </span>
                  {/if}
                  <p class="text-sm font-semibold leading-5 text-slate-900">
                    {dossier.title}
                  </p>
                </div>
                <p class="mt-0.5 text-xs text-slate-500">{dossier.address}</p>
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
      </div>

      <!-- ── RIGHT: panneau de détail ancré (col-span-8) ─────────────── -->
      <div class="col-span-8 min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-4">
        {#if selectedDossier}
          <DossierCard dossier={selectedDossier} {mode} />
        {/if}
      </div>

    </div>
  {/if}
</section>
