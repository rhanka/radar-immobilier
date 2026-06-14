<script lang="ts">
  /**
   * SignauxRail — bande latérale gauche de la vue Signaux.
   *
   * Accordéon de 1er niveau à 2 sections (<details> natif) :
   *   1. « Signaux » (ouverte par défaut) : cases à cocher par type de signal
   *      → filtre GLOBAL (listes + recoloration aplats via callback)
   *   2. « Villes » : recherche + sous-accordéon par ville → flyTo
   *
   * Anti-invention : aucun appel API ici, tout par props.
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
  /** Tous les nœuds vus (cache multi-villes pour les types connus). */
  export let knownNodeTypes: string[] = [];
  /** Chargement de la liste principale. */
  export let loading = false;
  /** Chargement du détail de ville. */
  export let detailLoading = false;

  // ── Callbacks ──────────────────────────────────────────────────────────────
  /** Appelé quand l'utilisateur sélectionne une ville dans le rail. */
  export let onSelectCity: (entry: CityMapEntry) => void = () => {};
  /** Appelé pour actualiser les données. */
  export let onRefresh: () => void = () => {};
  /** Appelé quand le filtre types change (ensemble des types EXCLUS). */
  export let onFilterChange: (excluded: Set<string>) => void = () => {};

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

  // ── Section accordéon 1er niveau ──────────────────────────────────────────
  // Les deux sections sont ouvertes par défaut à l'init.

  // ── Types zonage (Signal + DesignationEvent — confirmé par requête SQL prod) ──
  const ZONAGE_TYPES = new Set(["Signal", "DesignationEvent"]);

  // ── Filtre GLOBAL par type (section Signaux) ───────────────────────────────
  /** Types disponibles = union des types connus (multi-villes) + types actuels. */
  $: allKnownTypes = Array.from(
    new Set([...knownNodeTypes, ...detailNodes.map((n) => n.type)])
  ).sort();

  /** Toggle « Zonage uniquement » — activé par défaut. */
  let zonageOnly = true;

  /** Ensemble des types exclus par l'utilisateur. */
  let excludedTypes = new Set<string>();

  /** Calcule l'ensemble des types exclus selon l'état du toggle zonage et des cases. */
  function computeExcluded(
    types: string[],
    excluded: Set<string>,
    zOnly: boolean,
  ): Set<string> {
    if (zOnly) {
      // Exclut tous les types sauf les types zonage
      return new Set(types.filter((t) => !ZONAGE_TYPES.has(t)));
    }
    return excluded;
  }

  /** Ensemble effectif des types exclus (tient compte du toggle zonage). */
  $: effectiveExcluded = computeExcluded(allKnownTypes, excludedTypes, zonageOnly);

  function toggleZonageOnly(): void {
    zonageOnly = !zonageOnly;
    if (zonageOnly) {
      // Quand on réactive zonage-only, on remet les cases à cocher à leur état initial
      excludedTypes = new Set<string>();
    }
    onFilterChange(effectiveExcluded);
  }

  function toggleType(type: string): void {
    if (excludedTypes.has(type)) {
      excludedTypes.delete(type);
    } else {
      excludedTypes.add(type);
    }
    excludedTypes = excludedTypes; // trigger reactivity
    onFilterChange(effectiveExcluded);
  }

  // Propagate filter on initial mount / when known types change
  $: onFilterChange(effectiveExcluded);

  // ── Compteur par type (nœuds de la ville sélectionnée) ────────────────────
  $: countByType = detailNodes.reduce(
    (acc, n) => {
      acc[n.type] = (acc[n.type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  // ── Nœuds filtrés selon les types cochés ──────────────────────────────────
  $: filteredNodes = detailNodes.filter((n) => !effectiveExcluded.has(n.type));

  // ── Recherche villes (section Villes) ─────────────────────────────────────
  let searchQuery = "";

  $: filteredEntries = searchQuery.trim()
    ? entries.filter((e) =>
        e.municipality.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
        (e.municipality.mrc ?? "").toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : entries;

  $: sortedEntries = [...filteredEntries].sort(
    (a, b) => b.signalCount6m - a.signalCount6m
  ).slice(0, 60);

  // ── Compteur filtré par ville (selon les types actifs) ─────────────────────
  function filteredCountForEntry(entry: CityMapEntry): number {
    if (effectiveExcluded.size === 0) return entry.signalCount6m;
    return Object.entries(entry.countsByType)
      .filter(([t]) => !effectiveExcluded.has(t))
      .reduce((s, [, n]) => s + n, 0);
  }

  // ── Compteurs globaux (réactifs au filtre) ────────────────────────────────
  $: totalSignals = entries.reduce((s, e) => s + filteredCountForEntry(e), 0);
  $: citiesWithSignals = entries.filter((e) => filteredCountForEntry(e) > 0).length;
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

  <!-- Corps scrollable : 2 sections accordéon natif -->
  <div class="rail-body flex-1 min-h-0 overflow-y-auto">

    <!-- ── Section 1 : Signaux (cases à cocher par type) ───────────────────── -->
    <details class="rail-section-acc" open>
      <summary class="rail-section-summary">
        <span class="rail-section-chevron" aria-hidden="true">▸</span>
        <span class="rail-section-title">Signaux</span>
        {#if effectiveExcluded.size > 0}
          <span class="rail-section-badge">{allKnownTypes.length - effectiveExcluded.size}/{allKnownTypes.length}</span>
        {/if}
      </summary>

      <div class="rail-section-body">
        <!-- Toggle « Zonage uniquement » — activé par défaut -->
        <div class="zonage-toggle-row px-3 pt-2 pb-1">
          <label class="rail-type-row">
            <input
              type="checkbox"
              class="rail-type-checkbox"
              checked={zonageOnly}
              on:change={toggleZonageOnly}
              aria-label="Zonage uniquement"
            />
            <span class="rail-row-label font-semibold text-slate-700">Zonage uniquement</span>
            {#if zonageOnly}
              <span class="zonage-badge">Signal · Désignation</span>
            {/if}
          </label>
        </div>

        {#if !zonageOnly}
          {#if allKnownTypes.length === 0}
            <p class="text-xs text-slate-400 italic px-4 py-2">
              Sélectionnez une ville pour voir les types de signaux.
            </p>
          {:else}
            <ul class="space-y-0.5 px-3 py-1" role="list">
              {#each allKnownTypes as type (type)}
                {@const excluded = excludedTypes.has(type)}
                {@const count = countByType[type] ?? null}
                <li>
                  <label
                    class="rail-type-row"
                    class:rail-type-row--excluded={excluded}
                  >
                    <input
                      type="checkbox"
                      class="rail-type-checkbox"
                      checked={!excluded}
                      on:change={() => toggleType(type)}
                      aria-label={type}
                    />
                    <span
                      class="rail-swatch"
                      style="background-color: {excluded ? '#cbd5e1' : typeColor(type)};"
                      aria-hidden="true"
                    ></span>
                    <span class="rail-row-label">{type}</span>
                    {#if count !== null}
                      <span class="rail-row-count text-slate-500">{count}</span>
                    {/if}
                  </label>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>
    </details>

    <!-- ── Section 2 : Villes (recherche + sous-accordéon) ─────────────────── -->
    <details class="rail-section-acc" open>
      <summary class="rail-section-summary">
        <span class="rail-section-chevron" aria-hidden="true">▸</span>
        <span class="rail-section-title">Villes</span>
      </summary>

      <div class="rail-section-body">
        <!-- Recherche villes (Search DS) -->
        <div class="px-3 pb-2 pt-1">
          <Search
            placeholder="Rechercher une ville…"
            size="sm"
            bind:value={searchQuery}
            aria-label="Rechercher une ville"
          />
        </div>

        <!-- Liste villes avec sous-accordéon natif (<details>) -->
        <ul class="divide-y divide-slate-50" role="list">
          {#if sortedEntries.length === 0 && !loading}
            <li class="rail-empty">
              {searchQuery ? "Aucune ville trouvée" : "Aucune donnée disponible"}
            </li>
          {:else}
            {#each sortedEntries as entry (entry.municipality.slug)}
              {@const isSelected = selectedSlug === entry.municipality.slug}
              {@const filteredCount = filteredCountForEntry(entry)}
              <li>
                <!-- Sous-accordéon natif <details> (pattern ws-acc) -->
                <details
                  class="ws-acc ws-acc--compact"
                  open={isSelected}
                >
                  <summary
                    class="ws-acc-summary"
                    class:ws-acc-summary--active={isSelected}
                    on:click|preventDefault={() => onSelectCity(entry)}
                  >
                    <!-- Pastille couleur signal (basée sur le compte filtré) -->
                    <span
                      class="rail-swatch"
                      style="background-color: {signalColor(filteredCount)};"
                      aria-hidden="true"
                    ></span>
                    <span class="rail-row-label">
                      {entry.municipality.name}
                      {#if entry.municipality.mrc}
                        <span class="rail-row-sublabel">{entry.municipality.mrc}</span>
                      {/if}
                    </span>
                    {#if filteredCount > 0}
                      <Badge tone="warning" class="rail-row-count shrink-0">
                        {filteredCount}
                      </Badge>
                    {:else}
                      <span class="rail-row-count text-slate-300">0</span>
                    {/if}
                  </summary>

                  <!-- Contenu sous-accordéon : signaux filtrés de la ville -->
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

  /* ── Accordéon de 1er niveau (sections Signaux / Villes) ── */
  .rail-section-acc {
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
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
    background: var(--st-semantic-surface-subtle, #f8fafc);
    transition: background 0.1s;
  }

  .rail-section-summary:hover {
    background: #f1f5f9; /* slate-100 */
  }

  .rail-section-title {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--st-semantic-text-muted, #94a3b8);
    flex: 1;
  }

  .rail-section-badge {
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
    color: var(--st-semantic-text-muted, #94a3b8);
    background: #e2e8f0;
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
  }

  .rail-section-chevron {
    font-size: 0.65rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    transition: transform 0.12s ease;
    flex-shrink: 0;
  }

  details[open] > .rail-section-summary > .rail-section-chevron {
    transform: rotate(90deg);
  }

  /* ── Type row (case à cocher + pastille + label) ── */
  .rail-type-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.22rem 0.3rem;
    border-radius: var(--st-radius-sm, 4px);
    cursor: pointer;
    transition: background 0.1s, opacity 0.1s;
    font-size: 0.8rem;
  }

  .rail-type-row:hover {
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  .rail-type-row--excluded {
    opacity: 0.5;
  }

  .rail-type-checkbox {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    accent-color: var(--st-semantic-accent, #3b82f6);
    cursor: pointer;
  }

  /* ── État vide ── */
  .rail-empty {
    padding: 0.75rem 1rem;
    font-size: 0.82rem;
    font-style: italic;
    color: var(--st-semantic-text-muted, #94a3b8);
  }

  /* ── Accordéon natif ws-acc (sous-accordéon villes) ── */
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

  /* ── Signal item dans le sous-accordéon ── */
  .signal-item {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.25rem 0;
  }

  /* ── Toggle « Zonage uniquement » ── */
  .zonage-toggle-row {
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    margin-bottom: 0.25rem;
  }

  .zonage-badge {
    font-size: 0.65rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    background: #e0f2fe; /* sky-100 */
    border-radius: 999px;
    padding: 0.1rem 0.4rem;
    white-space: nowrap;
    flex-shrink: 0;
  }
</style>
