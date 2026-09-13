<script>
  import { useSvelteFlow } from '@xyflow/svelte';
  let { focusId } = $props();
  const { fitView } = useSvelteFlow();
  $effect(() => {
    const id = focusId;
    if (!id) return;
    const timer = setTimeout(() => fitView({ nodes: [{ id }], minZoom: 0.85, maxZoom: 1, padding: 0.4, duration: 150 }), 40);
    return () => clearTimeout(timer);
  });
</script>
