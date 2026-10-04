<script>
  // Figure 2 — tables en jeu et collision d'identifiants (§4 du dossier).
  // Diagramme de tables (style entité-relation), pas une architecture : aucune
  // carte de composant ici. Couleurs = jetons du thème, clair comme sombre.
  // Source lisible équivalente : bloc Mermaid erDiagram du §4.2 du Markdown.
  const ROW = 34;
  const files = [
    { id: 'gore', x: 20, y: 70, title: 'S3 · graph/gore/latest.json',
      rows: ['municipality : gore', 'nœud bylaw-242 · Bylaw', 'refs → PV de gore'] },
    { id: 'barkmere', x: 20, y: 330, title: 'S3 · graph/barkmere/latest.json',
      rows: ['municipality : barkmere', 'nœud bylaw-242 · Bylaw', 'resolution, refs → PV de barkmere'] },
  ];
  const tables = [
    { id: 'graph_nodes', x: 560, y: 70, width: 520, typeX: 170, noteX: 250, title: 'PG · graph_nodes',
      rows: [['id', 'text', 'PK · seule clé'], ['type', 'text', 'Bylaw, Zone, Signal…'], ['label', 'text', ''],
        ['city_slug', 'text', 'ville, hors de la clé'], ['props', 'jsonb', 'properties, refs'], ['source_ref', 'text', '']] },
    { id: 'graph_edges', x: 1160, y: 70, width: 420, typeX: 130, noteX: 200, title: 'PG · graph_edges',
      rows: [['id', 'uuid', 'PK'], ['src_id', 'text', '→ graph_nodes.id'], ['dst_id', 'text', '→ graph_nodes.id'],
        ['kind', 'text', ''], ['props', 'jsonb', '']] },
  ];
  const fileHeight = file => 46 + file.rows.length * ROW + 10;
  const tableHeight = table => 46 + table.rows.length * ROW + 10;
  // Ligne partagée : sous graph_nodes.
  const shared = { x: 560, y: 380, width: 520, height: 150 };
  const effects = [
    { x: 20, title: 'Effet 1 · preuve étrangère', lines: ['gore affiche la preuve de barkmere', '164 nœuds dans 109 villes'] },
    { x: 553, title: 'Effet 2 · ville lésée bloquée', lines: ['gore refusé à la projection suivante', 'G2 · 81 villes, G4 · 18 villes'] },
    { x: 1086, title: 'Effet 3 · nœud manquant', lines: ['bylaw-242 absent du graphe de barkmere', 'G3 · 49 villes'] },
  ];
</script>

