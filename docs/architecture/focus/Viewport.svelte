<script>
  import { useSvelteFlow } from '@xyflow/svelte';
  let { bounds, width, height } = $props();
  const { fitBounds } = useSvelteFlow();
  $effect(() => {
    if (!width || !height) return;
    const target = bounds;
    const timer = setTimeout(() => fitBounds(target, { padding: 0.15, duration: 150 }), 40);
    return () => clearTimeout(timer);
  });
</script>
