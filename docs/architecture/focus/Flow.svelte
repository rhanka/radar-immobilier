<script>
  import { SvelteFlow, Background, Controls, MiniMap } from '@xyflow/svelte';
  import ArchitectureNode from '@kit/ArchitectureNode.svelte';
  import '@xyflow/svelte/dist/style.css';
  import { sceneFor } from './scenes.js';
  import Viewport from './Viewport.svelte';
  import RoutedEdge from './RoutedEdge.svelte';
  import Subflow from './Subflow.svelte';
  let { graph, scope, open, select, focusId } = $props();
  const nodeTypes = { architecture: ArchitectureNode, subflow: Subflow };
  const edgeTypes = { architecture: RoutedEdge };
  let scene = $derived(sceneFor(graph));
  let width = $state(0), height = $state(0);
  let bounds = $derived.by(() => {
    const target = focusId ?? scope;
    const nodes = target ? scene.absoluteNodes.filter(n => n.id === target) : scene.absoluteNodes;
    const x = Math.min(...nodes.map(n => n.position.x)), y = Math.min(...nodes.map(n => n.position.y));
    return { x, y, width: Math.max(...nodes.map(n => n.position.x + n.width)) - x, height: Math.max(...nodes.map(n => n.position.y + n.height)) - y };
  });
</script>

<div class="flow" bind:clientWidth={width} bind:clientHeight={height} data-renderer="xyflow-svelte" data-graph={graph.id} data-scope={scope ?? 'root'} data-mode="complete-nested">
  {#key graph.id}
    <SvelteFlow nodes={scene.nodes} edges={scene.edges} {nodeTypes} {edgeTypes}
      fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.03} maxZoom={2}
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
