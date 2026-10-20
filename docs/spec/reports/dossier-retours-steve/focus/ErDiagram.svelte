<script>
  // Entity-relationship scene: tables with their key columns, relations with crow's-foot
  // cardinalities (solid: by key; dashed: no foreign key). Geometry from build time
  // (diagram-layout.js); colours from the design-system tokens, light and dark.
  import DiagramFrame from './DiagramFrame.svelte';
  import { ER } from './diagram-layout.js';
  let { graph, compact = false } = $props();
  const layout = $derived(graph.layout);
  const boxOf = $derived(Object.fromEntries(layout.boxes.map(box => [box.id, box])));
  const marker = cardinality => `url(#${graph.id}-${cardinality})`;
  const path = points => points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const CHAR = ER.columnSize * ER.mono;
  // Delta diagrams (current vs proposed): one colour per status, named in the tag.
  const STATUS = { new: 'nouveau', modified: 'modifié', deleted: 'supprimé', unchanged: 'inchangé', current: 'existe' };
</script>

<DiagramFrame id={graph.id} kind="er" width={layout.width} height={layout.height} tools={!compact}
  label="Diagramme entité-relation : tables, colonnes clés, relations et cardinalités">
  <defs>
    {#each [['one', 'M14,3 L14,17 M18,3 L18,17'], ['zero-or-one', 'M18,3 L18,17'], ['one-or-many', 'M22,3 L12,10 L22,17 M12,10 L22,10 M9,3 L9,17'], ['zero-or-many', 'M22,3 L12,10 L22,17 M12,10 L22,10']] as [name, shape]}
      <marker id={`${graph.id}-${name}`} viewBox="0 0 24 20" refX="22" refY="10" markerWidth="24" markerHeight="20"
        markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible">
        <path class="er-mark" d={shape} />
        {#if name.startsWith('zero')}<circle class="er-mark er-ring" cx={name === 'zero-or-one' ? 9 : 5} cy="10" r="4" />{/if}
      </marker>
    {/each}
  </defs>

  {#each layout.layers as layer, index}
    <g class="er-layer" data-layer={index}>
      <rect x={layer.x} y={layer.y} width={layer.width} height={layer.height} class:alt={index % 2} />
      <text x={layer.x + 14} y={layer.y + 34} class="er-layer-title" data-text-role="layer-title">{layer.title}</text>
    </g>
  {/each}

  {#each graph.relations as relation}
    <g class="er-relation" data-relation={relation.id} data-source={relation.source} data-target={relation.target}
      data-source-cardinality={relation.sourceCardinality} data-target-cardinality={relation.targetCardinality}
      data-identifying={relation.identifying} data-route-points={JSON.stringify(layout.routes[relation.id])}>
      <path d={path(layout.routes[relation.id])} class:dashed={!relation.identifying}
        marker-start={marker(relation.sourceCardinality)} marker-end={marker(relation.targetCardinality)} />
    </g>
  {/each}

  {#each graph.entities as entity}
    {@const box = boxOf[entity.id]}
    <g class="er-entity status-{entity.status ?? (entity.existing ? 'existing' : 'proposed')}" class:existing={entity.existing && !entity.status} data-entity={entity.id} data-existing={entity.existing} data-status={entity.status}>
      <rect class="er-body" x={box.x} y={box.y} width={box.width} height={box.height} />
      <rect class="er-head" x={box.x} y={box.y} width={box.width} height={ER.header} />
      <text class="er-name" x={box.x + ER.padX} y={box.y + 24} data-text-role="entity-name" data-box-right={box.x + box.width}>{entity.id}</text>
      <text class="er-tag" x={box.x + box.width - ER.padX} y={box.y + 23} text-anchor="end">{STATUS[entity.status] ?? (entity.existing ? 'existe' : 'proposée')}{#if entity.owner}<tspan class="er-owner" data-owner={entity.owner}>{' · '}{entity.owner}</tspan>{/if}</text>
      {#each entity.attributes as attribute, index}
        {@const y = box.y + ER.header + index * ER.line + 18}
        <text class="er-type" x={box.x + ER.padX} {y}>{attribute.type}</text>
        <text class="er-keys" x={box.x + ER.padX + 12 * CHAR} {y}>{attribute.keys.join(',')}</text>
        <text class="er-column" x={box.x + ER.padX + 19 * CHAR} {y} data-text-role="entity-column" data-box-right={box.x + box.width}
          class:key={attribute.keys.includes('PK')}>{attribute.name}{#if attribute.comment}<tspan class="er-comment">{' · '}{attribute.comment}</tspan>{/if}</text>
      {/each}
    </g>
  {/each}

  {#each graph.relations as relation}
    {@const label = layout.labels[relation.id]}
    {#if label}
      <g class="er-label" data-relation-label={relation.id}>
        <rect x={label.x} y={label.y} width={label.width} height={label.height} />
        <text x={label.x + label.width / 2} y={label.y + label.height / 2 + 4.5} text-anchor="middle" data-text-role="relation-label">{label.text}</text>
      </g>
    {/if}
  {/each}
</DiagramFrame>
{#if !compact}<p class="diagram-legend"><strong>Lecture</strong> · PK clé primaire · FK clé étrangère · UK unique ·
  deux barres : exactement un · cercle et barre : zéro ou un · patte d’oie : plusieurs (cercle : zéro ou plus) ·
  trait plein : relation par clé · tirets : rattachement par clé texte, sans clé étrangère ·
  table <em>existe</em> sur main ou <em>proposée</em> par le dossier (bordure en tirets).</p>{/if}

<style>
  .er-layer rect { fill: var(--st-semantic-surface-subtle); }
  .er-layer rect.alt { fill: color-mix(in srgb, var(--st-semantic-surface-subtle) 55%, var(--st-semantic-surface-default)); }
  .er-layer-title { font: 700 16px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--st-semantic-text-secondary); letter-spacing: .02em; }
  .er-relation path { fill: none; stroke: var(--st-semantic-text-primary); stroke-width: 1.6; }
  .er-relation path.dashed { stroke-dasharray: 7 5; }
  :global(.er-mark) { fill: none; stroke: var(--st-semantic-text-primary); stroke-width: 1.6; }
  :global(.er-ring) { fill: var(--st-semantic-surface-default); }
  .er-body { fill: var(--st-semantic-surface-raised); stroke: var(--st-semantic-border-strong); stroke-width: 1.5; stroke-dasharray: 6 4; }
  .er-entity.existing .er-body { stroke-dasharray: none; stroke-width: 2; }
  .er-head { fill: color-mix(in srgb, var(--st-semantic-data-category1) 18%, var(--st-semantic-surface-raised)); stroke: var(--st-semantic-border-strong); stroke-width: 1.5; }
  .er-entity.existing .er-head { fill: color-mix(in srgb, var(--st-semantic-data-category2) 24%, var(--st-semantic-surface-raised)); }
  .er-name { font: 700 15px ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace; fill: var(--st-semantic-text-primary); }
  .status-new .er-head { fill: var(--dossier-ok-bg); stroke: var(--dossier-ok); }
  .status-new .er-body { stroke: var(--dossier-ok); stroke-width: 2; }
  .status-modified .er-head { fill: var(--dossier-partial-bg); stroke: var(--dossier-partial); }
  .status-modified .er-body { stroke: var(--dossier-partial); stroke-width: 2.5; stroke-dasharray: none; }
  .status-deleted .er-head { fill: var(--dossier-gap-bg); stroke: var(--dossier-gap); }
  .status-deleted .er-body { stroke: var(--dossier-gap); stroke-dasharray: 3 3; }
  .status-unchanged .er-head, .status-current .er-head { fill: var(--st-semantic-surface-subtle); }
  .status-unchanged .er-body, .status-current .er-body { stroke-dasharray: none; }
  .status-new .er-tag { fill: var(--dossier-ok-text); }
  .status-modified .er-tag { fill: var(--dossier-partial-text); }
  .status-deleted .er-tag { fill: var(--dossier-gap-text); }
  .er-owner { fill: var(--st-semantic-action-primary); font-weight: 800; }
  .er-tag { font: 700 11px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--st-semantic-text-secondary); text-transform: uppercase; letter-spacing: .06em; }
  .er-type, .er-keys, .er-column { font: 13px ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace; }
  .er-type, .er-comment { fill: var(--st-semantic-text-secondary); }
  .er-keys { font-weight: 700; fill: var(--st-semantic-action-primary); }
  .er-column { fill: var(--st-semantic-text-primary); white-space: pre; }
  .er-column.key { font-weight: 700; }
  .er-label rect { fill: var(--st-semantic-surface-default); stroke: var(--st-semantic-border-subtle); }
  .er-label text { font: 13px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--st-semantic-text-primary); }
  .diagram-legend { font-size: .82rem; line-height: 1.55; color: var(--st-semantic-text-secondary); }
</style>
