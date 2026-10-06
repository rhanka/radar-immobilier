<script>
  // Le texte du dossier n'est pas réécrit : il est découpé sur ses titres de
  // niveau 2 et rendu tel quel, assaini par DOMPurify avant insertion. Un repère
  // <!-- chart:<id> --> insère le graphique correspondant (charts.js) à cet endroit ;
  // <!-- diagram:<id> --> et <!-- lanes:<id> --> un schéma du texte ; <!-- scene:<id> -->
  // une scène Focus (sources canoniques : SCENES_FOCUS.md), montée à l'ouverture de la
  // section pour que ses mesures (SvelteFlow, ajustement) se fassent sur une boîte visible.
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import BarChart from './BarChart.svelte';
  import MiniEr from './MiniEr.svelte';
  import SceneView from './SceneView.svelte';
  import { DOC_DIAGRAMS } from './doc-diagrams.js';
  import LaneDiagram from './LaneDiagram.svelte';
  import { docLanes, graphs } from './.generated/data.json';
  let { sections, label, open = true } = $props();
  const graphById = Object.fromEntries(graphs.map(graph => [graph.id, graph]));
  // Open state per section, set by the toggle event; until then, the `open` prop.
  let opened = $state({});
  const html = source => DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }));
  // Markers <!-- kind:<id> -->: [text, kind, id, text, kind, id, text…].
  const parts = source => {
    const split = source.split(/<!-- (chart|diagram|lanes|scene):([\w-]+) -->/g), out = [];
    for (let index = 0; index < split.length; index += 3) {
      out.push({ text: split[index] });
      if (index + 2 < split.length) out.push({ kind: split[index + 1], id: split[index + 2] });
    }
    return out;
  };
</script>

<section class="dossier-sections" aria-label={label}>
  {#each sections as section}
    <details class="dossier-section" data-section={section.id} {open} ontoggle={event => (opened[section.id] = event.currentTarget.open)}>
      <summary><span class="eyebrow">{section.id.startsWith('annexe') ? 'Annexe' : 'Section'}</span><strong>{section.heading}</strong></summary>
      <div class="prose">
        {#each parts(section.markdown) as part}
          {#if part.kind === 'chart'}<BarChart id={part.id} />
          {:else if part.kind === 'diagram'}<figure class="doc-diagram" data-doc-diagram={part.id}><figcaption><strong>{DOC_DIAGRAMS[part.id].title}</strong></figcaption><MiniEr id={`doc-${part.id}`} spec={DOC_DIAGRAMS[part.id]} /></figure>
          {:else if part.kind === 'lanes'}<figure class="doc-diagram" data-doc-lanes={part.id}><LaneDiagram graph={docLanes[part.id]} /></figure>
          {:else if part.kind === 'scene'}{#if opened[section.id] ?? open}<SceneView graph={graphById[part.id]} />{:else}<p class="scene-placeholder" data-scene-placeholder={part.id}>Scène <code>{part.id}</code> : affichée à l’ouverture de la section.</p>{/if}
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
  .scene-placeholder { font-size: .85rem; color: var(--st-semantic-text-secondary); }
</style>
