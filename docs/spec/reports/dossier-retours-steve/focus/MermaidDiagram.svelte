<script>
  // Flowchart of the text (decision rule of chapter 3, D10 test diagram), rendered by mermaid
  // in the page (offline bundle, strict security level) and framed by ZoomFrame: fit to
  // width, zoom, pan, full screen. The Mermaid source stays in the Markdown of the dossier.
  import mermaid from 'mermaid';
  import ZoomFrame from './ZoomFrame.svelte';
  let { id, source, label = id } = $props();
  let svg = $state(''), failed = $state(false);
  // Natural width of the drawing (viewBox), so that ZoomFrame fits it to the page width.
  const width = $derived(Math.ceil(Number(svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) /)?.[1] ?? 0)) || null);
  const dark = () => document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  $effect(() => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark() ? 'dark' : 'neutral', flowchart: { useMaxWidth: false } });
    mermaid.render(`mermaid-${id}`, source).then(result => { svg = result.svg; }, () => { failed = true; });
  });
</script>

<div class="diagram" data-diagram={id} data-diagram-kind="mermaid">
  {#if failed}<pre>{source}</pre>
  {:else}<ZoomFrame {id} {label} {width} inline={true}><div class="mermaid-svg">{@html svg}</div></ZoomFrame>{/if}
</div>

<style>
  .diagram { position: relative; margin: 16px 0 22px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-default); }
  .mermaid-svg :global(svg) { display: block; max-width: none; height: auto; }
</style>
