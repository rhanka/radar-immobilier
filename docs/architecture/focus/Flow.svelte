<script>
  import { SvelteFlow, Background, Controls, MiniMap } from '@xyflow/svelte';
  import ArchitectureNode from '@kit/ArchitectureNode.svelte';
  import '@xyflow/svelte/dist/style.css';
  import { sceneFor } from './scenes.js';
  import Viewport from './Viewport.svelte';
  import RoutedEdge from './RoutedEdge.svelte';
  let { graph, scope, open, select, focusId } = $props();
  const nodeTypes = { architecture: ArchitectureNode };
  const edgeTypes = { architecture: RoutedEdge };
  let scene = $derived(sceneFor(graph, scope));
</script>

<div class="flow" data-renderer="xyflow-svelte" data-graph={graph.id} data-scope={scope ?? 'root'}>
  {#key `${graph.id}/${scope}`}
    <SvelteFlow nodes={scene.nodes} edges={scene.edges} {nodeTypes} {edgeTypes}
      fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.07} maxZoom={2}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable
      onnodeclick={({ node }) => node.data.group ? open(node.id) : select(node.data.entity)}
      onedgeclick={({ edge }) => select({ id: edge.id, label: `${edge.originalSource} → ${edge.originalTarget}`, edge })}>
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
      <Viewport {focusId} />
    </SvelteFlow>
  {/key}
</div>
