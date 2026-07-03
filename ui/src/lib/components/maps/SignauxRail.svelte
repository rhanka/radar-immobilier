<script lang="ts">
  /**
   * SignauxRail — bande latérale gauche de la vue Signaux.
   *
   * Accordéon de 1er niveau à 2 sections (<details> natif) :
   *   1. « Signaux » (ouverte par défaut) :
   *      - Toggle « Zonage uniquement » (DÉFAUT ON) — filtre PRIMAIRE
   *      - Toggle « Multifamilial 4+ » (DÉFAUT OFF) — axe DIMENSION
   *      - Toggle « Signaux précoces » (DÉFAUT OFF) — axe ANTICIPATION
   *      Les trois toggles sont COMBINABLES ; la base de comptage est
   *      l'intersection des filtres actifs.
   *   2. « Villes » : recherche + liste PLATE sélectionnable → flyTo.
   *      Cliquer une ville la sélectionne (highlight + ville active) ; ses
   *      signaux s'affichent à DROITE (SignauxSelPanel, bucket « Signaux »),
   *      PAS inline dans le rail (accordéon signaux supprimé).
   *
   * Slot `filters` : « Filtre Zones et Lots » (LotDataFilterPanel) fourni par
   * le parent, intercalé ENTRE la section Signaux et la section Villes.
   *
   * Anti-invention : aucun appel API ici, tout par props.
   *
   * Vague 1 DS (0.34.47+) : Overline · IconButton · Checkbox (desc+trailing) ·
   * Badge tonal · StatusDot (tone) · Search fluid · Divider
   * ZÉRO couleur hex en dur · ZÉRO override composant DS · ZÉRO icône lucide
   * ZÉRO checkbox/search bespoke.
   */
  import {
    Search,
    Badge,
    Button,
    Checkbox,
  } from "@sentropic/design-system-svelte";
  import type { CityMapEntry } from "$lib/maps/maps-data.js";

  // ── Props ──────────────────────────────────────────────────────────────────
  /** Toutes les entrées villes (avec signalCount6m et subsetCounts). */
  export let entries: CityMapEntry[] = [];
  /** Ville actuellement sélectionnée. */
  export let selectedSlug: string | null = null;
  /** Chargement de la liste principale. */
  export let loading = false;
  /** Signal data failed to load; avoid rendering a fake zero state. */
  export let dataUnavailable = false;

  /** Clé de filtre initiale (restaurée depuis l'URL au rechargement de page). */
  export let initialSubsetKey = "z|m|p";

  // ── Callbacks ──────────────────────────────────────────────────────────────
  /** Appelé quand l'utilisateur sélectionne une ville dans le rail. */
  export let onSelectCity: (entry: CityMapEntry) => void = () => {};
  /** Appelé pour actualiser les données. */
  export let onRefresh: () => void = () => {};
  export let onFilterChange: (subsetKey: string) => void = () => {};

  /**
   * Mappe le compte de signaux actifs vers un tone StatusDot DS.
   * 0 → neutral · 1–2 → warning · 3–5 → warning · >5 → error
   * (supprime signalColor hex)
   */
  function signalTone(count: number): "neutral" | "warning" | "error" {
    if (count === 0) return "neutral";
    if (count <= 5) return "warning";
    return "error";
  }

  // ── Toggles — filtres combinables TOP-DOWN ──────────────────────────────────
  /**
   * Zonage uniquement (DÉFAUT ON) :
   *   filtre sur la clé "z" de subsetCounts
   */
  let zonageOnly = initialSubsetKey.includes("z");

  /**
   * Multifamilial 4+ (DÉFAUT OFF — axe DIMENSION) :
   *   filtre sur la clé "m" de subsetCounts
   */
  let multi4plus = initialSubsetKey.includes("m");

  /**
   * Signaux précoces (DÉFAUT OFF — axe ANTICIPATION) :
   *   filtre sur la clé "p" de subsetCounts
   */
  let precoceOnly = initialSubsetKey.includes("p");

  /**
   * RESYNC au reload/navigation (bug #3) : `initialSubsetKey` est piloté par le
   * parent qui le recalcule au onMount (URL > localStorage > défaut). Les trois
   * `let` ci-dessus n'étant initialisés QU'UNE fois, ils restaient figés sur le
   * défaut quand le parent restaurait un filtre depuis l'URL → cases désyncs.
   * Ce bloc applique toute nouvelle `initialSubsetKey` aux cases (sans boucle :
   * il ne propage rien, il ne fait que refléter la source de vérité du parent).
   */
  let appliedInitialKey = initialSubsetKey;
  $: if (initialSubsetKey !== appliedInitialKey) {
    appliedInitialKey = initialSubsetKey;
    zonageOnly = initialSubsetKey.includes("z");
    multi4plus = initialSubsetKey.includes("m");
    precoceOnly = initialSubsetKey.includes("p");
  }

  /** Construit la clé subsetCounts à partir des 3 flags — fonction PURE. */
  function buildKey(z: boolean, m: boolean, p: boolean): string {
    const parts: string[] = [];
    if (z) parts.push("z");
    if (m) parts.push("m");
    if (p) parts.push("p");
    return parts.join("|");
  }

  /**
   * Clé active RÉACTIVE : dépend DIRECTEMENT des 3 toggles → Svelte la
   * recalcule à chaque toggle. (Le bug venait d'une fonction qui lisait les
   * toggles « cachés » dans son corps → Svelte ne voyait aucune dépendance,
   * donc les $: total/villes/tri/filtre ne re-tournaient jamais.)
   */
  $: activeKey = buildKey(zonageOnly, multi4plus, precoceOnly);

  function emitFilterChange(): void {
    onFilterChange(buildKey(zonageOnly, multi4plus, precoceOnly));
  }

  function toggleZonageOnly(): void {
    zonageOnly = !zonageOnly;
    emitFilterChange();
  }

  function toggleMulti4plus(): void {
    multi4plus = !multi4plus;
    emitFilterChange();
  }

  function togglePrecoceOnly(): void {
    precoceOnly = !precoceOnly;
    emitFilterChange();
  }

  // NOTE (bug #3) : on ne propage PLUS via un `$: onFilterChange(activeKey)`.
  // Ce bloc réactif tirait au MONTAGE avec la clé par défaut et écrasait le
  // filtre que le parent venait de restaurer depuis l'URL (perte au reload).
  // La propagation vers le parent vient désormais UNIQUEMENT d'un toggle
  // utilisateur explicite (toggleZonageOnly / toggleMulti4plus / togglePrecoceOnly
  // → emitFilterChange), qui est la seule source légitime d'écriture URL+LS.

  // ── Compteur actif par ville = subsetCounts[clé] ──────────────────────────
  /** Helper non-réactif : compte d'une ville pour une clé subsetCounts donnée. */
  function countFor(entry: CityMapEntry, key: string): number {
    return entry.subsetCounts[key] ?? 0;
  }



  // ── Recherche villes (section Villes) ─────────────────────────────────────
  let searchQuery = "";

  $: filteredEntries = entries.filter((e) => {
    const matchSearch = !searchQuery.trim() ||
      e.municipality.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
      (e.municipality.mrc ?? "").toLowerCase().includes(searchQuery.trim().toLowerCase());
    // #5 — garder la ville sélectionnée même si son compte pour le filtre actif est 0.
    const isSelected = selectedSlug !== null && e.municipality.slug === selectedSlug;
    return matchSearch && (countFor(e, activeKey) > 0 || isSelected);
  });

  $: sortedEntries = [...filteredEntries].sort(
    (a, b) => countFor(b, activeKey) - countFor(a, activeKey)
  ).slice(0, 60);

  // ── Compteurs globaux (réactifs : référencent activeKey directement) ──────
  $: totalSignals = entries.reduce((s, e) => s + countFor(e, activeKey), 0);
  $: citiesWithSignals = entries.filter((e) => countFor(e, activeKey) > 0).length;

  // ── Badges « funnel » RÉACTIFS : compte si on ajoute ce toggle à l'actif ──
  $: badgeZonage = entries.reduce(
    (s, e) => s + countFor(e, buildKey(true, multi4plus, precoceOnly)), 0);
  $: badgeMulti = entries.reduce(
    (s, e) => s + countFor(e, buildKey(zonageOnly, true, precoceOnly)), 0);
  $: badgePrecoce = entries.reduce(
    (s, e) => s + countFor(e, buildKey(zonageOnly, multi4plus, true)), 0);

  // ── Icône refresh SVG inline (DS-safe — zéro dépendance lucide) ───────────
  // Inline SVG minimaliste : arrow circulaire 14×14, accessible via IconButton DS.
  // Tourne via classe CSS animate-spin quand loading=true.
