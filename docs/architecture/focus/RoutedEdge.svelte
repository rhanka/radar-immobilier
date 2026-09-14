<script>
  import { BaseEdge, EdgeLabel, getSmoothStepPath } from '@xyflow/svelte';
  let { id, data, label, markerEnd, markerStart, style, interactionWidth,
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = $props();
  const routed = $derived(getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12, offset: 32 }));
</script>
<g data-canonical-edge={id} data-source={data.source} data-target={data.target} data-label={data.label}
  data-dashed={data.dashed} data-both={data.both} data-evidence-class={data.evidenceClass} data-runtime-state={data.runtimeState}>
  <BaseEdge {id} path={routed[0]} {markerStart} {markerEnd} {style} {interactionWidth} />
</g>
{#if label}<EdgeLabel x={routed[1]} y={routed[2]} class="route-label nodrag nopan" title={label} data-text-role="edge-label">{label}</EdgeLabel>{/if}
