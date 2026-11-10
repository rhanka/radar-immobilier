<script>
  // Rendu « xyflow » : SvelteFlow natif, cartes et conteneurs de la chaîne
  // existante (ServiceNode, Subflow), positions et routes calculées au build
  // par ELK (elk-layout.mjs). Aucun placement n'est recalculé ici.
  import { SvelteFlow, Background, Controls, MiniMap } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import ArchitectureNode from '../../../../architecture/focus/ServiceNode.svelte';
  import Subflow from '../../../../architecture/focus/Subflow.svelte';
  import Viewport from '../../../../architecture/focus/Viewport.svelte';
  import ElkEdge from './ElkEdge.svelte';
  let { graph } = $props();
  const nodeTypes = { architecture: ArchitectureNode, subflow: Subflow };
  const edgeTypes = { elk: ElkEdge };
  const titleOf = item => item.label.split('\n')[0];

  function scene(graph) {
    const all = new Map([...graph.groups, ...graph.nodes].map(item => [item.id, item]));
    const groupIds = new Set(graph.groups.map(group => group.id));
    const place = new Map(graph.elk.boxes.map(box => [box.id, box]));
    const depthOf = id => { let depth = 0, item = all.get(id); while (item?.parent) { depth++; item = all.get(item.parent); } return depth; };
    // Parents avant enfants, comme l'exige xyflow.
    const ordered = [...all.values()].sort((a, b) => depthOf(a.id) - depthOf(b.id));
    const nodes = ordered.map(item => {
      const group = groupIds.has(item.id), box = place.get(item.id), meta = item.metadata, depth = depthOf(item.id);
      const provenance = { ...meta, service: titleOf(item), repoLabel: `repo: ${meta.repo.join(' + ')}` };
      return {
        id: item.id, type: group ? 'subflow' : 'architecture', width: box.width, height: box.height,
        position: { x: box.x, y: box.y }, ...(item.parent ? { parentId: item.parent, extent: 'parent' } : {}),
        zIndex: group ? depth : 10,
        data: { kind: meta.kind, title: titleOf(item), card: meta.card, code: meta.code, roleTitle: meta.role, name: meta.name,
          detail: meta.detail, entity: item, group, depth, label: item.label, provenance, parentId: item.parent,
          evidenceClass: meta.evidenceClass, runtimeState: meta.runtimeState },
      };
    });
    const routes = new Map(graph.elk.edges.map(edge => [edge.id, edge]));
    const edges = graph.edges.map(edge => ({
      id: edge.id, source: edge.source, target: edge.target, label: edge.label, type: 'elk', zIndex: 20,
      data: { source: edge.source, target: edge.target, label: edge.label, dashed: edge.dashed, both: edge.both,
        evidenceClass: edge.metadata.evidenceClass, runtimeState: edge.metadata.runtimeState,
        routedPoints: routes.get(edge.id).points, labelBox: routes.get(edge.id).label },
      markerEnd: { type: 'arrowclosed' }, ...(edge.both ? { markerStart: { type: 'arrowclosed' } } : {}),
      style: `stroke:var(--st-semantic-text-secondary);stroke-width:3;${edge.dashed ? 'stroke-dasharray:10 7' : ''}`,
    }));
    return { nodes, edges, canvas: graph.elk.canvas };
  }
  let built = $derived(scene(graph));
  let width = $state(0), height = $state(0);
  let bounds = $derived({ x: 0, y: 0, width: built.canvas.width, height: built.canvas.height });
  // Cadrage d'impression, sans script : panneau de 26 × 17,5 cm (A4 paysage), le
  // schéma entier centré à l'échelle qui le fait tenir (voir la feuille print).
  const PRINT = { width: 26 / 2.54 * 96, height: 17.5 / 2.54 * 96 };
  let print = $derived.by(() => {
    const scale = Math.min(PRINT.width / built.canvas.width, PRINT.height / built.canvas.height);
    return `--print-scale:${scale};--print-tx:${(PRINT.width - built.canvas.width * scale) / 2}px;--print-ty:${(PRINT.height - built.canvas.height * scale) / 2}px`;
  });
</script>

<div class="flow" bind:clientWidth={width} bind:clientHeight={height} data-renderer="xyflow-elk" data-graph={graph.id}
  data-scene-hash={graph.sceneHash} data-mode="complete-nested" data-zoom-range="0.03:2"
  data-canvas={JSON.stringify(built.canvas)} style={print}>
  {#key graph.id}
    <SvelteFlow nodes={built.nodes} edges={built.edges} {nodeTypes} {edgeTypes} style="width:100%;height:100%"
      fitView fitViewOptions={{ padding: 0.04 }} minZoom={0.03} maxZoom={2}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}>
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
      <Viewport {bounds} {width} {height} />
    </SvelteFlow>
  {/key}
</div>

<style>
  @media print {
    @page { size: A4 landscape; margin: 1cm; }
    .flow { width: 26cm; height: 17.5cm; }
    .flow :global(.svelte-flow__viewport) { transform: translate(var(--print-tx), var(--print-ty)) scale(var(--print-scale)) !important; }
  }
  :global(.svelte-flow__container) { width: 100%; height: 100%; min-height: 1px; }
  :global(.elk-label) { max-width: none; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
    padding: 0 4px; white-space: nowrap; border: 1px solid var(--st-semantic-border-subtle); }
</style>