</script>

<!-- Rail container -->
<div class="rail">

  <!-- En-tête du rail -->
  <div class="rail-head">
    <div class="rail-head-row">
      <span class="rail-overline">Signaux · Villes</span>
      <Button
        type="button"
        aria-label="Actualiser"
        size="sm"
        variant="ghost"
        disabled={loading}
        onclick={onRefresh}
      >
        <!-- SVG refresh inline — aucune dépendance lucide -->
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class={loading ? "spin" : ""}
          aria-hidden="true"
        >
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      </Button>
    </div>

    <!-- Compteur global -->
    <div class="rail-global-count">
      {#if loading}
        <span class="rail-muted">Chargement…</span>
      {:else if dataUnavailable}
        <span class="font-semibold text-slate-700">Données des signaux indisponibles</span>
      {:else}
        <span class="rail-count-strong">{totalSignals}</span>
        {totalSignals !== 1 ? " signaux" : " signal"}
        · <span class="rail-count-strong">{citiesWithSignals}</span> ville{citiesWithSignals !== 1 ? "s" : ""}
      {/if}
    </div>
    <div class="rail-divider" aria-hidden="true"></div>
  </div>

  <!-- Corps scrollable : 2 sections accordéon natif -->
  <div class="rail-body flex-1 min-h-0 overflow-y-auto">

    <!-- ── Section 1 : Signaux — filtres combinables ───────────────────────── -->
    <details class="rail-section-acc" open>
      <summary class="rail-section-summary">
        <span class="rail-section-chevron" aria-hidden="true">▸</span>
        <span class="rail-overline">Signaux</span>
      </summary>

      <div class="rail-section-body">
        <!-- Toggle « Zonage uniquement » — filtre PRIMAIRE, activé par défaut -->
        <!-- Checkbox DS : label + description + slot trailing = Badge tonal info -->
        <div class="axis-toggle-row">
          <Checkbox
            label="Zonage uniquement"
            checked={zonageOnly}
            onchange={toggleZonageOnly}
          />
          {#if !loading}
            <Badge tone="info">{badgeZonage}</Badge>
          {/if}
        </div>

        <!-- Toggle « Multifamilial 4+ » — axe DIMENSION (OFF par défaut) -->
        <div class="axis-toggle-row">
          <Checkbox
            label="Multifamilial 4+"
            helperText="nb unités ≥ 4 ou intensité haute"
            checked={multi4plus}
            onchange={toggleMulti4plus}
          />
          {#if !loading}
            <Badge tone="warning">{badgeMulti}</Badge>
          {/if}
        </div>

        <!-- Toggle « Signaux précoces » — axe ANTICIPATION (OFF par défaut) -->
        <div class="axis-toggle-row axis-toggle-row--last">
          <Checkbox
            label="Signaux précoces"
            helperText="avis de motion / 1er projet"
            checked={precoceOnly}
            onchange={togglePrecoceOnly}
          />
          {#if !loading}
            <Badge tone="success">{badgePrecoce}</Badge>
          {/if}
        </div>
      </div>
    </details>

    <!-- ── « Filtre Zones et Lots » : ENTRE Signaux et Villes ──────────────── -->
    <!-- Contenu (LotDataFilterPanel) fourni par le parent — même logique de
         filtrage que depuis le drawer droit (zéro refetch), seule la position
         dans le layout change. -->
    <slot name="filters" />

    <!-- ── Section 2 : Villes (recherche + liste plate sélectionnable) ─────── -->
    <details class="rail-section-acc" open>
      <summary class="rail-section-summary">
        <span class="rail-section-chevron" aria-hidden="true">▸</span>
        <span class="rail-overline">Villes</span>
      </summary>

      <div class="rail-section-body">
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

        <!-- Liste PLATE de villes : cliquer sélectionne (highlight + vol carte).
             Les signaux de la ville active vivent à DROITE (SignauxSelPanel →
             bucket « Signaux ») — plus d'accordéon inline ici. -->
        <ul class="rail-city-list" role="list">
          {#if sortedEntries.length === 0 && !loading}
            <li class="rail-empty">
              {#if dataUnavailable}
                Donnée indisponible
              {:else}
                {searchQuery ? "Aucune ville trouvée" : "Aucune donnée disponible"}
              {/if}
            </li>
          {:else}
            {#each sortedEntries as entry (entry.municipality.slug)}
              {@const isSelected = selectedSlug === entry.municipality.slug}
              {@const activeCount = countFor(entry, activeKey)}
              <li>
                <button
                  type="button"
                  class="rail-city-row"
                  class:rail-city-row--active={isSelected}
                  aria-pressed={isSelected}
                  on:click={() => onSelectCity(entry)}
                >
                  <span class={`rail-status-dot rail-status-dot--${signalTone(activeCount)}`} aria-hidden="true"></span>
                  <span class="rail-row-label">
                    {entry.municipality.name}
                    {#if entry.municipality.mrc}
                      <span class="rail-row-sublabel">{entry.municipality.mrc}</span>
                    {/if}
                  </span>
                  <!-- Badge DS tonal sans override — compteur de signaux de la ville -->
                  {#if activeCount > 0}
                    <Badge tone="warning" aria-label="{activeCount} signaux">{activeCount}</Badge>
                  {:else}
                    <Badge tone="neutral">0</Badge>
                  {/if}
                </button>
              </li>
            {/each}
          {/if}
        </ul>
      </div>
    </details>

  </div>
</div>

<style>
  /*
   * Typographie Signaux alignée DS.
   * On centralise les tailles au niveau composant : plus de valeurs ad hoc pour
   * les libellés/fiches, tout passe par des aliases raccordés aux tokens DS.
   */
  .rail {
    --signaux-fs-overline: var(--st-component-label-fontSize, 0.6875rem);
    --signaux-fs-caption: var(--st-component-caption-fontSize, 0.6875rem);
    --signaux-fs-small: var(--st-component-tag-fontSize, 0.75rem);
    --signaux-fs-body: var(--st-component-body-sm-fontSize, 0.8125rem);
  }

  /* ── Rail container ── */
  .rail {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    scrollbar-gutter: stable;
  }

  .rail-head {
    flex-shrink: 0;
  }

  .rail-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }

  /* ── En-tête du rail ── */
  .rail-head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem 0.25rem;
  }

  .rail-overline {
    font-size: var(--signaux-fs-overline);
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
    color: var(--st-semantic-text-muted, #64748b);
  }

  .rail-divider {
    height: 1px;
    background: var(--st-semantic-border-subtle, #e2e8f0);
  }

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

  /* ── Compteur global ── */
  .rail-global-count {
    padding: 0 1rem 0.5rem;
    font-size: var(--signaux-fs-small);
    color: var(--st-semantic-text-secondary);
  }

  .rail-muted {
    color: var(--st-semantic-text-muted);
  }

  .rail-count-strong {
    font-weight: 600;
    color: var(--st-semantic-text-primary);
  }

  /* ── Spin animation (bouton refresh) ── */
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  /* ── Label tronqué ── */
  .rail-row-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--signaux-fs-body);
    font-weight: 500;
    color: var(--st-semantic-text-primary);
  }

  .rail-row-sublabel {
    display: block;
    font-size: var(--signaux-fs-caption);
    font-weight: 400;
    color: var(--st-semantic-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Accordéon de 1er niveau (sections Signaux / Villes) ── */
  .rail-section-acc {
    border-bottom: 1px solid var(--st-semantic-border-subtle);
  }

  .rail-section-acc > summary {
    list-style: none;
  }

  .rail-section-acc > summary::-webkit-details-marker {
    display: none;
  }

  .rail-section-summary {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 1rem;
    cursor: pointer;
    user-select: none;
    background: var(--st-semantic-surface-subtle);
    transition: background 0.1s;
  }

  .rail-section-summary:hover {
    background: var(--st-semantic-surface-hover, var(--st-semantic-surface-subtle));
  }

  .rail-section-chevron {
    font-size: var(--signaux-fs-caption);
    color: var(--st-semantic-text-muted);
    transition: transform 0.12s ease;
    flex-shrink: 0;
  }

  details[open] > .rail-section-summary > .rail-section-chevron {
    transform: rotate(90deg);
  }

  /* ── Toggles axes (Zonage / Dimension / Anticipation) ── */
  .axis-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle);
    padding: 0.4rem 0.75rem;
  }

  .axis-toggle-row--last {
    margin-bottom: 0.25rem;
  }

  /* Checkbox DS prend l'espace restant ; le badge reste en trailing flex-shrink:0 */
  .axis-toggle-row :global(.st-choice) {
    flex: 1;
    min-width: 0;
    /* Bug 3 : réduire la taille du label via le token DS Checkbox */
    --st-component-selection-choiceLabelFontSize: var(--signaux-fs-small);
  }

  /* Bug 3 : réduire la taille du helper text (sous-libellé) des filtres */
  .axis-toggle-row :global(.st-choice__help) {
    font-size: var(--signaux-fs-small);
  }

  /* Badge trailing dans la rangée toggle — ne rétrécit pas */
  .axis-toggle-row :global(.st-badge) {
    flex-shrink: 0;
  }

  /* ── État vide ── */
  .rail-empty {
    padding: 0.75rem 1rem;
    font-size: var(--signaux-fs-body);
    font-style: italic;
    color: var(--st-semantic-text-muted);
  }

  /* ── Ligne ville PLATE (liste sélectionnable, plus d'accordéon) ── */
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
</style>
