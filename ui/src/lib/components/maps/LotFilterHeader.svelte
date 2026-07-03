<script lang="ts">
  /**
   * LotFilterHeader — en-tête de filtre de l'accordéon LOTS du drawer droit
   * (ex-LotDataFilterPanel : le bloc autonome « Filtre Zones et Lots » du rail
   * gauche est SUPPRIMÉ ; le filtre lots vit désormais AU-DESSUS de la liste
   * des lots, visible quand l'accordéon est ouvert).
   *
   * Markup FIN au-dessus du module partagé `eval-lot-filters` (logique de
   * matching/compteurs identique à la vue Évaluation — AUCUNE duplication) :
   *   - catégorie EXCLUSIVE : Tout / 4+ logements / TOD / Priorité (compteurs) ;
   *   - usages ADDITIFS : Résidentiel, Multi, Commercial… (vide = tous) ;
   *   - superficie minimale (m²) ;
   *   - compteur « N / M » lots matchés + Réinitialiser.
   *
   * ZÉRO refetch : chaque changement remonte le filtre au parent qui recalcule
   * uniquement les expressions de peinture MapLibre (matchés accentués,
   * hors-filtre estompés — jamais masqués).
   */
  import type { LotFeature } from "$lib/maps/lots-client.js";
  import {
    EVAL_CATEGORIES,
    USAGE_GROUPS,
    countEvalMatches,
    isDefaultEvalFilter,
    isPriorite,
    isQuatrePlus,
    isTod,
    type EvalCategory,
    type EvalLotFilter,
    type UsageGroup,
  } from "$lib/maps/eval-lot-filters.js";

  export let lots: LotFeature[] = [];
  export let filter: EvalLotFilter;
  export let onChange: (filter: EvalLotFilter) => void = () => {};

  $: filterActive = !isDefaultEvalFilter(filter);
  $: matchedCount = countEvalMatches(lots, filter);
  $: categoryCounts = {
    all: lots.length,
    quatrePlus: lots.filter((f) => isQuatrePlus(f.properties)).length,
    tod: lots.filter((f) => isTod(f.properties)).length,
    priorite: lots.filter((f) => isPriorite(f.properties)).length,
  } as Record<EvalCategory, number>;

  function setCategory(category: EvalCategory): void {
    onChange({ ...filter, category });
  }

  function toggleUsage(usage: UsageGroup): void {
    const usages = new Set(filter.usages);
    if (usages.has(usage)) usages.delete(usage);
    else usages.add(usage);
    onChange({ ...filter, usages });
  }

  function setSuperficieMin(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    onChange({ ...filter, superficieMin: Number.isFinite(value) ? value : 0 });
  }

  function reset(): void {
    onChange({ category: "all", usages: new Set(), superficieMin: 0 });
  }
</script>

<div class="fh" data-testid="signaux-lot-filter-header">
  <div class="fh-head">
    <span class="fh-name">Filtrer les lots</span>
    <span class="fh-count" data-testid="signaux-filter-count">
      <strong>{matchedCount.toLocaleString("fr-CA")}</strong>/{lots.length.toLocaleString("fr-CA")}
    </span>
    {#if filterActive}
      <button
        type="button"
        class="fh-reset"
        on:click={reset}
        data-testid="signaux-filter-reset"
      >
        Réinitialiser
      </button>
    {/if}
  </div>

  <!-- Catégorie exclusive (compteurs par flag) -->
  <div class="fh-chips" role="group" aria-label="Filtre de ciblage (exclusif)">
    {#each EVAL_CATEGORIES as cat (cat.id)}
      <button
        type="button"
        class="fh-chip"
        class:fh-chip--active={filter.category === cat.id}
        on:click={() => setCategory(cat.id)}
        aria-pressed={filter.category === cat.id}
        data-testid={`signaux-filter-${cat.id}`}
      >
        {cat.label}
        <span class="fh-chip-count">{categoryCounts[cat.id]}</span>
      </button>
    {/each}
  </div>

  <!-- Usages additifs (vide = tous) -->
  <div class="fh-chips" role="group" aria-label="Filtre d'usage (additif)">
    {#each USAGE_GROUPS as usage (usage.id)}
      {@const isActive = filter.usages.has(usage.id)}
      <button
        type="button"
        class="fh-chip"
        class:fh-chip--active={isActive}
        on:click={() => toggleUsage(usage.id)}
        aria-pressed={isActive}
        data-testid={`signaux-usage-${usage.id}`}
      >
        {usage.label}
      </button>
    {/each}
  </div>

  <!-- Superficie minimale -->
  <div class="fh-slider-row">
    <label class="fh-slider-label" for="signaux-superficie-min">Superficie min.</label>
    <input
      id="signaux-superficie-min"
      type="range"
      min="0"
      max="5000"
      step="50"
      value={filter.superficieMin}
      on:input={setSuperficieMin}
      class="fh-slider"
      data-testid="signaux-superficie-slider"
    />
    <span class="fh-slider-value">
      {filter.superficieMin > 0
        ? `≥ ${filter.superficieMin.toLocaleString("fr-CA")} m²`
        : "Toutes"}
    </span>
  </div>
</div>

<style>
  /* En-tête AU-DESSUS de la liste des lots (accordéon ouvert) :
     fond subtil + filet bas pour le distinguer des fiches en dessous. */
  .fh {
    display: grid;
    gap: 0.45rem;
    padding: 0.5rem 0.85rem 0.6rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  .fh-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .fh-name {
    flex: 1;
    min-width: 0;
    font-size: var(--st-component-label-fontSize, 0.6875rem);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--st-semantic-text-muted, #94a3b8);
  }

  .fh-count {
    font-variant-numeric: tabular-nums;
    font-size: var(--st-component-label-fontSize, 0.6875rem);
    border-radius: var(--st-radius-pill, 999px);
    background: var(--st-semantic-surface-default, #fff);
    padding: 0 0.4rem;
    line-height: 1.5;
    color: var(--st-semantic-text-secondary, #64748b);
  }

  .fh-reset {
    border: 0;
    background: transparent;
    color: #0f766e;
    cursor: pointer;
    font-size: var(--st-component-tag-fontSize, 0.75rem);
    font-weight: 600;
    padding: 0;
  }

  .fh-reset:hover {
    text-decoration: underline;
  }

  .fh-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .fh-chip {
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: var(--st-radius-pill, 999px);
    background: var(--st-semantic-surface-default, #fff);
    color: var(--st-semantic-text-secondary, #64748b);
    cursor: pointer;
    font-size: var(--st-component-tag-fontSize, 0.75rem);
    padding: 0.15rem 0.55rem;
    transition: border-color 0.12s ease, background 0.12s ease;
  }

  .fh-chip:hover {
    border-color: var(--st-semantic-border-strong, #cbd5e1);
  }

  .fh-chip--active {
    border-color: #5eead4;
    background: #f0fdfa;
    color: #115e59;
    font-weight: 600;
  }

  .fh-chip-count {
    font-variant-numeric: tabular-nums;
    color: var(--st-semantic-text-muted, #94a3b8);
    margin-left: 0.15rem;
  }

  .fh-slider-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .fh-slider-label {
    flex-shrink: 0;
    font-size: var(--st-component-tag-fontSize, 0.75rem);
    color: var(--st-semantic-text-muted, #94a3b8);
  }

  .fh-slider {
    min-width: 0;
    flex: 1;
    accent-color: #0d9488;
  }

  .fh-slider-value {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    font-size: var(--st-component-tag-fontSize, 0.75rem);
    color: var(--st-semantic-text-secondary, #475569);
  }
</style>
