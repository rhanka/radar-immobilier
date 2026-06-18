<script lang="ts">
  /**
   * SignauxSelPanel — right selection bucket for the Signaux map.
   *
   * The left rail keeps navigation light; this panel owns detailed cards for
   * selected entities: cities, graph signals, zones and lots.
   */
  import { Alert, Badge } from "@sentropic/design-system-svelte";
  import { FileText, RefreshCw, X } from "@lucide/svelte";
  import type { CityMapEntry } from "$lib/maps/maps-data.js";
  import {
    extractDocRefs,
    type GraphSignalNode,
    type SignalDocRef,
  } from "$lib/signals/graph-signal-detail-client.js";
  import type {
    GeoZoneFeature,
    GeoZonesResponse,
  } from "$lib/maps/geo-zones-client.js";
  import type {
    LotFeature,
    LotsResponse,
  } from "$lib/maps/lots-client.js";
  import {
    createSelectionBucketState,
    makeKey,
    selectionVisualState,
    type SelectionBucketState,
    type SelectionKey,
  } from "$lib/maps/selection-bucket.js";

  export let selectedCity: CityMapEntry | null = null;
  export let detailNodes: GraphSignalNode[] = [];
  export let detailLoading = false;
  export let detailError: string | null = null;
  export let geoLoading = false;
  export let geoError: string | null = null;
  export let zonesResponse: GeoZonesResponse | null = null;
  export let lotsResponse: LotsResponse | null = null;
  export let selectionState: SelectionBucketState = createSelectionBucketState();
  export let onClear: () => void = () => {};
  export let onToggleKey: (key: SelectionKey) => void = () => {};
  export let onFocusKey: (key: SelectionKey | null) => void = () => {};
  export let onOpenDocument: (ref: SignalDocRef) => void = () => {};

  $: zones = zonesResponse?.featureCollection.features ?? [];
  $: lots = lotsResponse?.featureCollection.features ?? [];
  $: visibleLots = lots.slice(0, 80);
  $: zonesUnavailableReason =
    zonesResponse?.warnings.includes("geo-collection-not-configured")
      ? "Zones non configurées dans l'API geo."
      : null;
  $: lotTotalCount = lotsResponse?.numberMatched ?? lots.length;
  $: hiddenLotCount = Math.max(0, lotTotalCount - visibleLots.length);
  $: lotsUnavailableReason =
    lotsResponse && !lotsResponse.ok
      ? lotsResponse.reason ?? "Lots non configurés dans l'API geo."
      : null;
  $: cityKey = selectedCity
    ? safeKey("municipality", selectedCity.municipality.slug)
    : null;

  function safeKey(kind: "municipality" | "signal" | "zone" | "lot", id: string): SelectionKey | null {
    try {
      return makeKey(kind, id);
    } catch {
      return null;
    }
  }

  function signalKey(node: GraphSignalNode): SelectionKey | null {
    return safeKey("signal", node.id);
  }

  function zoneKey(zone: GeoZoneFeature): SelectionKey | null {
    return safeKey("zone", `${zone.properties.citySlug}/${zone.properties.code}`);
  }

  function lotKey(lot: LotFeature): SelectionKey | null {
    const citySlug = lot.properties.citySlug ?? selectedCity?.municipality.slug;
    if (!citySlug) return null;
    return safeKey("lot", `${citySlug}/${lot.properties.noLot}`);
  }

  function visual(key: SelectionKey) {
    return selectionVisualState(selectionState, key);
  }

  function toggleEntity(key: SelectionKey): void {
    onToggleKey(key);
    onFocusKey(key);
  }

  function formatDate(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("fr-CA");
  }

  function readString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }

  function nodeDescription(node: GraphSignalNode): string | null {
    return (
      readString(node.description) ??
      readString(node.props.description) ??
      readString(node.props.desc) ??
      readString(node.props.summary) ??
      readString(node.props.resume) ??
      readString(node.props.abstract) ??
      readString(node.props.rationale) ??
      readString(node.props.justification) ??
      null
    );
  }

  function nodeReglement(node: GraphSignalNode): string | null {
    return (
      readString(node.props.reglement_number) ??
      readString(node.props.reglementNumber) ??
      readString(node.props.bylaw) ??
      null
    );
  }

  function nodeZoneRef(node: GraphSignalNode): string | null {
    const value =
      node.props.zone_ref ??
      node.props.zoneRef ??
      node.props.zone ??
      node.props.zones;
    if (Array.isArray(value)) return value.map(String).join(", ");
    return readString(value);
  }

  function docRefs(node: GraphSignalNode): SignalDocRef[] {
    return node.docRefs && node.docRefs.length > 0
      ? node.docRefs
      : extractDocRefs(node.props);
  }

  function signalPublishedAt(node: GraphSignalNode): string | null {
    return node.publishedAt ?? docRefs(node).find((ref) => ref.publishedAt)?.publishedAt ?? null;
  }

  function docButtonLabel(ref: SignalDocRef): string {
    return `PDF${ref.page !== undefined ? ` · p.${ref.page}` : ""}`;
  }

  function docTitle(ref: SignalDocRef): string {
    return ref.title ?? ref.sourceUrl ?? ref.rawRef ?? ref.docSha;
  }

  function formatSignalCount(count: number): string {
    return formatCount(count, "signal", "signaux");
  }

  function formatCount(count: number, singular: string, plural: string): string {
    return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
  }

  function formatNumber(count: number): string {
    return count.toLocaleString("fr-CA");
  }

  function nodeTypeLabel(type: string): string {
    if (type === "DesignationEvent") return "Événement de désignation";
    return type;
  }

  function zoneSourceLabel(zone: GeoZoneFeature): string {
    if (zone.properties.source === "official-zone") return "officiel";
    return "fallback lots";
  }

  function zoneGeometryLabel(zone: GeoZoneFeature): string {
    switch (zone.properties.geometryStatus) {
      case "official":
        return "géométrie officielle";
      case "lot-union-fallback":
        return "union de lots";
      case "text-only":
        return "référence texte";
      case "missing":
        return "géométrie manquante";
    }
  }

  function confidencePct(value: number): string {
    return `${Math.round(value * 100)} %`;
  }

  function lotScore(lot: LotFeature): string | null {
    const score = lot.properties.potentialScore;
    return typeof score === "number" ? `${score.toFixed(1)}/10` : null;
  }
