<script>
  // Liaison tracée exactement sur la route calculée par ELK (points absolus du
  // graphe), étiquette posée à la position qu'ELK lui a donnée sur le trait.
  import { BaseEdge, EdgeLabel } from '@xyflow/svelte';
  let { id, data, label, markerEnd, markerStart, style, interactionWidth } = $props();
  const points = $derived(data.routedPoints);
  const path = $derived(points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '));
  const box = $derived(data.labelBox);
</script>
<g data-canonical-edge={id} data-source={data.source} data-target={data.target} data-label={data.label}
  data-dashed={data.dashed} data-both={data.both} data-evidence-class={data.evidenceClass} data-runtime-state={data.runtimeState}
  data-route-points={JSON.stringify(points)}>
  <BaseEdge {id} {path} {markerStart} {markerEnd} {style} {interactionWidth} />
</g>
<!-- L'étiquette occupe exactement la boîte qu'ELK lui a réservée : même taille,
     même position, donc collée à son trait comme dans le placement calculé. -->
{#if label && box}<EdgeLabel x={box.x + box.width / 2} y={box.y + box.height / 2} class="route-label elk-label nodrag nopan"
  width={box.width} height={box.height}
  title={label} data-text-role="edge-label" data-edge={id}>{label}</EdgeLabel>{/if}
