<script lang="ts">
  /**
   * SignauxRail — bande latérale gauche de la vue Signaux.
   *
   * Layout façon graphify ws-shell : rail gauche avec
   *  - Recherche villes (Search DS)
   *  - Filtres par type de nœud (facets pastille + badge count)
   *  - Accordéon par ville (DS Accordion + <details> natif) : clic → flyTo + sélection
   *  - Légende épinglée en bas (slot controls-footer via ViewLayout)
   */
  import { Search, Badge } from "@sentropic/design-system-svelte";
  import { RefreshCw } from "@lucide/svelte";
  import type { CityMapEntry } from "$lib/maps/maps-data.js";
  import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";

  // ── Props ──────────────────────────────────────────────────────────────────
  /** Toutes les entrées villes (avec signalCount6m). */
  export let entries: CityMapEntry[] = [];
  /** Ville actuellement sélectionnée. */
  export let selectedSlug: string | null = null;
  /** Nœuds de détail de la ville sélectionnée. */
  export let detailNodes: GraphSignalNode[] = [];
  /** Chargement de la liste principale. */
  export let loading = false;
  /** Chargement du détail de ville. */
  export let detailLoading = false;

  // ── Callbacks ──────────────────────────────────────────────────────────────
  /** Appelé quand l'utilisateur sélectionne une ville dans le rail. */
  export let onSelectCity: (entry: CityMapEntry) => void = () => {};
  /** Appelé pour actualiser les données. */
  export let onRefresh: () => void = () => {};

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

  /** Couleur de l'aplat choroplèthe selon le nb de signaux. */
  function signalColor(count: number): string {
    if (count === 0) return "#e2e8f0";
    if (count <= 2) return "#fbbf24";
    if (count <= 5) return "#f97316";
    return "#ef4444";
  }

  // ── Recherche ──────────────────────────────────────────────────────────────
  let searchQuery = "";

  // ── Facets par type de nœud ────────────────────────────────────────────────
  /** Collecte tous les types distincts depuis les nœuds de détail actuels. */
  $: allNodeTypes = Array.from(
    new Set(detailNodes.map((n) => n.type))
  ).sort();

  /** Ensemble des types exclus par l'utilisateur (toggle). */
  let excludedTypes = new Set<string>();

  function toggleType(type: string): void {
    if (excludedTypes.has(type)) {
      excludedTypes.delete(type);
    } else {
      excludedTypes.add(type);
    }
    excludedTypes = excludedTypes; // trigger reactivity
  }

  /** Nœuds filtrés selon les facets. */
  $: filteredNodes = detailNodes.filter((n) => !excludedTypes.has(n.type));

  // ── Compteur par type ──────────────────────────────────────────────────────
  $: countByType = detailNodes.reduce(
    (acc, n) => {
      acc[n.type] = (acc[n.type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  // ── Villes filtrées par recherche ─────────────────────────────────────────
  $: filteredEntries = searchQuery.trim()
    ? entries.filter((e) =>
        e.municipality.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
        (e.municipality.mrc ?? "").toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : entries;

  // ── Villes avec signaux en premier ────────────────────────────────────────
  $: sortedEntries = [...filteredEntries].sort(
    (a, b) => b.signalCount6m - a.signalCount6m
  ).slice(0, 60);

  // ── Compteur global ───────────────────────────────────────────────────────
  $: totalSignals = entries.reduce((s, e) => s + e.signalCount6m, 0);
  $: citiesWithSignals = entries.filter((e) => e.signalCount6m > 0).length;
</script>

<!-- Rail container -->
<div class="rail">

  <!-- En-tête du rail -->
  <div class="rail-head">
    <div class="flex items-center justify-between px-4 pt-3 pb-1">
      <span class="rail-kicker">Signaux · Villes</span>
      <button
        type="button"
        aria-label="Actualiser"
        class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
        on:click={onRefresh}
        disabled={loading}
      >
        <RefreshCw class={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
      </button>
    </div>

    <!-- Recherche villes (Search DS) -->
    <div class="px-3 pb-2">
      <Search
        placeholder="Rechercher une ville…"
        size="sm"
        bind:value={searchQuery}
        aria-label="Rechercher une ville"
      />
    </div>

    <!-- Compteur global -->
    <div class="border-b border-slate-100 px-4 pb-2 text-xs text-slate-500">
      {#if loading}
        <span class="text-slate-400">Chargement…</span>
      {:else}
        <span class="font-semibold text-slate-700">{totalSignals}</span> signal{totalSignals !== 1 ? "s" : ""}
        · <span class="font-semibold text-slate-700">{citiesWithSignals}</span> ville{citiesWithSignals !== 1 ? "s" : ""}
      {/if}
    </div>
  </div>

  <!-- Facets types de nœuds (visibles si ville sélectionnée avec nœuds) -->
  {#if allNodeTypes.length > 0}
    <div class="rail-section border-b border-slate-100 px-4 py-2">
      <p class="rail-kicker mb-1.5">Types de signaux</p>
      <ul class="flex flex-wrap gap-1.5" role="list">
        {#each allNodeTypes as type (type)}
          {@const excluded = excludedTypes.has(type)}
          {@const count = countByType[type] ?? 0}
          <li>
            <button
              type="button"
              class="rail-facet"
              class:rail-facet--excluded={excluded}
              aria-pressed={!excluded}
              on:click={() => toggleType(type)}
            >
              <span
                class="rail-swatch"
                style="background-color: {excluded ? '#cbd5e1' : typeColor(type)};"
                aria-hidden="true"
              ></span>
              <span class="rail-row-label">{type}</span>
              <span class="rail-row-count">{count}</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- Liste villes avec accordéon natif (<details>) -->
  <ul class="rail-list flex-1 overflow-y-auto divide-y divide-slate-50" role="list">
    {#if sortedEntries.length === 0 && !loading}
      <li class="rail-empty">
        {searchQuery ? "Aucune ville trouvée" : "Aucune donnée disponible"}
      </li>
    {:else}
      {#each sortedEntries as entry (entry.municipality.slug)}
        {@const isSelected = selectedSlug === entry.municipality.slug}
        <li>
          <!-- Accordéon natif <details> (pattern ws-acc) -->
          <details
            class="ws-acc ws-acc--compact"
            open={isSelected}
          >
            <summary
              class="ws-acc-summary"
              class:ws-acc-summary--active={isSelected}
              on:click|preventDefault={() => onSelectCity(entry)}
            >
              <!-- Pastille couleur signal -->
              <span
                class="rail-swatch"
                style="background-color: {signalColor(entry.signalCount6m)};"
                aria-hidden="true"
              ></span>
              <span class="rail-row-label">
                {entry.municipality.name}
                {#if entry.municipality.mrc}
                  <span class="rail-row-sublabel">{entry.municipality.mrc}</span>
                {/if}
              </span>
              {#if entry.signalCount6m > 0}
                <Badge tone="warning" class="rail-row-count shrink-0">
                  {entry.signalCount6m}
                </Badge>
              {:else}
                <span class="rail-row-count text-slate-300">0</span>
              {/if}
            </summary>

            <!-- Contenu accordéon : liste des signaux de la ville -->
            {#if isSelected}
              <div class="ws-acc-body">
                {#if detailLoading}
                  <div class="flex items-center gap-2 py-2 text-xs text-slate-400">
                    <RefreshCw class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Chargement…
                  </div>
                {:else if filteredNodes.length === 0 && detailNodes.length === 0}
                  <p class="text-xs text-slate-400 italic py-1">Aucun signal indexé pour cette ville.</p>
                {:else if filteredNodes.length === 0}
                  <p class="text-xs text-slate-400 italic py-1">Tous les types sont masqués.</p>
                {:else}
                  <ul class="space-y-1" role="list">
                    {#each filteredNodes.slice(0, 10) as node (node.id)}
                      <li class="signal-item">
                        <span
                          class="rail-swatch shrink-0"
                          style="background-color: {typeColor(node.type)};"
                          aria-hidden="true"
                        ></span>
                        <span class="min-w-0">
                          <span class="block truncate text-xs font-medium text-slate-800 leading-snug">
                            {node.label}
                          </span>
                          <span class="block text-xs text-slate-400 font-mono">{node.type}</span>
                        </span>
                      </li>
                    {/each}
                    {#if filteredNodes.length > 10}
                      <li class="text-xs text-slate-400 italic pl-4">
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

  .rail-section {
    flex-shrink: 0;
  }

  .rail-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  /* ── Kicker ── */
  .rail-kicker {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--st-semantic-text-muted, #94a3b8);
  }

  /* ── Pastille couleur ── */
  .rail-swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
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
    color: var(--st-semantic-text-primary, #1e293b);
  }

  .rail-row-sublabel {
    display: block;
    font-size: 0.7rem;
    font-weight: 400;
    color: var(--st-semantic-text-muted, #94a3b8);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Badge count pill ── */
  .rail-row-count {
    font-variant-numeric: tabular-nums;
    font-size: 0.7rem;
    border-radius: var(--st-radius-pill, 999px);
    flex-shrink: 0;
  }

  /* ── Facet toggle (type de signal) ── */
  .rail-facet {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.5rem;
    border-radius: var(--st-radius-sm, 4px);
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-default, #fff);
    transition: background 0.1s, opacity 0.1s;
    font-size: 0.72rem;
  }

  .rail-facet:hover {
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  .rail-facet--excluded {
    opacity: 0.45;
  }

  /* ── État vide ── */
  .rail-empty {
    padding: 0.75rem 1rem;
    font-size: 0.82rem;
    font-style: italic;
    color: var(--st-semantic-text-muted, #94a3b8);
  }

  /* ── Accordéon natif ws-acc (pattern graphify) ── */
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
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  .ws-acc-summary--active {
    background: #f0fdfa; /* teal-50 */
  }

  /* Chevron via ::before */
  .ws-acc-summary::before {
    content: "▸";
    font-size: 0.65rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    transition: transform 0.12s ease;
    flex-shrink: 0;
  }

  details[open] > .ws-acc-summary::before {
    transform: rotate(90deg);
  }

  .ws-acc-body {
    padding: 0.3rem 1rem 0.5rem 1.75rem;
  }

  /* ── Signal item dans l'accordéon ── */
  .signal-item {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.25rem 0;
  }
</style>
