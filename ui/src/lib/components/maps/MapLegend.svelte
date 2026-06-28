<script lang="ts">
  /**
   * MapLegend — légende score de potentiel par lot.
   *
   * La couleur de la carte suit `potentialScore` sur l'échelle canonique 0-10.
   * Les compteurs de fallback rendent explicite les lots scorés sans score API
   * direct ou sans contexte zone/TOD suffisant.
   */
  import { scoreLegend } from "$lib/maps/score-color-scale.js";

  export let fallbackCount = 0;
  export let unavailableCount = 0;

  const legend = scoreLegend(null);
</script>

<div class="border-t border-slate-100 px-4 py-3" aria-label="Légende score lots">
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
