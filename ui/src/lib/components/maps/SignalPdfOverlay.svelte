<script lang="ts">
  import { ExternalLink, X } from "@lucide/svelte";

  export let title = "Document source";
  export let sourceUrl: string | null = null;
  export let sourceRef: string | null = null;
  export let rawRef: string | null = null;
  export let rawObjectKey: string | null = null;
  export let documentDate: string | null = null;
  export let page: number | null = null;
  export let bbox: [number, number, number, number] | null = null;
  export let excerpt: string | null = null;
  export let onClose: () => void = () => {};

  // Préfère sourceUrl (PDF public ou route streaming), puis rawRef via /api/documents/raw
  $: resolvedSourceUrl = sourceUrl ?? (rawRef ? `/api/documents/raw?rawRef=${encodeURIComponent(rawRef)}` : null);
  $: viewerUrl = resolvedSourceUrl ? withPage(resolvedSourceUrl, page) : null;
  $: canEmbed = viewerUrl !== null && (/^https?:\/\//u.test(viewerUrl) || viewerUrl.startsWith("/"));
  $: fallbackRef = rawRef ?? rawObjectKey ?? sourceRef;

  function withPage(url: string, pageNumber: number | null): string {
    if (pageNumber === null) return url;
    const parts = url.split("#", 2);
    const base = parts[0] ?? url;
    const hash = parts[1];
    const pageHash = `page=${pageNumber}`;
    return `${base}#${hash ? `${hash}&${pageHash}` : pageHash}`;
  }

  function formatBbox(value: [number, number, number, number] | null): string | null {
    return value ? value.map((n) => n.toFixed(3)).join(", ") : null;
  }
</script>

<div class="pdf-overlay-backdrop" aria-hidden="true" on:click={onClose}></div>
<aside class="pdf-overlay" aria-label="Preuve documentaire" role="dialog" aria-modal="true">
  <header class="pdf-overlay-head">
    <div class="pdf-overlay-title-block">
      <span class="pdf-overlay-kicker">Preuve</span>
      <h2 class="pdf-overlay-title">{title}</h2>
      <div class="pdf-overlay-meta">
        <span>Date : {documentDate ?? "non disponible"}</span>
        <span>Page : {page ?? "non disponible"}</span>
        <span>BBox : {formatBbox(bbox) ?? "non disponible"}</span>
      </div>
    </div>
    <button type="button" class="pdf-overlay-close" on:click={onClose} aria-label="Fermer la preuve documentaire">
      <X class="h-4 w-4" aria-hidden="true" />
    </button>
  </header>

  <div class="pdf-overlay-body">
    <section class="pdf-viewer" aria-label="Apercu du document source">
      {#if canEmbed && viewerUrl}
        <iframe title={title} src={viewerUrl}></iframe>
      {:else}
        <div class="pdf-missing">
          <p>Aucune URL PDF publique ou route de streaming n'est disponible pour cette preuve.</p>
          {#if fallbackRef}
            <code>{fallbackRef}</code>
          {:else}
            <span>La source documentaire est absente du DTO actuel.</span>
          {/if}
        </div>
      {/if}
    </section>

    <aside class="pdf-side" aria-label="Citation et provenance">
      <span class="pdf-side-label">Extrait cité</span>
      {#if excerpt}
        <blockquote>{excerpt}</blockquote>
      {:else}
        <p class="pdf-side-muted">Citation/extrait absent dans les données graphify actuelles.</p>
      {/if}

      <span class="pdf-side-label">Provenance</span>
      <dl class="pdf-provenance">
        {#if sourceUrl}
          <dt>URL</dt>
          <dd>
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
              Ouvrir <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </dd>
        {/if}
        {#if sourceRef}
          <dt>Source ref</dt>
          <dd><code>{sourceRef}</code></dd>
        {/if}
        {#if rawRef}
          <dt>Raw ref</dt>
          <dd><code>{rawRef}</code></dd>
        {/if}
        {#if rawObjectKey}
          <dt>Objet brut</dt>
          <dd><code>{rawObjectKey}</code></dd>
        {/if}
      </dl>
    </aside>
  </div>
</aside>

<style>
  .pdf-overlay-backdrop {
    position: absolute;
    inset: 0;
    z-index: 39;
    background: rgb(15 23 42 / 0.15);
  }

  .pdf-overlay {
    position: absolute;
    inset: 1.25rem;
    z-index: 40;
    display: flex;
    min-width: 18rem;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: var(--st-radius-md, 6px);
    background: var(--st-semantic-surface-default, #fff);
    box-shadow: 0 18px 50px rgb(15 23 42 / 0.3);
  }

  .pdf-overlay-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 0.85rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: #f8fafc;
  }

  .pdf-overlay-title-block {
    min-width: 0;
  }

  .pdf-overlay-kicker,
  .pdf-side-label {
    display: block;
    color: var(--st-semantic-text-muted, #64748b);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .pdf-overlay-title {
    margin: 0.15rem 0 0.35rem;
    color: var(--st-semantic-text-primary, #0f172a);
    font-size: 0.95rem;
    font-weight: 650;
    line-height: 1.25;
  }

  .pdf-overlay-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.72rem;
  }

  .pdf-overlay-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: var(--st-radius-sm, 4px);
    background: #fff;
    color: var(--st-semantic-text-secondary, #475569);
    cursor: pointer;
  }

  .pdf-overlay-close:hover {
    background: #f1f5f9;
  }

  .pdf-overlay-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
    min-height: 0;
    flex: 1;
  }

  .pdf-viewer {
    min-width: 0;
    min-height: 0;
    background: #e2e8f0;
  }

  .pdf-viewer iframe {
    width: 100%;
    height: 100%;
    border: 0;
    background: #fff;
  }

  .pdf-missing {
    display: grid;
    min-height: 100%;
    place-content: center;
    gap: 0.65rem;
    padding: 1.25rem;
    color: var(--st-semantic-text-secondary, #475569);
    text-align: center;
  }

  .pdf-missing p {
    margin: 0;
    font-size: 0.86rem;
  }

  .pdf-missing code,
  .pdf-provenance code {
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .pdf-side {
    min-width: 0;
    overflow-y: auto;
    border-left: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    padding: 0.85rem;
    background: #fff;
  }

  .pdf-side blockquote {
    margin: 0.45rem 0 0.9rem;
    border-left: 2px solid #eab308;
    padding-left: 0.55rem;
    color: var(--st-semantic-text-secondary, #334155);
    font-size: 0.82rem;
    line-height: 1.45;
  }

  .pdf-side-muted {
    margin: 0.45rem 0 0.9rem;
    color: var(--st-semantic-text-muted, #64748b);
    font-size: 0.78rem;
    font-style: italic;
  }

  .pdf-provenance {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.35rem 0.55rem;
    margin: 0.45rem 0 0;
    font-size: 0.74rem;
  }

  .pdf-provenance dt {
    color: var(--st-semantic-text-muted, #64748b);
    font-weight: 700;
  }

  .pdf-provenance dd {
    min-width: 0;
    margin: 0;
    color: var(--st-semantic-text-secondary, #334155);
  }

  .pdf-provenance a {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: #0f766e;
    font-weight: 650;
    text-decoration: none;
  }

  .pdf-provenance a:hover {
    text-decoration: underline;
  }

  @media (max-width: 900px) {
    .pdf-overlay {
      inset: 0.5rem;
    }

    .pdf-overlay-body {
      grid-template-columns: 1fr;
    }

    .pdf-side {
      max-height: 15rem;
      border-top: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
      border-left: 0;
    }
  }
</style>
