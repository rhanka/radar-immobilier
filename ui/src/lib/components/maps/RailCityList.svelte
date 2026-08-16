<script lang="ts">
  /**
   * RailCityList — liste PLATE de villes des rails gauches, PARTAGÉE
   * Signaux ↔ Sources (extraite de SignauxRail, iso-rendu : mêmes classes
   * `rail-city-list` / `rail-city-row` / `rail-city-row--active`).
   *
   * Recherche DS intégrée (nom/sous-libellé) sur la liste COMPLÈTE — aucun
   * plafond d'affichage (P02 : la recherche ne révèle rien que la liste
   * cache). Cliquer une ligne remonte le slug à la vue — la sélection, le vol
   * carto et le détail restent la POLITIQUE de la vue.
   */
  import { Search, Badge } from "@sentropic/design-system-svelte";
  import {
    filterRailCityItems,
    type RailCityItem,
  } from "$lib/maps/rail-city-items.js";

  /** Items déjà FILTRÉS/TRIÉS par la vue (hors recherche, portée par ici). */
  export let items: RailCityItem[] = [];
  /** Slug de la ville sélectionnée (surbrillance). */
  export let selectedSlug: string | null = null;
  /** Chargement de la liste principale (état vide silencieux). */
  export let loading = false;
  /** Données indisponibles : état vide honnête, pas un faux zéro. */
  export let dataUnavailable = false;
  /** Message d'état vide (hors recherche/indisponibilité). */
  export let emptyLabel = "Aucune donnée disponible";
  /** Appelé au clic d'une ligne ville. */
  export let onSelect: (slug: string) => void = () => {};

  let searchQuery = "";

  // Liste COMPLÈTE (aucun plafond — P02) : toute ville trouvable par la
  // recherche est présente dans la liste non filtrée. Seule la RECHERCHE
  // restreint l'affichage (filtre explicite de l'utilisateur). La ville
  // sélectionnée reste donc toujours listée hors recherche (garde #378),
  // portée par les items fournis par la vue.
  $: displayedItems = filterRailCityItems(items, searchQuery);
</script>

<!-- Recherche villes (Search DS fluid — remplit le rail) -->
<div class="px-3 pb-2 pt-1">
  <Search
    placeholder="Rechercher une ville…"
    size="sm"
    bind:value={searchQuery}
    aria-label="Rechercher une ville"
    class="w-full"
  />
</div>

<!-- Liste PLATE : cliquer sélectionne (highlight + politique de la vue). -->
<ul class="rail-city-list" role="list">
  {#if displayedItems.length === 0 && !loading}
    <li class="rail-empty">
      {#if dataUnavailable}
        Donnée indisponible
      {:else}
        {searchQuery ? "Aucune ville trouvée" : emptyLabel}
      {/if}
    </li>
  {:else}
    {#each displayedItems as item (item.slug)}
      {@const isSelected = selectedSlug === item.slug}
      <li>
        <button
          type="button"
          class="rail-city-row"
          class:rail-city-row--active={isSelected}
          aria-pressed={isSelected}
          on:click={() => onSelect(item.slug)}
        >
          {#if item.dotColor}
            <span
              class="rail-status-dot"
              style={`background: ${item.dotColor};`}
              aria-hidden="true"
            ></span>
          {:else}
            <span
              class={`rail-status-dot rail-status-dot--${item.dotTone ?? "neutral"}`}
              aria-hidden="true"
            ></span>
          {/if}
          <span class="rail-row-label">
            {item.name}
            {#if item.sublabel}
              <span class="rail-row-sublabel">{item.sublabel}</span>
            {/if}
          </span>
          <!-- Badge DS tonal sans override — statut/compteur de la ville -->
          <Badge tone={item.badge.tone} aria-label={item.badge.ariaLabel}>
            {item.badge.label}
          </Badge>
        </button>
      </li>
    {/each}
  {/if}
</ul>

<style>
  .rail-status-dot {
    display: inline-block;
    width: 0.625rem;
    height: 0.625rem;
    flex: 0 0 auto;
    border-radius: 999px;
  }

  .rail-status-dot--neutral {
    background: var(--st-semantic-surface-muted, #e2e8f0);
  }

  .rail-status-dot--warning {
    background: var(--st-semantic-warning, #f59e0b);
  }

  .rail-status-dot--error {
    background: var(--st-semantic-error, #ef4444);
  }

  /* ── Label tronqué ── */
  .rail-row-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--rail-fs-body, 0.8125rem);
    font-weight: 500;
    color: var(--st-semantic-text-primary);
  }

  .rail-row-sublabel {
    display: block;
    font-size: var(--rail-fs-caption, 0.6875rem);
    font-weight: 400;
    color: var(--st-semantic-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── État vide ── */
  .rail-empty {
    padding: 0.75rem 1rem;
    font-size: var(--rail-fs-body, 0.8125rem);
    font-style: italic;
    color: var(--st-semantic-text-muted);
  }

  /* ── Ligne ville PLATE (liste sélectionnable) ── */
  .rail-city-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.45rem 1rem;
    border: 0;
    background: transparent;
    text-align: left;
    font: inherit;
    cursor: pointer;
    user-select: none;
    transition: background 0.1s;
  }

  .rail-city-row:hover {
    background: var(--st-semantic-surface-subtle);
  }

  .rail-city-row--active {
    background: var(--st-semantic-surface-selected, var(--st-semantic-surface-subtle));
  }

  /* Badge trailing — ne rétrécit pas */
  .rail-city-row :global(.st-badge) {
    flex-shrink: 0;
  }
</style>
