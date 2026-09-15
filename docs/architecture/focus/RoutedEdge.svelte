<script>
  import { BaseEdge, EdgeLabel } from '@xyflow/svelte';
  let { id, data, label, markerEnd, markerStart, style, interactionWidth } = $props();
  const points = $derived(data.routedPoints);
  const path = $derived(points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '));
  const placement = $derived(data.labelPoint);
</script>
<g data-canonical-edge={id} data-source={data.source} data-target={data.target} data-label={data.label}
  data-dashed={data.dashed} data-both={data.both} data-evidence-class={data.evidenceClass} data-runtime-state={data.runtimeState}
  data-route-points={JSON.stringify(points)}>
  <BaseEdge {id} {path} {markerStart} {markerEnd} {style} {interactionWidth} />
</g>
{#if label && placement}<EdgeLabel x={placement.x} y={placement.y} class="route-label nodrag nopan" title={label} data-text-role="edge-label">{label}</EdgeLabel>{/if}
