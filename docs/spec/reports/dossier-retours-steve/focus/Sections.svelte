<script>
  // Le texte du dossier n'est pas réécrit : il est découpé sur ses titres de
  // niveau 2 et rendu tel quel, assaini par DOMPurify avant insertion. Un repère
  // <!-- chart:<id> --> insère le graphique correspondant (charts.js) à cet endroit.
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import BarChart from './BarChart.svelte';
  import MiniEr from './MiniEr.svelte';
  import { DOC_DIAGRAMS } from './doc-diagrams.js';
  import LaneDiagram from './LaneDiagram.svelte';
  import { docLanes } from './.generated/data.json';
  let { sections, label, open = true } = $props();
  const html = source => DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }));
  // Markers <!-- chart:<id> --> and <!-- diagram:<id> -->: [text, kind, id, text, kind, id, text…].
  const parts = source => {
    const split = source.split(/<!-- (chart|diagram|lanes):([\w-]+) -->/g), out = [];
    for (let index = 0; index < split.length; index += 3) {
      out.push({ text: split[index] });
      if (index + 2 < split.length) out.push({ kind: split[index + 1], id: split[index + 2] });
    }
    return out;
  };
</script>

<section class="dossier-sections" aria-label={label}>
  {#each sections as section}
    <details class="dossier-section" data-section={section.id} {open}>
      <summary><span class="eyebrow">Section</span><strong>{section.heading}</strong></summary>
      <div class="prose">
        {#each parts(section.markdown) as part}
          {#if part.kind === 'chart'}<BarChart id={part.id} />
          {:else if part.kind === 'diagram'}<figure class="doc-diagram" data-doc-diagram={part.id}><figcaption><strong>{DOC_DIAGRAMS[part.id].title}</strong></figcaption><MiniEr id={`doc-${part.id}`} spec={DOC_DIAGRAMS[part.id]} /></figure>
          {:else if part.kind === 'lanes'}<figure class="doc-diagram" data-doc-lanes={part.id}><LaneDiagram graph={docLanes[part.id]} /></figure>
          {:else}{@html html(part.text)}{/if}
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
  .doc-diagram { margin: 16px 0 22px; }
  .doc-diagram figcaption { margin-bottom: 6px; font-size: .95rem; }
</style>
