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
</script>

<div class="flow" data-renderer="xyflow-svelte" data-graph={graph.id} data-scene-hash={graph.sceneHash} data-mode="complete-nested" data-native-zoom="1">
  {#key graph.id}
    <SvelteFlow nodes={scene.nodes} edges={scene.edges} {nodeTypes} {edgeTypes}
      minZoom={1} maxZoom={1} defaultViewport={{ x: 24, y: 24, zoom: 1 }}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable
      onnodeclick={({ node }) => node.data.group ? open(node.id) : select(node.data.entity)}
      onedgeclick={({ edge }) => select({ id: edge.id, label: `${edge.originalSource} → ${edge.originalTarget}`, edge })}>
      <Background gap={24} size={1} />
      <MiniMap pannable zoomable />
      <Viewport />
    </SvelteFlow>
  {/key}
</div>
