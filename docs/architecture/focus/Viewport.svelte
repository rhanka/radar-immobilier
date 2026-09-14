<script>
  import { useSvelteFlow } from '@xyflow/svelte';
  let { bounds, width, height } = $props();
  let control;
  const { fitBounds, setViewport } = useSvelteFlow();
  const actualSize = () => setViewport({ x: 24, y: 24, zoom: 1 }, { duration: 0 });
  $effect(() => {
    if (!width || !height) return;
    const target = bounds;
    const timer = setTimeout(() => fitBounds(target, { padding: 0.08, duration: 150 }), 40);
    return () => clearTimeout(timer);
  });
  $effect(() => {
    const flow = control?.closest('.flow');
    if (!flow) return;
    const resetOnDoubleClick = event => {
      if (event.target.closest('button')) return;
      event.preventDefault();
      event.stopPropagation();
      actualSize();
    };
    flow.addEventListener('dblclick', resetOnDoubleClick, { capture: true });
    return () => flow.removeEventListener('dblclick', resetOnDoubleClick, { capture: true });
  });
</script>

<button bind:this={control} type="button" class="actual-size-control nodrag nopan"
  data-action="actual-size" aria-label="Afficher à l’échelle 1:1"
  title="Échelle 1:1 · double-cliquer dans le panneau" onclick={actualSize}>1:1</button>
