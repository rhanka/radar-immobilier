<script>
  // Frame of the SVG scenes (tables, swimlanes): "vue d'ensemble" fits the whole canvas
  // to the panel width; "1:1" shows it at scale 1 with scrolling.
  let { id, kind, width, height, label, children } = $props();
  let actual = $state(false);
</script>

<div class="diagram" data-diagram={id} data-diagram-kind={kind} data-scale-mode={actual ? 'actual' : 'fit'} data-canvas-width={width} data-canvas-height={height}>
  <div class="diagram-tools" role="toolbar" aria-label="Zoom de la scène">
    <button type="button" data-action="fit" aria-pressed={!actual} onclick={() => (actual = false)}>Vue d’ensemble</button>
    <button type="button" data-action="actual-size" aria-pressed={actual} onclick={() => (actual = true)}>1:1</button>
  </div>
  <div class="diagram-canvas">
    <svg viewBox={`0 0 ${width} ${height}`} width={actual ? width : '100%'} height={actual ? height : undefined}
      role="img" aria-label={label} preserveAspectRatio="xMidYMin meet" style={actual ? undefined : `max-width:${width}px`}>
      {@render children()}
    </svg>
  </div>
</div>

<style>
  .diagram { position: relative; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-default); }
  .diagram-tools { display: flex; gap: 8px; justify-content: flex-end; padding: 8px 10px; border-bottom: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-subtle); }
  .diagram-tools button { padding: 4px 10px; font-size: .78rem; font-weight: 700; background: var(--st-semantic-surface-default); }
  .diagram-tools button[aria-pressed='true'] { border-color: var(--st-semantic-action-primary); color: var(--st-semantic-action-primary); }
  .diagram-canvas { overflow: auto; max-height: 1100px; }
  .diagram[data-scale-mode='fit'] .diagram-canvas { max-height: none; }
  .diagram-canvas svg { display: block; }
  .diagram[data-scale-mode='fit'] svg { width: 100%; height: auto; margin: 0 auto; }
</style>
