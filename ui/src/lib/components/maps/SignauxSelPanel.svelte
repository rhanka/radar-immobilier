<script lang="ts">
  /**
   * SignauxSelPanel — panneau droit de sélection (façon graphify Sel).
   *
   * Apparaît quand une ville est sélectionnée.
   * Affiche : kicker type, titre ville, meta, et les nœuds de signaux
   * groupés par type (ws-acc compact).
   */
  import { Alert, Badge } from "@sentropic/design-system-svelte";
  import { RefreshCw, X } from "@lucide/svelte";
  import type { CityMapEntry } from "$lib/maps/maps-data.js";
  import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";

  // ── Props ──────────────────────────────────────────────────────────────────
  export let selectedCity: CityMapEntry | null = null;
  export let detailNodes: GraphSignalNode[] = [];
  export let detailLoading = false;
  export let detailError: string | null = null;
  /** Callback "fermer sélection". */
  export let onClear: () => void = () => {};

  // ── Palette 12 couleurs (identique rail) ──────────────────────────────────
  const TYPE_PALETTE = [
    "#4f7cac", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#14b8a6",
    "#f97316", "#64748b", "#ec4899", "#22c55e", "#3b82f6", "#a855f7",
  ] as const;

  function typeColor(nodeType: string): string {
    let h = 0;
    for (let i = 0; i < nodeType.length; i++) h = (h * 31 + nodeType.charCodeAt(i)) >>> 0;
    return TYPE_PALETTE[h % TYPE_PALETTE.length];
  }

  // ── Grouper les nœuds par type (buckets façon Sel) ────────────────────────
  $: nodesByType = detailNodes.reduce(
    (acc, node) => {
      if (!acc[node.type]) acc[node.type] = [];
      acc[node.type].push(node);
      return acc;
    },
    {} as Record<string, GraphSignalNode[]>,
  );

  $: typeBuckets = Object.entries(nodesByType).sort(
    ([, a], [, b]) => b.length - a.length
  );

  // ── Nœud sélectionné dans le panneau (drill-down) ────────────────────────
  let focusedNode: GraphSignalNode | null = null;

  function selectNode(node: GraphSignalNode): void {
    focusedNode = focusedNode?.id === node.id ? null : node;
  }
</script>

