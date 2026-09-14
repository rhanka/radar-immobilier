<script>
  import { SvelteFlow, Background, Controls, MiniMap } from '@xyflow/svelte';
  import ArchitectureNode from './ServiceNode.svelte';
  import '@xyflow/svelte/dist/style.css';
  import { sceneFor } from './scenes.js';
  import Viewport from './Viewport.svelte';
  import RoutedEdge from './RoutedEdge.svelte';
  import Subflow from './Subflow.svelte';
  let { graph, open = () => {}, select = () => {} } = $props();
  const nodeTypes = { architecture: ArchitectureNode, subflow: Subflow };
  const edgeTypes = { architecture: RoutedEdge };
  let scene = $derived(sceneFor(graph));
  let width = $state(0), height = $state(0);
  let bounds = $derived({ x: 0, y: 0, width: scene.canvas.width, height: scene.canvas.height });
</script>

<div class="flow" bind:clientWidth={width} bind:clientHeight={height}
  data-renderer="xyflow-svelte" data-graph={graph.id} data-scene-hash={graph.sceneHash} data-mode="complete-nested" data-zoom-range="0.03:2">
  {#key graph.id}
    <SvelteFlow nodes={scene.nodes} edges={scene.edges} {nodeTypes} {edgeTypes} style="width:100%;height:100%"
      fitView fitViewOptions={{ padding: 0.08 }} minZoom={0.03} maxZoom={2}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable
      onnodeclick={({ node }) => node.data.group ? open(node.id) : select(node.data.entity)}
      onedgeclick={({ edge }) => select({ id: edge.id, label: `${edge.originalSource} → ${edge.originalTarget}`, edge })}>
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
      <Viewport {bounds} {width} {height} />
    </SvelteFlow>
  {/key}
</div>

<style>
  :global(.svelte-flow__container) { width: 100%; height: 100%; min-height: 1px; }
</style>