<figure class="table-figure" data-figure="tables" aria-labelledby="figure-2-title">
  <figcaption>
    <span class="eyebrow">Figure 2 · §4 · tables en jeu</span>
    <h2 id="figure-2-title">Deux villes, un même identifiant, une seule ligne en base</h2>
    <p class="lede">À gauche, les fichiers S3 de gore et de barkmere, propres et séparés. Au centre, la table <code>graph_nodes</code> : sa seule clé est <code>id</code>,
      commune à toutes les villes. Les deux projections tombent sur la même ligne <code>bylaw-242</code> : la seconde remplace le contenu, la ville reste gore.
      À droite, <code>graph_edges</code> désigne les nœuds par leur <code>id</code>, sans ville. En bas, les trois effets mesurés.</p>
  </figcaption>
  <div class="figure-scroll">
    <svg viewBox="0 0 1600 800" role="img" aria-label="Diagramme des tables graph_nodes et graph_edges et de la collision bylaw-242 entre gore et barkmere">
      <defs>
        <marker id="fig2-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10Z" class="arrow-head" />
        </marker>
        <marker id="fig2-arrow-alert" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10Z" class="arrow-head alert" />
        </marker>
      </defs>

      {#each files as file}
        <g data-file={file.id}>
          <rect x={file.x} y={file.y} width="420" height={fileHeight(file)} class="box file" />
          <rect x={file.x} y={file.y} width="420" height="46" class="head file" />
          <text x={file.x + 16} y={file.y + 31} class="title" data-fit="388">{file.title}</text>
          {#each file.rows as row, index}
            <text x={file.x + 16} y={file.y + 46 + 25 + index * ROW} class="cell" data-fit="388">{row}</text>
          {/each}
        </g>
      {/each}

      {#each tables as table}
        <g data-table={table.id}>
          <rect x={table.x} y={table.y} width={table.width} height={tableHeight(table)} class="box" />
          <rect x={table.x} y={table.y} width={table.width} height="46" class="head" />
          <text x={table.x + 16} y={table.y + 31} class="title" data-fit={table.width - 32}>{table.title}</text>
          {#each table.rows as [column, type, note], index}
            <g data-column={column}>
              {#if index}<line x1={table.x} x2={table.x + table.width} y1={table.y + 46 + index * ROW} y2={table.y + 46 + index * ROW} class="rule" />{/if}
              <text x={table.x + 16} y={table.y + 46 + 24 + index * ROW} class="cell strong" class:key={note.startsWith('PK')} data-fit={table.typeX - 30}>{column}</text>
              <text x={table.x + table.typeX} y={table.y + 46 + 24 + index * ROW} class="cell muted" data-fit={table.noteX - table.typeX - 10}>{type}</text>
              <text x={table.x + table.noteX} y={table.y + 46 + 24 + index * ROW} class="cell" class:alert-text={column === 'city_slug'} data-fit={table.width - table.noteX - 16}>{note}</text>
            </g>
          {/each}
        </g>
      {/each}

      <g data-collision="bylaw-242">
        <rect x={shared.x} y={shared.y} width={shared.width} height={shared.height} class="box alert" />
        <text x={shared.x + 16} y={shared.y + 32} class="title" data-fit="488">Ligne partagée dans graph_nodes</text>
        <text x={shared.x + 16} y={shared.y + 68} class="cell" data-fit="488">id = bylaw-242 · city_slug = gore</text>
        <text x={shared.x + 16} y={shared.y + 100} class="cell alert-text" data-fit="488">props = resolution et PV de barkmere</text>
        <text x={shared.x + 16} y={shared.y + 132} class="cell muted" data-fit="488">option C : clé (city_slug, id), deux lignes</text>
      </g>

      <!-- 1. gore projette : création de la ligne. -->
      <path d="M440 165 H500 V430 H556" class="link" marker-end="url(#fig2-arrow)" />
      <text x="446" y="155" class="link-label" data-fit="104">① INSERT</text>
      <!-- 2. barkmere projette : ON CONFLICT (id) remplace le contenu. -->
      <path d="M440 470 H556" class="link alert" marker-end="url(#fig2-arrow-alert)" />
      <text x="36" y="524" class="link-label alert-text" data-fit="500">② ON CONFLICT (id) : props remplacées</text>
      <!-- graph_nodes ligne -> table -->
      <path d="M820 380 V326" class="link" marker-end="url(#fig2-arrow)" />
      <!-- graph_edges -> graph_nodes.id -->
      <path d="M1160 185 H1084" class="link dashed" marker-end="url(#fig2-arrow)" />
      <text x="1160" y="340" class="cell muted" data-fit="420">sans clé étrangère ni ville :</text>
      <text x="1160" y="368" class="cell muted" data-fit="420">clé naturelle (src_id, dst_id, kind)</text>

      {#each effects as effect, index}
        <g data-effect={index + 1}>
          <rect x={effect.x} y="640" width="494" height="140" class="box effect" />
          <text x={effect.x + 16} y="676" class="title" data-fit="462">{effect.title}</text>
          {#each effect.lines as line, lineIndex}
            <text x={effect.x + 16} y={712 + lineIndex * 32} class="cell" data-fit="462">{line}</text>
          {/each}
        </g>
      {/each}
    </svg>
  </div>
</figure>

<style>
  .table-figure { margin: 40px 0; border-top: 4px solid var(--st-semantic-data-category2); padding-top: 16px; }
  .table-figure h2 { margin: 4px 0; }
  .figure-scroll { overflow-x: auto; background: var(--st-semantic-surface-subtle); padding: 12px; }
  svg { display: block; width: 100%; min-width: 960px; height: auto; font-family: inherit; }
  .box { fill: var(--st-semantic-surface-raised, var(--st-semantic-surface-default)); stroke: var(--st-semantic-border-strong); stroke-width: 2; }
  .box.file { stroke: var(--st-semantic-data-category1); }
  .head { fill: var(--st-semantic-surface-subtle); stroke: var(--st-semantic-border-strong); stroke-width: 2; }
  .head.file { stroke: var(--st-semantic-data-category1); }
  .box.alert { stroke: var(--fig-alert); stroke-width: 4; }
  .box.effect { stroke: var(--st-semantic-border-subtle); }
  .rule { stroke: var(--st-semantic-border-subtle); stroke-width: 1; }
  .title { font-size: 22px; font-weight: 700; fill: var(--st-semantic-text-primary); }
  .cell { font-size: 20px; fill: var(--st-semantic-text-primary); }
  .cell.strong { font-weight: 650; }
  .cell.key { text-decoration: underline; }
  .muted { fill: var(--st-semantic-text-secondary); }
  .alert-text { fill: var(--fig-alert); font-weight: 650; }
  .link { fill: none; stroke: var(--st-semantic-text-secondary); stroke-width: 3; }
  .link.alert { stroke: var(--fig-alert); }
  .link.dashed { stroke-dasharray: 10 7; }
  .arrow-head { fill: var(--st-semantic-text-secondary); }
  .arrow-head.alert { fill: var(--fig-alert); }
  .link-label { font-size: 19px; font-weight: 650; fill: var(--st-semantic-text-primary); }
  .link-label.alert-text { fill: var(--fig-alert); }
  figure { --fig-alert: #b42318; }
  @media (prefers-color-scheme: dark) { figure { --fig-alert: #ff8a7a; } }
</style>
