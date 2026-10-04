<script>
  // Le texte du dossier n'est pas réécrit : il est découpé sur ses titres de
  // niveau 2 et rendu tel quel, assaini par DOMPurify avant insertion. Un repère
  // <!-- chart:<id> --> insère le graphique correspondant (charts.js) à cet endroit.
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import BarChart from './BarChart.svelte';
  import { CHART_MARKER } from './charts.js';
  let { sections, label, open = true } = $props();
  const html = source => DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }));
  // Alternating text and chart ids: [text, id, text, id, text…].
  const parts = source => source.split(new RegExp(CHART_MARKER.source, 'g'));
</script>

<section class="dossier-sections" aria-label={label}>
  {#each sections as section}
    <details class="dossier-section" data-section={section.id} {open}>
      <summary><span class="eyebrow">Section</span><strong>{section.heading}</strong></summary>
      <div class="prose">
        {#each parts(section.markdown) as part, index}
          {#if index % 2}<BarChart id={part} />{:else}{@html html(part)}{/if}
        {/each}
      </div>
    </details>
  {/each}
</section>

<style>
  .dossier-sections { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; margin-block: 28px; }
  .dossier-section { min-width: 0; overflow-wrap: anywhere; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-default); padding: 16px 18px; margin-top: 0; }
  summary { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; cursor: pointer; }
  summary strong { font-size: 1.15rem; }
  .prose { margin-top: 14px; }
</style>