<div class="sel">
  <!-- En-tête : kicker + clear -->
  <div class="sel-head">
    <span class="sel-kicker">SÉLECTION</span>
    {#if selectedCity}
      <button
        type="button"
        class="sel-clear"
        on:click={onClear}
        aria-label="Fermer la sélection"
      >
        <X class="h-3.5 w-3.5" aria-hidden="true" />
        Fermer
      </button>
    {/if}
  </div>

  {#if !selectedCity}
    <!-- État vide -->
    <p class="sel-muted">
      Cliquez sur une ville dans la liste ou sur la carte pour voir ses signaux.
    </p>
  {:else}
    <!-- Détail de la ville sélectionnée -->
    <div class="sel-city-head">
      <span class="sel-kicker" style="color: #0f766e;">VILLE</span>
      <h2 class="sel-city-title">{selectedCity.municipality.name}</h2>
      {#if selectedCity.municipality.mrc}
        <p class="sel-city-meta">MRC : {selectedCity.municipality.mrc}</p>
      {/if}
      <p class="sel-city-meta">
        <Badge tone={selectedCity.signalCount6m > 0 ? "warning" : "neutral"}>
          {selectedCity.signalCount6m} signal{selectedCity.signalCount6m !== 1 ? "s" : ""}
        </Badge>
      </p>
    </div>

    {#if detailLoading}
      <div class="sel-loading">
        <RefreshCw class="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>Chargement des signaux…</span>
      </div>
    {:else if detailError}
      <div class="px-3 py-2">
        <Alert tone="error" title="Erreur" message={detailError} />
      </div>
    {:else if detailNodes.length === 0}
      <div class="px-3 py-2">
        <Alert
          tone="info"
          title="Aucun signal indexé"
          message="Cette ville n'a pas encore de nœuds Signal/DesignationEvent dans graph_nodes."
        />
      </div>
    {:else}
      <!-- Buckets par type (ws-acc compact) -->
      <div class="sel-buckets">
        {#each typeBuckets as [type, nodes] (type)}
          <details class="ws-acc ws-acc--compact sel-bucket" open>
            <summary class="sel-bucket-head">
              <span
                class="rail-swatch"
                style="background-color: {typeColor(type)};"
                aria-hidden="true"
              ></span>
              <span class="sel-bucket-name">{type}</span>
              <span class="rail-row-count">{nodes.length}</span>
            </summary>

            <div class="ws-acc-body sel-entities">
              {#each nodes as node (node.id)}
                {@const isFocused = focusedNode?.id === node.id}
                <div class="sel-entity-bar">
                  <button
                    type="button"
                    class="sel-entity-head"
                    class:sel-entity-head--focused={isFocused}
                    on:click={() => selectNode(node)}
                  >
                    <span class="sel-entity-label">{node.label}</span>
                    <span class="sel-entity-toggle" aria-hidden="true">
                      {isFocused ? "▾" : "▸"}
                    </span>
                  </button>

                  {#if isFocused}
                    <!-- Détail du nœud (façon entity panel graphify) -->
                    <div class="sel-entity-detail">
                      <div class="entity-meta">
                        {#if node.props?.reglement_number}
                          <div class="entity-meta-row">
                            <span class="entity-meta-key">Règlement</span>
                            <code class="entity-meta-val">{node.props.reglement_number}</code>
                          </div>
                        {/if}
                        {#if node.props?.zone_ref}
                          <div class="entity-meta-row">
                            <span class="entity-meta-key">Zone</span>
                            <code class="entity-meta-val">{node.props.zone_ref}</code>
                          </div>
                        {/if}
                        {#if node.createdAt}
                          <div class="entity-meta-row">
                            <span class="entity-meta-key">Créé</span>
                            <span class="entity-meta-val">
                              {new Date(node.createdAt).toLocaleDateString("fr-CA")}
                            </span>
                          </div>
                        {/if}
                        {#if node.sourceRef}
                          <div class="entity-meta-row">
                            <span class="entity-meta-key">Source</span>
                            <a
                              href={node.sourceRef}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="entity-meta-val entity-meta-link font-mono truncate"
                              title={node.sourceRef}
                            >
                              {node.sourceRef.length > 40
                                ? "…" + node.sourceRef.slice(-38)
                                : node.sourceRef}
                            </a>
                          </div>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </details>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* ── Sel container ── */
  .sel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    background: var(--st-semantic-surface-default, #fff);
  }

  /* ── En-tête ── */
  .sel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    flex-shrink: 0;
  }

  .sel-kicker {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--st-semantic-text-muted, #94a3b8);
  }

  .sel-clear {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.74rem;
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: var(--st-radius-sm, 4px);
    background: transparent;
    color: var(--st-semantic-text-secondary, #64748b);
    cursor: pointer;
    transition: background 0.1s;
  }

  .sel-clear:hover {
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  /* ── État vide ── */
  .sel-muted {
    padding: 0.6rem 0.85rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: 0.84rem;
    font-style: italic;
  }

  /* ── Ville sélectionnée ── */
  .sel-city-head {
    padding: 0.75rem 0.85rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    flex-shrink: 0;
  }

  .sel-city-title {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--st-semantic-text-primary, #1e293b);
    margin: 0.2rem 0 0.3rem;
  }

  .sel-city-meta {
    font-size: 0.78rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    margin: 0.15rem 0;
  }

  /* ── Chargement ── */
  .sel-loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 0.85rem;
    font-size: 0.82rem;
    color: var(--st-semantic-text-muted, #94a3b8);
  }

  /* ── Buckets ── */
  .sel-buckets {
    flex: 1;
    overflow-y: auto;
  }

  .sel-bucket {
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  }

  .sel-bucket-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.85rem;
    cursor: pointer;
    user-select: none;
    background: var(--st-semantic-surface-subtle, #f8fafc);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--st-semantic-text-secondary, #475569);
    list-style: none;
    transition: background 0.1s;
  }

  .sel-bucket-head:hover {
    background: #f0f9ff;
  }

  .sel-bucket-head::-webkit-details-marker {
    display: none;
  }

  /* Chevron bucket */
  .sel-bucket-head::before {
    content: "▸";
    font-size: 0.6rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    transition: transform 0.12s ease;
    flex-shrink: 0;
  }

  details[open] > .sel-bucket-head::before {
    transform: rotate(90deg);
  }

  .sel-bucket-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--st-font-mono, ui-monospace, monospace);
    font-size: 0.72rem;
  }

  .rail-row-count {
    font-variant-numeric: tabular-nums;
    font-size: 0.7rem;
    border-radius: var(--st-radius-pill, 999px);
    flex-shrink: 0;
    background: var(--st-semantic-surface-subtle, #f1f5f9);
    padding: 0 0.4rem;
    line-height: 1.5;
    color: var(--st-semantic-text-secondary, #64748b);
  }

  /* ── Entités dans le bucket ── */
  .sel-entities {
    padding: 0.25rem 0 0.5rem;
  }

  .sel-entity-bar {
    border-bottom: 1px solid var(--st-semantic-border-subtle, #f1f5f9);
  }

  .sel-entity-bar:last-child {
    border-bottom: none;
  }

  .sel-entity-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.3rem 0.85rem;
    font-size: 0.78rem;
    text-align: left;
    cursor: pointer;
    background: transparent;
    color: var(--st-semantic-text-primary, #1e293b);
    transition: background 0.1s;
  }

  .sel-entity-head:hover {
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  .sel-entity-head--focused {
    background: #eff6ff;
    color: var(--st-semantic-action-primary, #2563eb);
    font-weight: 600;
  }

  .sel-entity-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.78rem;
    line-height: 1.4;
  }

  .sel-entity-toggle {
    font-size: 0.62rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    flex-shrink: 0;
    margin-left: 0.3rem;
  }

  /* ── Pastille ── */
  .rail-swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* ── Détail nœud (entity panel) ── */
  .sel-entity-detail {
    padding: 0.4rem 0.85rem 0.6rem 1.2rem;
    background: #f8fafc;
    border-top: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  }

  .entity-meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2rem 0.6rem;
    align-items: baseline;
  }

  .entity-meta-row {
    display: contents;
  }

  .entity-meta-key {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--st-semantic-text-muted, #94a3b8);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    white-space: nowrap;
  }

  .entity-meta-val {
    font-size: 0.76rem;
    color: var(--st-semantic-text-primary, #1e293b);
    font-family: var(--st-font-mono, ui-monospace, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entity-meta-link {
    color: var(--st-semantic-action-primary, #2563eb);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .entity-meta-link:hover {
    color: #1d4ed8;
  }

  /* ── Accordéon dans le bucket ── */
  :global(.ws-acc.sel-bucket > summary) {
    list-style: none;
  }

  :global(.ws-acc.sel-bucket > summary::-webkit-details-marker) {
    display: none;
  }
</style>
