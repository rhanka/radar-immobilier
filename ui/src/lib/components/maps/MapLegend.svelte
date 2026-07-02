<script lang="ts">
  /**
   * MapLegend — légende score de potentiel par lot + état du filtre carte.
   *
   * La couleur de la carte suit la hiérarchie de la vue Évaluation
   * (marques > priorité > 4+ > TOD > rampe `potentialScore` 0-10, cf.
   * eval-lot-filters). Les compteurs de fallback rendent explicites les lots
   * scorés sans score API direct ou sans contexte zone/TOD suffisant.
   *
   * Quand un filtre carte est actif, la légende affiche son résumé et le
   * compteur « N lots matchés / M » (les non-matchés restent visibles,
   * estompés).
   */
  import { scoreLegend } from "$lib/maps/score-color-scale.js";
  import { evalHierarchyLegend } from "$lib/maps/eval-lot-filters.js";

  export let fallbackCount = 0;
  export let unavailableCount = 0;
  /** Affiche la hiérarchie de couleur (marques/priorité/4+/TOD). */
  export let showHierarchy = false;
  /** Compteur de lots matchés par le filtre actif (null = pas de filtre). */
  export let matchedCount: number | null = null;
  /** Total des lots affichés sur la carte. */
  export let totalCount: number | null = null;
  /** Résumé lisible du filtre actif (null = aucun filtre). */
  export let activeFilterLabel: string | null = null;

  const legend = scoreLegend(null);
  const hierarchy = evalHierarchyLegend(null);
</script>

<div class="border-t border-slate-100 px-4 py-3" aria-label="Légende score lots">
  {#if activeFilterLabel !== null && matchedCount !== null && totalCount !== null}
    <p
      class="mb-2 rounded-lg border border-teal-100 bg-teal-50 px-2.5 py-1.5 text-xs text-teal-800"
      data-testid="legend-filter-state"
    >
      <span class="font-semibold tabular-nums">{matchedCount} lot{matchedCount !== 1 ? "s" : ""} matché{matchedCount !== 1 ? "s" : ""} / {totalCount}</span>
      <span class="text-teal-600"> · Filtre : {activeFilterLabel}</span>
      <span class="block text-[11px] text-teal-600/80">Les lots hors filtre restent visibles, estompés.</span>
    </p>
  {/if}
  {#if showHierarchy}
    <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Critères ciblage</p>
    <ul class="mb-2 grid gap-1.5 sm:grid-cols-2" data-testid="legend-hierarchy">
      {#each hierarchy as entry (entry.label)}
        <li class="flex items-center gap-1.5 text-xs text-slate-600">
          <span class="inline-block h-3 w-5 rounded-sm" style={`background:${entry.color}; opacity:0.72;`}></span>
          {entry.label}
        </li>
      {/each}
    </ul>
  {/if}
  <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Potentiel par lot</p>
  <ul class="grid gap-1.5 sm:grid-cols-2">
    {#each legend as entry (entry.label)}
      <li class="flex items-center gap-1.5 text-xs text-slate-600">
        <span class="inline-block h-3 w-5 rounded-sm" style={`background:${entry.color}; opacity:0.65;`}></span>
        {entry.label}
      </li>
    {/each}
  </ul>
  {#if fallbackCount > 0 || unavailableCount > 0}
    <p class="mt-2 text-xs text-amber-700">
      {fallbackCount} lot{fallbackCount !== 1 ? "s" : ""} avec fallback zone/TOD ·
      {unavailableCount} non disponible{unavailableCount !== 1 ? "s" : ""}.
    </p>
  {/if}
</div>
