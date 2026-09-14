<script>
  import rendered from './.generated/mermaid.json';
  let { graph } = $props(), zoom = $state(1);
  let svg = $derived(rendered[graph.id].svg);
</script>
<details class="mermaid-panel">
  <summary>Source Mermaid · rendu visuel et code exact</summary>
  <div class="flex-row"><button onclick={() => zoom = Math.min(zoom + .5, 5)}>Zoom Mermaid +</button><button onclick={() => zoom = Math.max(zoom - .5, 1)}>Zoom Mermaid −</button><button onclick={() => zoom = 1}>Ajuster Mermaid</button></div>
  <div class="mermaid-scroll"><div class="mermaid-render" data-graph={graph.id} data-native-zoom={zoom} style={`zoom:${zoom}`}>{@html svg}</div></div>
  <details><summary>Code source Mermaid</summary><pre>{graph.source}</pre></details>
</details>
<style>
  .mermaid-panel > summary { margin-bottom: 16px; }
  .mermaid-scroll { max-height: 750px; overflow: auto; margin-top: 16px; border: 1px solid var(--st-semantic-border-subtle); }
  .mermaid-render { width: max-content; min-width: 100%; padding: 16px; background: white; }
  .mermaid-render :global(svg) { width: auto; height: auto; display: block; max-width: none; }
  .mermaid-render :global(text) { font-size: 24px !important; }
</style>
