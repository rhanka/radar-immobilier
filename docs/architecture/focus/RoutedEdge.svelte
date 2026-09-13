<script>
  import { BaseEdge, EdgeLabel } from '@xyflow/svelte';
  let { id, data, label, markerEnd, markerStart, style, interactionWidth } = $props();
  const points = $derived(data.routedPoints);
  const path = $derived(points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '));
  const placement = $derived.by(() => {
    const segments = points.slice(1).map((p, i) => ({ a: points[i], b: p, length: Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y) }));
    const middle = [...segments].sort((a, b) => b.length - a.length)[0];
    return { x: (middle.a.x + middle.b.x) / 2, y: (middle.a.y + middle.b.y) / 2 };
  });
</script>
<BaseEdge {id} {path} {markerStart} {markerEnd} {style} {interactionWidth} />
{#if label}<EdgeLabel x={placement.x} y={placement.y} class="route-label nodrag nopan" title={label}>{label}</EdgeLabel>{/if}
