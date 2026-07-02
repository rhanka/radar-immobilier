<script lang="ts">
  import { Streamdown } from "svelte-streamdown";
  import { Badge, Button } from "@sentropic/design-system-svelte";
  import {
    RAPPORT_DATE,
    RAPPORT_MARKDOWN,
    SLIDES_HTML,
  } from "./rapport-content.js";

  // URL blob des slides, créée à la demande. Les slides sont compilées dans le
  // bundle (`?raw`, même dossier source que le rapport) : pas de route serveur
  // à exposer, et aucune divergence possible entre la vue et le document livré.
  let slidesUrl: string | null = null;

  function openSlides(): void {
    if (!slidesUrl) {
      slidesUrl = URL.createObjectURL(
        new Blob([SLIDES_HTML], { type: "text/html" }),
      );
    }
    window.open(slidesUrl, "_blank", "noopener");
  }
</script>

<div class="rapport-view">
  <div class="rapport-shell">
    <header class="rapport-header">
      <div class="rapport-heading">
        <h1 class="rapport-title">Rapport d'étude</h1>
        <p class="rapport-subtitle">
          Étude de faisabilité et de livraison — version de relecture client.
        </p>
        {#if RAPPORT_DATE}
          <Badge tone="info">Édition du {RAPPORT_DATE}</Badge>
        {/if}
      </div>
      <div class="rapport-actions">
        <Button type="button" variant="secondary" size="sm" onclick={openSlides}>
          Ouvrir les slides
        </Button>
      </div>
    </header>

    <article class="rapport-content">
      <Streamdown
        content={RAPPORT_MARKDOWN}
        parseIncompleteMarkdown={false}
        animation={{ enabled: false }}
        controls={{ code: false, mermaid: false, table: false }}
      />
    </article>
  </div>
</div>

<style>
  /* Habillage 100 % tokens DS (--st-*). Le DS n'expose pas d'échelle de titres
     en variables CSS : les tailles de titres/corps utilisent une échelle rem
     structurelle ; toutes les couleurs, bordures, rayons et familles de police
     viennent des tokens. */
  .rapport-view {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: var(--st-semantic-surface-subtle, #f8fafc);
    font-family: var(--st-font-sans, ui-sans-serif, system-ui, sans-serif);
    color: var(--st-semantic-text-primary, #0f172a);
  }

  .rapport-shell {
    max-width: 60rem;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }

  .rapport-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .rapport-heading {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    align-items: flex-start;
  }

  .rapport-title {
    margin: 0;
    font-family: var(--st-font-display, var(--st-font-sans, sans-serif));
    font-size: 1.75rem;
    line-height: 1.15;
    letter-spacing: -0.02em;
  }

  .rapport-subtitle {
    margin: 0;
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.9375rem;
  }

  .rapport-actions {
    flex: none;
    padding-top: 0.25rem;
  }

  .rapport-content {
    background: var(--st-semantic-surface-default, #fff);
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: var(--st-radius-lg, 12px);
    padding: 2rem 2.25rem 2.5rem;
  }

  /* ── Typo du markdown rendu (éléments produits par Streamdown) ─────────── */
  .rapport-content :global(h1) {
    font-family: var(--st-font-display, var(--st-font-sans, sans-serif));
    font-size: 1.5rem;
    line-height: 1.2;
    letter-spacing: -0.015em;
    margin: 2.25rem 0 0.75rem;
    padding-bottom: 0.375rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  }

  .rapport-content :global(h2) {
    font-size: 1.25rem;
    line-height: 1.25;
    margin: 2rem 0 0.625rem;
  }

  .rapport-content :global(h3) {
    font-size: 1.0625rem;
    line-height: 1.3;
    margin: 1.5rem 0 0.5rem;
  }

  .rapport-content :global(h4) {
    font-size: 0.9375rem;
    margin: 1.25rem 0 0.375rem;
  }

  .rapport-content :global(p),
  .rapport-content :global(li) {
    font-size: 0.9375rem;
    line-height: 1.6;
    color: var(--st-semantic-text-primary, #0f172a);
  }

  .rapport-content :global(p) {
    margin: 0.625rem 0;
  }

  .rapport-content :global(ul),
  .rapport-content :global(ol) {
    margin: 0.625rem 0;
    padding-left: 1.5rem;
  }

  .rapport-content :global(a) {
    color: var(--st-semantic-text-link, #2563eb);
  }

  .rapport-content :global(blockquote) {
    margin: 1rem 0;
    padding: 0.625rem 1rem;
    border-left: 3px solid var(--st-semantic-border-strong, #94a3b8);
    background: var(--st-semantic-surface-subtle, #f8fafc);
    border-radius: var(--st-radius-sm, 4px);
    color: var(--st-semantic-text-secondary, #475569);
  }

  .rapport-content :global(blockquote p) {
    color: inherit;
  }

  .rapport-content :global(code) {
    font-family: var(--st-font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
    background: var(--st-semantic-surface-subtle, #f1f5f9);
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: var(--st-radius-sm, 4px);
    padding: 0.0625rem 0.3125rem;
  }

  .rapport-content :global(pre) {
    background: var(--st-semantic-surface-subtle, #f8fafc);
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: var(--st-radius-md, 8px);
    padding: 1rem;
    overflow-x: auto;
  }

  .rapport-content :global(pre code) {
    background: none;
    border: none;
    padding: 0;
  }

  /* Tables : conteneur scrollable horizontal, styles tokens. */
  .rapport-content :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
    font-size: 0.8125rem;
  }

  .rapport-content :global(th),
  .rapport-content :global(td) {
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    padding: 0.5rem 0.625rem;
    text-align: left;
    vertical-align: top;
    line-height: 1.45;
  }

  .rapport-content :global(th) {
    background: var(--st-semantic-surface-subtle, #f8fafc);
    color: var(--st-semantic-text-secondary, #475569);
    font-weight: 600;
  }

  .rapport-content :global(hr) {
    border: none;
    border-top: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    margin: 2rem 0;
  }

  @media (max-width: 720px) {
    .rapport-header {
      flex-direction: column;
    }

    .rapport-content {
      padding: 1.25rem 1rem 1.75rem;
    }
  }
</style>
