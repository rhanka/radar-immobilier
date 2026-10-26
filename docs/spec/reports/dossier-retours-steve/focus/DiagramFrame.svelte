<script>
  // Frame of the SVG scenes (tables, swimlanes) and of the option diagrams: the canvas
  // at its natural size inside ZoomFrame (fit to width in the page, zoom, pan, full screen).
  // `tools`: full zoom toolbar in the page (scenes) or only « Agrandir » (option diagrams).
  import ZoomFrame from './ZoomFrame.svelte';
  let { id, kind, width, height, label, children, tools = true } = $props();
</script>

<div class="diagram" class:compact={!tools} data-diagram={tools ? id : undefined} data-mini-diagram={tools ? undefined : id} data-diagram-kind={kind}
  data-canvas-width={width} data-canvas-height={height}>
  <ZoomFrame {id} {label} {width} inline={tools}>
    <svg viewBox={`0 0 ${width} ${height}`} {width} {height} role="img" aria-label={label}>
      {@render children()}
    </svg>
  </ZoomFrame>
</div>

<style>
  .diagram { position: relative; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-default); }
  .diagram.compact { border-style: dashed; }
  .diagram :global(svg) { display: block; }
</style>
