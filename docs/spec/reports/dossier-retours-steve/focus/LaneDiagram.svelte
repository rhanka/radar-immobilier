<script>
  // Vertical swimlanes, left to right (users, screens, backend, data), with an optional
  // zone around them, and a transversal band at the bottom (offline evaluation).
  // Geometry from build time (diagram-layout.js); colours from the design-system tokens.
  import DiagramFrame from './DiagramFrame.svelte';
  let { graph } = $props();
  const layout = $derived(graph.layout);
  const boxOf = $derived(Object.fromEntries(layout.boxes.map(box => [box.id, box])));
  const groupLabel = $derived(Object.fromEntries(graph.groups.map(group => [group.id, group.label])));
  const laneKind = $derived(Object.fromEntries(layout.lanes.map(lane => [lane.id, lane.kind])));
  const path = points => points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const EVIDENCE = { observed: 'constaté', declared: 'proposé', historical: 'référence gelée' };
</script>

<DiagramFrame id={graph.id} kind="lanes" width={layout.width} height={layout.height}
  label={layout.zone ? 'Deux zones : application en couloirs (utilisateurs, écrans, backend, base) et évaluation hors ligne en bas' : 'Architecture en couloirs : utilisateurs, écrans UI, fonctions backend, données S3 et PostgreSQL ; jeu de référence transversal en bas'}>
  <defs>
    <marker id={`${graph.id}-arrow`} viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
      <path class="lane-arrow" d="M1,1 L11,6 L1,11 Z" />
    </marker>
  </defs>

  {#if layout.zone}
    <g class="zone" data-zone="application">
      <rect x={layout.zone.x} y={layout.zone.y} width={layout.zone.width} height={layout.zone.height} />
      <text x={layout.zone.x + 18} y={layout.zone.y + 34} data-text-role="zone-title">{layout.zone.title}</text>
    </g>
  {/if}

  {#each layout.lanes as lane, index}
    <g class="lane lane-{lane.kind}" data-lane={lane.id} data-lane-kind={lane.kind} data-lane-index={index}>
      <rect class="lane-bg" class:alt={index % 2} x={lane.x} y={lane.y} width={lane.width} height={lane.height} />
      <rect class="lane-accent" x={lane.x} y={lane.y} width={lane.width} height="6" />
      <text class="lane-title" x={lane.x + lane.width / 2} y={lane.y + 40} text-anchor="middle" data-text-role="lane-title">{lane.title}</text>
    </g>
  {/each}

  <g class="band" data-band={layout.band.id}>
    <rect class="band-bg" x={layout.band.x} y={layout.band.y} width={layout.band.width} height={layout.band.height} />
    <rect class="band-accent" x={layout.band.x} y={layout.band.y} width={layout.band.width} height="6" />
    <text class="lane-title" x={layout.band.x + 20} y={layout.band.y + 38} data-text-role="band-title">{groupLabel[layout.band.id]}
      <tspan class="band-sub"> — {layout.band.subtitle}</tspan></text>
  </g>

  {#each layout.containers as container}
    <g class="store" data-container={container.id}>
      <rect x={container.x} y={container.y} width={container.width} height={container.height} />
      <text x={container.x + 12} y={container.y + 21} data-text-role="container-title">{groupLabel[container.id]}</text>
    </g>
  {/each}

  {#each graph.edges as edge}
    <g class="lane-edge evidence-{edge.evidence}" data-lane-edge={edge.id} data-source={edge.source} data-target={edge.target}
      data-evidence={edge.evidence} data-route-points={JSON.stringify(layout.routes[edge.id])}>
      <path d={path(layout.routes[edge.id])} marker-end={`url(#${graph.id}-arrow)`} />
    </g>
  {/each}

  {#each graph.nodes as node}
    {@const box = boxOf[node.id]}
    <g class="lane-node evidence-{node.evidence} kind-{laneKind[node.lane] ?? 'oracle'}" data-lane-node={node.id} data-lane={node.lane}
      data-evidence={node.evidence} data-box={JSON.stringify(box)}>
      <title>{node.label} · {node.detail} · {EVIDENCE[node.evidence]}</title>
      <rect class="node-body" x={box.x} y={box.y} width={box.width} height={box.height} />
      <rect class="node-accent" x={box.x} y={box.y} width="7" height={box.height} />
      {#if node.lane !== layout.band.id}<text class="node-tag" x={box.x + box.width - 10} y={box.y + 18} text-anchor="end">{node.tag}</text>{/if}
      <text class="node-title" x={box.x + 20} y={box.y + 40} data-text-role="node-title">{node.label}</text>
      <text class="node-detail" x={box.x + 20} y={box.y + 62} data-text-role="node-detail">{node.detail}</text>
    </g>
  {/each}

  {#each graph.edges as edge}
    {@const label = layout.labels[edge.id]}
    {#if label}
      <g class="lane-label" data-edge-label={edge.id}>
        <rect x={label.x} y={label.y} width={label.width} height={label.height} />
        <text x={label.x + label.width / 2} y={label.y + label.height / 2 + 4.5} text-anchor="middle" data-text-role="edge-label">{label.text}</text>
      </g>
    {/if}
  {/each}
</DiagramFrame>
<p class="diagram-legend"><strong>Lecture</strong> · {layout.legend}</p>

<style>
  .zone rect { fill: none; stroke: var(--st-semantic-action-primary); stroke-width: 2.5; }
  .zone text { font: 700 20px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--st-semantic-action-primary); }
  .lane-bg { fill: var(--st-semantic-surface-subtle); }
  .lane-bg.alt { fill: color-mix(in srgb, var(--st-semantic-surface-subtle) 55%, var(--st-semantic-surface-default)); }
  .lane-accent { fill: var(--lane-color); }
  .lane-user { --lane-color: var(--st-semantic-data-category2); }
  .lane-ui { --lane-color: var(--st-semantic-action-primary); }
  .lane-backend { --lane-color: var(--st-semantic-data-category1); }
  .lane-data { --lane-color: var(--st-semantic-border-strong); }
  .lane-title { font: 700 18px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--st-semantic-text-primary); }
  .band-bg { fill: color-mix(in srgb, var(--st-semantic-data-category7) 9%, var(--st-semantic-surface-default)); stroke: var(--st-semantic-data-category7); stroke-width: 1.5; }
  .band-accent { fill: var(--st-semantic-data-category7); }
  .band-sub { font-weight: 400; font-size: 14px; fill: var(--st-semantic-text-secondary); }
  .store rect { fill: none; stroke: var(--st-semantic-border-strong); stroke-width: 1.5; stroke-dasharray: 3 3; }
  .store text { font: 700 14px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--st-semantic-text-secondary); }
  .lane-edge path { fill: none; stroke: var(--st-semantic-text-secondary); stroke-width: 1.6; }
  .lane-edge.evidence-declared path { stroke-dasharray: 7 5; }
  .lane-edge.evidence-historical path { stroke-dasharray: 2 4; }
  :global(.lane-arrow) { fill: var(--st-semantic-text-secondary); }
  .node-body { fill: var(--st-semantic-surface-raised); stroke: var(--st-semantic-border-strong); stroke-width: 1.6; }
  .evidence-declared .node-body { stroke-dasharray: 7 5; }
  .evidence-historical .node-body { stroke-dasharray: 2 4; }
  .node-accent { fill: var(--node-color, var(--st-semantic-data-category1)); }
  .kind-user { --node-color: var(--st-semantic-data-category2); }
  .kind-ui { --node-color: var(--st-semantic-action-primary); }
  .kind-backend { --node-color: var(--st-semantic-data-category1); }
  .kind-data { --node-color: var(--st-semantic-border-strong); }
  .kind-oracle { --node-color: var(--st-semantic-data-category7); }
  .node-tag { font: 700 11px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--st-semantic-text-secondary); text-transform: uppercase; letter-spacing: .06em; }
  .node-title { font: 700 16px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--st-semantic-text-primary); }
  .node-detail { font: 13px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--st-semantic-text-secondary); }
  .lane-label rect { fill: var(--st-semantic-surface-default); stroke: var(--st-semantic-border-subtle); }
  .lane-label text { font: 13px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--st-semantic-text-primary); }
  .diagram-legend { font-size: .82rem; line-height: 1.55; color: var(--st-semantic-text-secondary); }
</style>
