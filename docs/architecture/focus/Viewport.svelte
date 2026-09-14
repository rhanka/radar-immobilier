<script>
  import { useSvelteFlow } from '@xyflow/svelte';
  const { setViewport } = useSvelteFlow();
  $effect(() => {
    const timer = setTimeout(() => setViewport({ x: 24, y: 24, zoom: 1 }, { duration: 0 }), 40);
    return () => clearTimeout(timer);
  });
</script>
