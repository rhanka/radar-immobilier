<script lang="ts">
  /**
   * LotDataFilterPanel — panneau de FILTRES DONNÉES zones-lots (parité
   * concurrent, PR #315) porté dans la vue Signaux (rail droit).
   *
   * Markup FIN au-dessus du module partagé `eval-lot-filters` (logique de
   * matching/compteurs identique à la vue Évaluation — AUCUNE duplication) :
   *   - catégorie EXCLUSIVE : Tout / 4+ logements / TOD / Priorité (compteurs) ;
   *   - usages ADDITIFS : Résidentiel, Multi, Commercial… (vide = tous) ;
   *   - superficie minimale (m²) ;
   *   - compteur « N matchés / M » + Réinitialiser.
   *
   * ZÉRO refetch : chaque changement remonte le filtre au parent qui recalcule
   * uniquement les expressions de peinture MapLibre (estompage hors-filtre).
   *
   * Distinct des filtres de SIGNAUX (z|m|p, rail gauche) : ici on filtre les
   * DONNÉES cadastrales/zonage de la ville active.
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

<details class="ldf" open data-testid="signaux-data-filters">
  <summary class="ldf-head">
    <span class="ldf-name">Filtres données</span>
    <span class="ldf-count" data-testid="signaux-filter-count">
      <strong>{matchedCount.toLocaleString("fr-CA")}</strong>/{lots.length.toLocaleString("fr-CA")}
    </span>
  </summary>
  <div class="ldf-body">
    {#if filterActive}
      <div class="ldf-reset-row">
        <button
          type="button"
          class="ldf-reset"
          on:click={reset}
          data-testid="signaux-filter-reset"
        >
          Réinitialiser
        </button>
      </div>
    {/if}

    <!-- Catégorie exclusive (compteurs par flag) -->
    <div class="ldf-chips" role="group" aria-label="Filtre de ciblage (exclusif)">
      {#each EVAL_CATEGORIES as cat (cat.id)}
        <button
          type="button"
          class="ldf-chip"
          class:ldf-chip--active={filter.category === cat.id}
          on:click={() => setCategory(cat.id)}
          aria-pressed={filter.category === cat.id}
          data-testid={`signaux-filter-${cat.id}`}
        >
          {cat.label}
          <span class="ldf-chip-count">{categoryCounts[cat.id]}</span>
        </button>
      {/each}
    </div>

    <!-- Usages additifs (vide = tous) -->
    <div class="ldf-chips" role="group" aria-label="Filtre d'usage (additif)">
      {#each USAGE_GROUPS as usage (usage.id)}
        {@const isActive = filter.usages.has(usage.id)}
        <button
          type="button"
          class="ldf-chip"
          class:ldf-chip--active={isActive}
          on:click={() => toggleUsage(usage.id)}
          aria-pressed={isActive}
          data-testid={`signaux-usage-${usage.id}`}
        >
          {usage.label}
        </button>
      {/each}
    </div>

    <!-- Superficie minimale -->
    <div class="ldf-slider-row">
      <label class="ldf-slider-label" for="signaux-superficie-min">Superficie min.</label>
      <input
        id="signaux-superficie-min"
        type="range"
        min="0"
        max="5000"
        step="50"
        value={filter.superficieMin}
        on:input={setSuperficieMin}
        class="ldf-slider"
        data-testid="signaux-superficie-slider"
      />
      <span class="ldf-slider-value">
        {filter.superficieMin > 0
          ? `≥ ${filter.superficieMin.toLocaleString("fr-CA")} m²`
          : "Toutes"}
      </span>
    </div>
  </div>
</details>

<style>
  .ldf {
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-default, #fff);
    flex-shrink: 0;
  }

  .ldf-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.85rem;
    cursor: pointer;
    user-select: none;
    background: var(--st-semantic-surface-subtle, #f8fafc);
    font-size: var(--st-component-body-sm-fontSize, 0.8125rem);
    font-weight: 600;
    color: var(--st-semantic-text-secondary, #475569);
    list-style: none;
  }

  .ldf-head::-webkit-details-marker {
    display: none;
  }

  .ldf-head::before {
    content: "▸";
    font-size: var(--st-component-caption-fontSize, 0.6875rem);
    color: var(--st-semantic-text-muted, #94a3b8);
    transition: transform 0.12s ease;
    flex-shrink: 0;
  }

  details[open] > .ldf-head::before {
    transform: rotate(90deg);
  }

  .ldf-name {
    flex: 1;
    min-width: 0;
  }

  .ldf-count {
    font-variant-numeric: tabular-nums;
    font-size: var(--st-component-label-fontSize, 0.6875rem);
    border-radius: var(--st-radius-pill, 999px);
    background: var(--st-semantic-surface-subtle, #f1f5f9);
    padding: 0 0.4rem;
    line-height: 1.5;
    color: var(--st-semantic-text-secondary, #64748b);
  }

  .ldf-body {
    padding: 0.5rem 0.85rem 0.65rem;
    display: grid;
    gap: 0.45rem;
  }

  .ldf-reset-row {
    display: flex;
    justify-content: flex-end;
  }

  .ldf-reset {
    border: 0;
    background: transparent;
    color: #0f766e;
    cursor: pointer;
    font-size: var(--st-component-tag-fontSize, 0.75rem);
    font-weight: 600;
    padding: 0;
  }

  .ldf-reset:hover {
    text-decoration: underline;
  }

  .ldf-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .ldf-chip {
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: var(--st-radius-pill, 999px);
    background: var(--st-semantic-surface-default, #fff);
    color: var(--st-semantic-text-secondary, #64748b);
    cursor: pointer;
    font-size: var(--st-component-tag-fontSize, 0.75rem);
    padding: 0.15rem 0.55rem;
    transition: border-color 0.12s ease, background 0.12s ease;
  }

  .ldf-chip:hover {
    border-color: var(--st-semantic-border-strong, #cbd5e1);
  }

  .ldf-chip--active {
    border-color: #5eead4;
    background: #f0fdfa;
    color: #115e59;
    font-weight: 600;
  }

  .ldf-chip-count {
    font-variant-numeric: tabular-nums;
    color: var(--st-semantic-text-muted, #94a3b8);
    margin-left: 0.15rem;
  }

  .ldf-slider-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .ldf-slider-label {
    flex-shrink: 0;
    font-size: var(--st-component-tag-fontSize, 0.75rem);
    color: var(--st-semantic-text-muted, #94a3b8);
  }

  .ldf-slider {
    min-width: 0;
    flex: 1;
    accent-color: #0d9488;
  }

  .ldf-slider-value {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    font-size: var(--st-component-tag-fontSize, 0.75rem);
    color: var(--st-semantic-text-secondary, #475569);
  }
</style>
