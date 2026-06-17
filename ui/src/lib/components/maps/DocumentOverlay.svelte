<script lang="ts">
  import { ExternalLink, X } from "@lucide/svelte";
  import type { SignalDocRef } from "$lib/signals/graph-signal-detail-client.js";

  export let documentRef: SignalDocRef | null = null;
  export let onClose: () => void = () => {};

  $: source = documentRef?.documentUrl ?? documentRef?.sourceUrl ?? null;
  $: pageSuffix =
    source && documentRef?.page !== undefined && !source.includes("#")
      ? `#page=${documentRef.page}`
      : "";
  $: iframeSrc = source ? `${source}${pageSuffix}` : null;

  function title(ref: SignalDocRef): string {
    return ref.title ?? ref.sourceUrl ?? ref.rawRef ?? ref.docSha;
  }
</script>

{#if documentRef}
  <section class="doc-overlay" aria-label="Document source">
    <div class="doc-overlay-head">
      <div class="doc-overlay-title">
        <span class="doc-overlay-kicker">Document source</span>
        <strong>{title(documentRef)}</strong>
      </div>
      <div class="doc-overlay-actions">
        {#if source}
          <a
            class="doc-overlay-icon"
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Ouvrir le document dans un nouvel onglet"
          >
            <ExternalLink class="h-4 w-4" aria-hidden="true" />
          </a>
        {/if}
        <button
          type="button"
          class="doc-overlay-icon"
          aria-label="Fermer le document"
          on:click={onClose}
        >
          <X class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>

    {#if documentRef.excerpt}
      <blockquote class="doc-overlay-citation">
        {documentRef.excerpt}
      </blockquote>
    {/if}

    {#if iframeSrc}
      <iframe
        class="doc-overlay-frame"
        title="Document source"
        src={iframeSrc}
      ></iframe>
    {:else}
      <div class="doc-overlay-empty">
        Document source non résolu.
      </div>
    {/if}
  </section>
{/if}

<style>
  .doc-overlay {
    position: absolute;
    inset: 1rem;
    z-index: 20;
    display: grid;
    grid-template-rows: auto auto 1fr;
    overflow: hidden;
    border: 1px solid var(--st-semantic-border-default, #cbd5e1);
    border-radius: var(--st-radius-md, 6px);
    background: var(--st-semantic-surface-default, #fff);
    box-shadow: 0 18px 45px rgb(15 23 42 / 0.2);
  }

  .doc-overlay-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-width: 0;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    padding: 0.65rem 0.8rem;
  }

  .doc-overlay-title {
    display: grid;
    min-width: 0;
    gap: 0.15rem;
  }

  .doc-overlay-title strong {
    overflow: hidden;
    color: var(--st-semantic-text-primary, #0f172a);
    font-size: 0.86rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .doc-overlay-kicker {
    color: var(--st-semantic-text-muted, #64748b);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .doc-overlay-actions {
    display: flex;
    flex-shrink: 0;
    gap: 0.35rem;
  }

  .doc-overlay-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: var(--st-radius-sm, 4px);
    background: var(--st-semantic-surface-default, #fff);
    color: var(--st-semantic-text-secondary, #475569);
    cursor: pointer;
  }

  .doc-overlay-icon:hover {
    background: var(--st-semantic-surface-subtle, #f8fafc);
  }

  .doc-overlay-citation {
    margin: 0;
    border-bottom: 1px solid #fde68a;
    background: #fffbeb;
    color: #713f12;
    padding: 0.55rem 0.8rem;
    font-size: 0.78rem;
    line-height: 1.45;
  }

  .doc-overlay-frame {
    width: 100%;
    height: 100%;
    border: 0;
    background: #f8fafc;
  }

  .doc-overlay-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--st-semantic-text-muted, #64748b);
    font-size: 0.82rem;
  }
</style>

