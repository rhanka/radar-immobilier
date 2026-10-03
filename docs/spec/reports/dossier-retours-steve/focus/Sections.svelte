<script>
  // Le texte du dossier n'est pas réécrit : il est découpé sur ses titres de
  // niveau 2 et rendu tel quel, assaini par DOMPurify avant insertion.
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  let { sections, label, open = true } = $props();
  const html = source => DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }));
</script>

<section class="dossier-sections" aria-label={label}>
  {#each sections as section}
    <details class="dossier-section" data-section={section.id} {open}>
      <summary><span class="eyebrow">Section</span><strong>{section.heading}</strong></summary>
      <div class="prose">{@html html(section.markdown)}</div>
    </details>
  {/each}
</section>

<style>
  .dossier-sections { display: grid; gap: 14px; margin-block: 28px; }
  .dossier-section { border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-default); padding: 16px 18px; margin-top: 0; }
  summary { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; cursor: pointer; }
  summary strong { font-size: 1.15rem; }
  .prose { margin-top: 14px; }
</style>
