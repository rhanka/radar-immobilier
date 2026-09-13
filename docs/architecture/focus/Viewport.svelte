<script>
  import { useSvelteFlow } from '@xyflow/svelte';
  let { focusId, group = false } = $props();
  const { fitView } = useSvelteFlow();
  $effect(() => {
    const id = focusId, isGroup = group;
    const timer = setTimeout(() => fitView({ nodes: id ? [{ id }] : undefined, minZoom: isGroup || !id ? 0.03 : 0.85, maxZoom: 1, padding: isGroup || !id ? 0.15 : 0.4, duration: 150 }), 40);
    return () => clearTimeout(timer);
  });
</script>
