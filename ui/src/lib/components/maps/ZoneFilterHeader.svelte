<script lang="ts">
  /**
   * ZoneFilterHeader — en-tête de filtre de l'accordéon ZONES du drawer droit.
   *
   * Filtre par TYPE de zone (kind) en chips ADDITIVES — mêmes catégories que
   * la légende zonage (`zone-kind-style` via `zone-kind-filter`, labels
   * dérivés, pas dupliqués). Seuls les types réellement présents dans les
   * zones de la ville active sont proposés (avec leur compte), comme la
   * légende. Compteur « N / M » zones matchées + Réinitialiser.
   *
   * ZÉRO refetch : chaque changement remonte le filtre au parent qui ne
   * recalcule que la peinture MapLibre (zones matchées accentuées,
   * hors-filtre estompées — jamais masquées).
   */
  import {
    countZoneKindMatches,
    isDefaultZoneKindFilter,
    zoneKindGroupCounts,
    ZONE_KIND_GROUPS,
    type ZoneKindFilter,
    type ZoneKindGroupId,
  } from "$lib/maps/zone-kind-filter.js";

  /** Zones de la ville active (affectation/kind + code suffisent au filtre). */
  export let zones: ReadonlyArray<{
    kind?: string | null;
    code: string;
    affectation?: string | null;
  }> = [];
  export let filter: ZoneKindFilter;
  export let onChange: (filter: ZoneKindFilter) => void = () => {};

  $: filterActive = !isDefaultZoneKindFilter(filter);
  $: matchedCount = countZoneKindMatches(zones, filter);
  $: groupCounts = zoneKindGroupCounts(zones);
  /** Chips proposées = groupes présents dans les zones (ordre de la légende). */
  $: visibleGroups = ZONE_KIND_GROUPS.filter((g) => (groupCounts.get(g.id) ?? 0) > 0);

  function toggleGroup(id: ZoneKindGroupId): void {
    const next = new Set(filter);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function reset(): void {
    onChange(new Set());
  }
</script>

<div class="fh" data-testid="signaux-zone-filter-header">
  <div class="fh-head">
    <span class="fh-name">Filtrer par type</span>
    <span class="fh-count" data-testid="signaux-zone-filter-count">
      <strong>{matchedCount.toLocaleString("fr-CA")}</strong>/{zones.length.toLocaleString("fr-CA")}
    </span>
    {#if filterActive}
      <button
        type="button"
        class="fh-reset"
        on:click={reset}
        data-testid="signaux-zone-filter-reset"
      >
        Réinitialiser
      </button>
    {/if}
  </div>

  <!-- Types de zone additifs (vide = tous) — catégories de la légende zonage -->
  <div class="fh-chips" role="group" aria-label="Filtre par type de zone (additif)">
    {#each visibleGroups as group (group.id)}
      {@const isActive = filter.has(group.id)}
      <button
        type="button"
        class="fh-chip"
        class:fh-chip--active={isActive}
        on:click={() => toggleGroup(group.id)}
        aria-pressed={isActive}
        data-testid={`signaux-zone-kind-${group.id}`}
      >
        {group.label}
        <span class="fh-chip-count">{groupCounts.get(group.id) ?? 0}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  /* Même langage visuel que LotFilterHeader (en-tête épinglé de bucket). */
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
</style>
