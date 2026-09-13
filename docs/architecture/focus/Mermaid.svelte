<script>
  import DOMPurify from 'dompurify';
  import { Button, Flex } from '@sentropic/design-system-svelte';
  import rendered from './.generated/mermaid.json';
  let { graph } = $props(), zoom = $state(1);
  let svg = $derived(DOMPurify.sanitize(rendered[graph.id].svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script', 'foreignObject', 'a'], FORBID_ATTR: ['href', 'xlink:href', 'onclick', 'onload', 'onerror'] }));
</script>
<details class="mermaid-panel">
  <summary>Source Mermaid · rendu visuel et code exact</summary>
  <Flex gap={2} align="center"><Button variant="secondary" size="sm" onclick={() => zoom = Math.min(zoom + .5, 5)}>Zoom Mermaid +</Button><Button variant="secondary" size="sm" onclick={() => zoom = Math.max(zoom - .5, 1)}>Zoom Mermaid −</Button><Button variant="secondary" size="sm" onclick={() => zoom = 1}>Ajuster Mermaid</Button></Flex>
  <div class="mermaid-scroll"><div class="mermaid-render" data-graph={graph.id} style={`width:${zoom * 100}%`}>{@html svg}</div></div>
  <details><summary>Code source Mermaid</summary><pre>{graph.source}</pre></details>
</details>
<style>
  .mermaid-panel > summary { margin-bottom: 16px; }
  .mermaid-scroll { max-height: 750px; overflow: auto; margin-top: 16px; border: 1px solid var(--st-semantic-border-subtle); }
  .mermaid-render { min-width: 100%; padding: 16px; background: white; }
  .mermaid-render :global(svg) { width: 100%; height: auto; display: block; max-width: none; }
</style>