</script>

<div class="sel">
  <div class="sel-head">
    <span class="sel-kicker">Sélection</span>
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
    <p class="sel-muted">
      Cliquez sur une ville dans la liste ou sur la carte pour constituer le bucket.
    </p>
  {:else}
    <div class="sel-city-head">
      <span class="sel-kicker" style="color: #0f766e;">Ville active</span>
      <h2 class="sel-city-title">{selectedCity.municipality.name}</h2>
      {#if selectedCity.municipality.mrc}
        <p class="sel-city-meta">MRC : {selectedCity.municipality.mrc}</p>
      {/if}
      <div class="sel-pill-row">
        <Badge tone={selectedCity.signalCount6m > 0 ? "warning" : "neutral"}>
          {formatSignalCount(selectedCity.signalCount6m)}
        </Badge>
        {#if zonesUnavailableReason}
          <Badge tone="neutral">zones non configurées</Badge>
        {:else}
          <Badge tone={zones.length > 0 ? "info" : "neutral"}>
            {zones.length} zone{zones.length !== 1 ? "s" : ""}
          </Badge>
        {/if}
        {#if lotsUnavailableReason}
          <Badge tone="neutral">lots non configurés</Badge>
        {:else}
          <Badge tone={lotTotalCount > 0 ? "success" : "neutral"}>
            {formatCount(lotTotalCount, "lot", "lots")}
          </Badge>
        {/if}
      </div>
    </div>

    {#if detailError}
      <div class="sel-alert">
        <Alert tone="error" title="Signaux indisponibles" message={detailError} />
      </div>
    {/if}
    {#if geoError}
      <div class="sel-alert">
        <Alert tone="warning" title="Zones/lots indisponibles" message={geoError} />
      </div>
    {/if}

    <div class="sel-buckets">
      <details class="sel-bucket" open>
        <summary class="sel-bucket-head">
          <span class="sel-bucket-name">Villes</span>
          <span class="rail-row-count">1</span>
        </summary>
        <div class="sel-entities">
          {#if cityKey}
            {@const cityVisual = visual(cityKey)}
            <button
              type="button"
              class="sel-entity-head"
              class:sel-entity-head--selected={cityVisual.selected}
              class:sel-entity-head--focused={cityVisual.focused}
              class:sel-entity-head--dimmed={cityVisual.dimmed}
              on:click={() => toggleEntity(cityKey)}
            >
              <span class="sel-entity-label">{selectedCity.municipality.name}</span>
              <span class="sel-entity-toggle" aria-hidden="true">▾</span>
            </button>
            {#if cityVisual.focused}
              <div class="sel-entity-detail">
                <div class="entity-meta">
                  <span class="entity-meta-key">Slug</span>
                  <code class="entity-meta-val">{selectedCity.municipality.slug}</code>
                  {#if selectedCity.municipality.mrc}
                    <span class="entity-meta-key">MRC</span>
                    <span class="entity-meta-val">{selectedCity.municipality.mrc}</span>
                  {/if}
                  <span class="entity-meta-key">Signaux</span>
                  <span class="entity-meta-val">{selectedCity.signalCount6m}</span>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      </details>

      <details class="sel-bucket" open>
        <summary class="sel-bucket-head">
          <span class="sel-bucket-name">Signaux</span>
          <span class="rail-row-count">{detailNodes.length}</span>
        </summary>
        <div class="sel-entities">
          {#if detailLoading}
            <div class="sel-loading">
              <RefreshCw class="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Chargement des signaux…</span>
            </div>
          {:else if detailNodes.length === 0}
            <p class="sel-empty">Aucun signal indexé pour cette ville.</p>
          {:else}
            {#each detailNodes as node (node.id)}
              {@const key = signalKey(node)}
              {#if key}
                {@const nodeVisual = visual(key)}
                <div class="sel-entity-bar">
                  <button
                    type="button"
                    class="sel-entity-head"
                    class:sel-entity-head--selected={nodeVisual.selected}
                    class:sel-entity-head--focused={nodeVisual.focused}
                    class:sel-entity-head--dimmed={nodeVisual.dimmed}
                    on:click={() => toggleEntity(key)}
                  >
                    <span class="sel-entity-label">{node.label}</span>
                    <span class="sel-entity-type">{nodeTypeLabel(node.type)}</span>
                  </button>

                  {#if nodeVisual.focused}
                    <div class="sel-entity-detail">
                      {#if nodeDescription(node)}
                        <p class="entity-summary">{nodeDescription(node)}</p>
                      {/if}
                      <div class="entity-meta">
                        {#if nodeReglement(node)}
                          <span class="entity-meta-key">Règlement</span>
                          <code class="entity-meta-val">{nodeReglement(node)}</code>
                        {/if}
                        {#if nodeZoneRef(node)}
                          <span class="entity-meta-key">Zone</span>
                          <code class="entity-meta-val">{nodeZoneRef(node)}</code>
                        {/if}
                        {#if formatDate(signalPublishedAt(node))}
                          <span class="entity-meta-key">Publié</span>
                          <span class="entity-meta-val">{formatDate(signalPublishedAt(node))}</span>
                        {:else if formatDate(node.createdAt)}
                          <span class="entity-meta-key">Ingestion</span>
                          <span class="entity-meta-val">{formatDate(node.createdAt)}</span>
                        {/if}
                      </div>

                      <div class="doc-refs-section">
                        <span class="doc-refs-label">Citation + PDF</span>
                        {#if docRefs(node).length === 0 && !node.sourceRef}
                          <p class="doc-refs-empty">Citation non liée dans cette version graphify.</p>
                        {:else}
                          <ul class="doc-refs-list">
                            {#each docRefs(node) as ref, i (`${ref.docSha}-${i}`)}
                              <li class="doc-ref-item">
                                {#if ref.documentUrl || ref.sourceUrl}
                                  <button
                                    type="button"
                                    class="doc-ref-link"
                                    title={docTitle(ref)}
                                    on:click={() => onOpenDocument(ref)}
                                  >
                                    <FileText class="h-3.5 w-3.5" aria-hidden="true" />
                                    {docButtonLabel(ref)}
                                  </button>
                                {:else}
                                  <span class="doc-ref-sha" title={ref.docSha}>
                                    {ref.docSha.slice(0, 8)}…{ref.page !== undefined ? ` · p.${ref.page}` : ""}
                                  </span>
                                {/if}
                                {#if ref.excerpt}
                                  <blockquote class="doc-ref-excerpt">
                                    {ref.excerpt.length > 180
                                      ? ref.excerpt.slice(0, 180) + "…"
                                      : ref.excerpt}
                                  </blockquote>
                                {/if}
                              </li>
                            {/each}
                          </ul>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      </details>

      <details class="sel-bucket" open>
        <summary class="sel-bucket-head">
          <span class="sel-bucket-name">Zones</span>
          <span class="rail-row-count">{zonesUnavailableReason ? "n/d" : zones.length}</span>
        </summary>
        <div class="sel-entities">
          {#if geoLoading}
            <div class="sel-loading">
              <RefreshCw class="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Chargement zones/lots…</span>
            </div>
          {:else if zonesUnavailableReason}
            <p class="sel-empty">{zonesUnavailableReason}</p>
          {:else if zones.length === 0}
            <p class="sel-empty">Aucune zone géométrique disponible.</p>
          {:else}
            {#if zonesResponse?.warnings.includes("lot-union-fallback-is-visual-only")}
              <p class="sel-warning">Fallback visuel : les zones sont dérivées de groupes de lots.</p>
            {/if}
            {#each zones as zone (`${zone.properties.citySlug}-${zone.properties.code}`)}
              {@const key = zoneKey(zone)}
              {#if key}
                {@const zoneVisual = visual(key)}
                <div class="sel-entity-bar">
                  <button
                    type="button"
                    class="sel-entity-head"
                    class:sel-entity-head--selected={zoneVisual.selected}
                    class:sel-entity-head--focused={zoneVisual.focused}
                    class:sel-entity-head--dimmed={zoneVisual.dimmed}
                    on:click={() => toggleEntity(key)}
                  >
                    <span class="sel-entity-label">
                      {zone.properties.label ?? zone.properties.code}
                    </span>
                    <span class="sel-entity-type">{zone.properties.code}</span>
                  </button>
                  {#if zoneVisual.focused}
                    <div class="sel-entity-detail">
                      <div class="entity-meta">
                        <span class="entity-meta-key">Code</span>
                        <code class="entity-meta-val">{zone.properties.code}</code>
                        <span class="entity-meta-key">Source</span>
                        <span class="entity-meta-val">{zoneSourceLabel(zone)}</span>
                        <span class="entity-meta-key">Géométrie</span>
                        <span class="entity-meta-val">{zoneGeometryLabel(zone)}</span>
                        <span class="entity-meta-key">Confiance</span>
                        <span class="entity-meta-val">{confidencePct(zone.properties.confidence)}</span>
                        <span class="entity-meta-key">Lots liés</span>
                        <span class="entity-meta-val">{zone.properties.lotCount}</span>
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      </details>

      <details class="sel-bucket">
        <summary class="sel-bucket-head">
          <span class="sel-bucket-name">Lots</span>
          <span class="rail-row-count">{lotsUnavailableReason ? "n/d" : formatNumber(lotTotalCount)}</span>
        </summary>
        <div class="sel-entities">
          {#if geoLoading}
            <div class="sel-loading">
              <RefreshCw class="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Chargement zones/lots…</span>
            </div>
          {:else if lotsUnavailableReason}
            <p class="sel-empty">{lotsUnavailableReason}</p>
          {:else if lots.length === 0}
            <p class="sel-empty">Aucun lot retourné par la collection geo.</p>
          {:else}
            {#if hiddenLotCount > 0}
              <p class="sel-warning">
                {formatNumber(visibleLots.length)} lots affichés sur {formatNumber(lotTotalCount)} disponibles.
              </p>
            {/if}
            {#each visibleLots as lot (lot.properties.noLot)}
              {@const key = lotKey(lot)}
              {#if key}
                {@const lotVisual = visual(key)}
                <div class="sel-entity-bar">
                  <button
                    type="button"
                    class="sel-entity-head"
                    class:sel-entity-head--selected={lotVisual.selected}
                    class:sel-entity-head--focused={lotVisual.focused}
                    class:sel-entity-head--dimmed={lotVisual.dimmed}
                    on:click={() => toggleEntity(key)}
                  >
                    <span class="sel-entity-label">{lot.properties.noLot}</span>
                    <span class="sel-entity-type">{lotScore(lot) ?? "lot"}</span>
                  </button>
                  {#if lotVisual.focused}
                    <div class="sel-entity-detail">
                      <div class="entity-meta">
                        <span class="entity-meta-key">Lot</span>
                        <code class="entity-meta-val">{lot.properties.noLot}</code>
                        {#if lot.properties.superficieM2 !== undefined && lot.properties.superficieM2 !== null}
                          <span class="entity-meta-key">Superficie</span>
                          <span class="entity-meta-val">{lot.properties.superficieM2} m²</span>
                        {/if}
                        {#if lotScore(lot)}
                          <span class="entity-meta-key">Potentiel</span>
                          <span class="entity-meta-val">{lotScore(lot)}</span>
                        {/if}
                        {#if lot.properties.zone}
                          <span class="entity-meta-key">Zone</span>
                          <span class="entity-meta-val">{lot.properties.zone.kind}</span>
                        {:else if lot.properties.zoneCode}
                          <span class="entity-meta-key">Zone</span>
                          <span class="entity-meta-val">{lot.properties.zoneCode}</span>
                        {/if}
                        <span class="entity-meta-key">Source</span>
                        <span class="entity-meta-val">{lotsResponse?.source ?? "inconnue"}</span>
                        {#if lotsResponse?.collectionId}
                          <span class="entity-meta-key">Collection</span>
                          <code class="entity-meta-val">{lotsResponse.collectionId}</code>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      </details>
    </div>
  {/if}
</div>

<style>
  .sel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    background: var(--st-semantic-surface-default, #fff);
  }

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
  }

  .sel-clear:hover {
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  .sel-muted,
  .sel-empty {
    padding: 0.6rem 0.85rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: 0.82rem;
    font-style: italic;
  }

  .sel-warning {
    margin: 0.35rem 0.85rem;
    color: #92400e;
    font-size: 0.74rem;
  }

  .sel-alert {
    padding: 0.5rem 0.85rem 0;
  }

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
    margin: 0.15rem 0 0.45rem;
  }

  .sel-pill-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .sel-loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 0.85rem;
    font-size: 0.82rem;
    color: var(--st-semantic-text-muted, #94a3b8);
  }

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
    padding: 0.45rem 0.85rem;
    cursor: pointer;
    user-select: none;
    background: var(--st-semantic-surface-subtle, #f8fafc);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--st-semantic-text-secondary, #475569);
    list-style: none;
  }

  .sel-bucket-head::-webkit-details-marker {
    display: none;
  }

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
    gap: 0.5rem;
    width: 100%;
    padding: 0.34rem 0.85rem;
    font-size: 0.78rem;
    text-align: left;
    cursor: pointer;
    background: transparent;
    color: var(--st-semantic-text-primary, #1e293b);
  }

  .sel-entity-head:hover {
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  .sel-entity-head--selected {
    background: #ecfdf5;
    color: #0f766e;
    font-weight: 600;
  }

  .sel-entity-head--focused {
    outline: 1px solid #14b8a6;
    outline-offset: -1px;
  }

  .sel-entity-head--dimmed {
    opacity: 0.5;
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

  .sel-entity-type {
    flex-shrink: 0;
    max-width: 7rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-family: var(--st-font-mono, ui-monospace, monospace);
    font-size: 0.68rem;
  }

  .sel-entity-toggle {
    font-size: 0.62rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    flex-shrink: 0;
    margin-left: 0.3rem;
  }

  .sel-entity-detail {
    padding: 0.45rem 0.85rem 0.65rem 1.15rem;
    background: #f8fafc;
    border-top: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  }

  .entity-summary {
    margin: 0 0 0.45rem;
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.78rem;
    line-height: 1.45;
  }

  .entity-meta {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.22rem 0.6rem;
    align-items: baseline;
  }

  .entity-meta-key {
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .entity-meta-val {
    min-width: 0;
    overflow: hidden;
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.76rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .doc-refs-section {
    margin-top: 0.55rem;
    border-top: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    padding-top: 0.5rem;
  }

  .doc-refs-label {
    display: block;
    margin-bottom: 0.35rem;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .doc-refs-empty {
    margin: 0;
    color: var(--st-semantic-text-muted, #94a3b8);
    font-size: 0.74rem;
    font-style: italic;
  }

  .doc-refs-list {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .doc-ref-link {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    border: 0;
    background: transparent;
    color: #0f766e;
    cursor: pointer;
    font-size: 0.74rem;
    font-weight: 600;
    text-decoration: none;
  }

  .doc-ref-link:hover {
    text-decoration: underline;
  }

  .doc-ref-sha {
    color: var(--st-semantic-text-muted, #94a3b8);
    font-family: var(--st-font-mono, ui-monospace, monospace);
    font-size: 0.72rem;
  }

  .doc-ref-excerpt {
    margin: 0.25rem 0 0;
    border-left: 2px solid #facc15;
    padding-left: 0.45rem;
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.75rem;
    line-height: 1.45;
  }
</style>
