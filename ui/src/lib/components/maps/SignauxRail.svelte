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
   *   2. « Villes » : recherche + sous-accordéon par ville → flyTo
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
  import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";

  // ── Props ──────────────────────────────────────────────────────────────────
  /** Toutes les entrées villes (avec signalCount6m et subsetCounts). */
  export let entries: CityMapEntry[] = [];
  /** Ville actuellement sélectionnée. */
  export let selectedSlug: string | null = null;
  /** Nœuds de détail de la ville sélectionnée. */
  export let detailNodes: GraphSignalNode[] = [];
  /** Tous les nœuds vus (cache multi-villes pour les types connus). */
  export let knownNodeTypes: string[] = [];
  /** Chargement de la liste principale. */
  export let loading = false;
  /** Signal data failed to load; avoid rendering a fake zero state. */
  export let dataUnavailable = false;
  /** Chargement du détail de ville. */
  export let detailLoading = false;

  // ── Callbacks ──────────────────────────────────────────────────────────────
  /** Appelé quand l'utilisateur sélectionne une ville dans le rail. */
  export let onSelectCity: (entry: CityMapEntry) => void = () => {};
  /** Appelé pour actualiser les données. */
  export let onRefresh: () => void = () => {};
  export let onFilterChange: (subsetKey: string) => void = () => {};

  // ── Palette 12 couleurs par type (identique graphify) ─────────────────────
  const TYPE_PALETTE = [
    "#4f7cac", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#14b8a6",
    "#f97316", "#64748b", "#ec4899", "#22c55e", "#3b82f6", "#a855f7",
  ] as const;

  function typeColor(nodeType: string): string {
    let h = 0;
    for (let i = 0; i < nodeType.length; i++) h = (h * 31 + nodeType.charCodeAt(i)) >>> 0;
    return TYPE_PALETTE[h % TYPE_PALETTE.length];
  }

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
  let zonageOnly = true;

  /**
   * Multifamilial 4+ (DÉFAUT OFF — axe DIMENSION) :
   *   filtre sur la clé "m" de subsetCounts
   */
  let multi4plus = false;

  /**
   * Signaux précoces (DÉFAUT OFF — axe ANTICIPATION) :
   *   filtre sur la clé "p" de subsetCounts
   */
  let precoceOnly = false;

  /** Types disponibles = union des types connus (multi-villes) + types actuels. */
  $: allKnownTypes = Array.from(
    new Set([...knownNodeTypes, ...detailNodes.map((n) => n.type)])
  ).sort();

  /** Compteur par type (nœuds de la ville sélectionnée — filtre secondaire). */
  $: countByType = detailNodes.reduce(
    (acc, n) => {
      acc[n.type] = (acc[n.type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  /** Nœuds filtrés (affichage dans le panneau détail). */
  $: filteredNodes = detailNodes;

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

  // Propagate filter à l'init / au changement de clé active (réactif)
  $: onFilterChange(activeKey);

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
    return matchSearch && countFor(e, activeKey) > 0;
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
            label="Signaux précoces (approx.)"
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

    <!-- ── Section 2 : Villes (recherche + sous-accordéon) ─────────────────── -->
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

        <!-- Liste villes avec sous-accordéon natif (<details>) -->
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
                <!-- Sous-accordéon natif <details> (pattern ws-acc — Vague 2/3) -->
                <details
                  class="ws-acc ws-acc--compact"
                  open={isSelected}
                >
                  <summary
                    class="ws-acc-summary"
                    class:ws-acc-summary--active={isSelected}
                    on:click|preventDefault={() => onSelectCity(entry)}
                  >
                    <span class={`rail-status-dot rail-status-dot--${signalTone(activeCount)}`} aria-hidden="true"></span>
                    <span class="rail-row-label">
                      {entry.municipality.name}
                      {#if entry.municipality.mrc}
                        <span class="rail-row-sublabel">{entry.municipality.mrc}</span>
                      {/if}
                    </span>
                    <!-- Badge DS tonal sans override — remplace rail-row-count -->
                    {#if activeCount > 0}
                      <Badge tone="warning" aria-label="{activeCount} signaux">{activeCount}</Badge>
                    {:else}
                      <Badge tone="neutral">0</Badge>
                    {/if}
                  </summary>

                  <!-- Contenu sous-accordéon : signaux filtrés de la ville -->
                  {#if isSelected}
                    <div class="ws-acc-body">
                      {#if detailLoading}
                        <div class="rail-loading-row">
                          <!-- SVG spinner inline — zéro lucide -->
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            class="spin"
                            aria-hidden="true"
                          >
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                          </svg>
                          Chargement…
                        </div>
                      {:else if filteredNodes.length === 0 && detailNodes.length === 0}
                        <p class="rail-detail-empty">Aucun signal indexé pour cette ville.</p>
                      {:else if filteredNodes.length === 0}
                        <p class="rail-detail-empty">Tous les types sont masqués.</p>
                      {:else}
                        <ul class="space-y-1" role="list">
                          {#each filteredNodes.slice(0, 10) as node (node.id)}
                            <li class="signal-item">
                              <!--
                                Pastille type-couleur : typeColor() retourne une couleur de palette
                                12 couleurs, non mappable proprement sur les tones DS.
                              -->
                              <span
                                class="rail-type-dot"
                                style={`--type-color: ${typeColor(node.type)}`}
                                aria-hidden="true"
                              ></span>
                              <span class="min-w-0">
                                <span class="signal-label">{node.label}</span>
                                <span class="signal-type">{node.type}</span>
                              </span>
                            </li>
                          {/each}
                          {#if filteredNodes.length > 10}
                            <li class="rail-detail-empty rail-detail-more">
                              +{filteredNodes.length - 10} autres…
                            </li>
                          {/if}
                        </ul>
                      {/if}
                    </div>
                  {/if}
                </details>
              </li>
            {/each}
          {/if}
        </ul>
      </div>
    </details>

  </div>
</div>

<style>
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
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
    color: var(--st-semantic-text-muted, #64748b);
  }

  .rail-divider {
    height: 1px;
    background: var(--st-semantic-border-subtle, #e2e8f0);
  }

  .rail-status-dot,
  .rail-type-dot {
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

  .rail-type-dot {
    background: var(--type-color);
  }

  /* ── Compteur global ── */
  .rail-global-count {
    padding: 0 1rem 0.5rem;
    font-size: 0.75rem;
    color: var(--st-semantic-text-secondary);
  }

  .rail-muted {
    color: var(--st-semantic-text-muted);
  }

  .rail-count-strong {
    font-weight: 600;
    color: var(--st-semantic-text-primary);
  }

  /* ── Spin animation (refresh + detail loading) ── */
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
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--st-semantic-text-primary);
  }

  .rail-row-sublabel {
    display: block;
    font-size: 0.7rem;
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
    font-size: 0.65rem;
    color: var(--st-semantic-text-muted);
    transition: transform 0.12s ease;
    flex-shrink: 0;
  }

  details[open] > .rail-section-summary > .rail-section-chevron {
    transform: rotate(90deg);
  }

  /* ── Toggles axes (Zonage / Dimension / Anticipation) ── */
  .axis-toggle-row {
    border-bottom: 1px solid var(--st-semantic-border-subtle);
    padding: 0.4rem 0.75rem;
  }

  .axis-toggle-row--last {
    margin-bottom: 0.25rem;
  }

  /* Largeur pleine pour que le Checkbox DS remplisse la rangée (trailing poussé à droite) */
  .axis-toggle-row :global(.st-choice) {
    width: 100%;
  }

  /* ── État vide ── */
  .rail-empty {
    padding: 0.75rem 1rem;
    font-size: 0.82rem;
    font-style: italic;
    color: var(--st-semantic-text-muted);
  }

  /* ── Loading inline (detail) ── */
  .rail-loading-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0;
    font-size: 0.75rem;
    color: var(--st-semantic-text-muted);
  }

  /* ── Accordéon natif ws-acc (sous-accordéon villes — Vague 2/3) ── */
  :global(.ws-acc > summary) {
    list-style: none;
    cursor: pointer;
  }

  :global(.ws-acc > summary::-webkit-details-marker) {
    display: none;
  }

  .ws-acc-summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 1rem;
    cursor: pointer;
    user-select: none;
    transition: background 0.1s;
  }

  .ws-acc-summary:hover {
    background: var(--st-semantic-surface-subtle);
  }

  .ws-acc-summary--active {
    background: var(--st-semantic-surface-selected, var(--st-semantic-surface-subtle));
  }

  /* Chevron via ::before */
  .ws-acc-summary::before {
    content: "▸";
    font-size: 0.65rem;
    color: var(--st-semantic-text-muted);
    transition: transform 0.12s ease;
    flex-shrink: 0;
  }

  details[open] > .ws-acc-summary::before {
    transform: rotate(90deg);
  }

  .ws-acc-body {
    padding: 0.3rem 1rem 0.5rem 1.75rem;
  }

  /* ── Signal item dans le sous-accordéon ── */
  .signal-item {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.25rem 0;
  }

  .signal-label {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--st-semantic-text-primary);
    line-height: 1.35;
  }

  .signal-type {
    display: block;
    font-size: 0.75rem;
    color: var(--st-semantic-text-muted);
    font-family: monospace;
  }

  .rail-detail-empty {
    font-size: 0.75rem;
    color: var(--st-semantic-text-muted);
    font-style: italic;
    padding: 0.25rem 0;
  }

  .rail-detail-more {
    padding-left: 1rem;
  }
</style>
