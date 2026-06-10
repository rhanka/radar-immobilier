<script lang="ts">
  /**
   * CityGraphView — Studio de réconciliation : sous-graphe graphify par ville.
   *
   * Affiche le sous-graphe d'une ville (entités Bylaw / DesignationEvent / Zone /
   * Municipality / etc. + leurs relations) sous forme de rendu SVG pur.
   *
   * Layout : les nœuds sont répartis en rangées par type de nœud (grille par
   * type, colonne libre). Les arêtes sont des lignes SVG avec un label de
   * relation centré.
   *
   * Anti-PII (Loi 25) : aucune donnée propriétaire ; les libellés de nœuds
   * viennent exclusivement des docs publics (règlements, zones, avis).
   * L'affichage filtre l'attribut `owner` s'il venait à apparaître dans props.
   *
   * Pas de nouvelle dépendance graphe (SVG pur — même approche que
   * SignauxMapView / EvaluationMapView).
   */
  import { onMount } from "svelte";
  import { Network, RefreshCw, Info } from "@lucide/svelte";
  import { Badge, Alert, EmptyState } from "@sentropic/design-system-svelte";
  import { fetchCityGraph, type CityGraph, type GraphNode, type GraphEdge } from "$lib/graph/graph-client.js";
  import { STUDIO_CITIES } from "$lib/ontology/reconciliation.js";

  // ── Types internes ────────────────────────────────────────────────────────
  interface PositionedNode extends GraphNode {
    x: number;
    y: number;
  }

  // ── Configuration du rendu ────────────────────────────────────────────────
  const SVG_W = 760;
  const SVG_H = 520;
  const NODE_R = 22;
  const ROW_HEIGHT = 90;
  const COL_WIDTH = 110;
  const TOP_MARGIN = 50;
  const LEFT_MARGIN = 60;

  /** Ordre d'affichage par type (même ordre que NODE_TYPE_ORDER de reconciliation.ts). */
  const TYPE_ORDER: readonly string[] = [
    "Lot",
    "Valuation",
    "Zone",
    "Bylaw",
    "DesignationEvent",
    "Adresse",
    "Constraint",
    "Source",
    "Signal",
    "Municipality",
    "concept",
  ];

  /** Couleurs par type de nœud (palette accessible, sans connotation PII). */
  const TYPE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
    Bylaw:            { fill: "#dbeafe", stroke: "#3b82f6", text: "#1d4ed8" },
    DesignationEvent: { fill: "#dcfce7", stroke: "#22c55e", text: "#15803d" },
    Zone:             { fill: "#fef9c3", stroke: "#eab308", text: "#854d0e" },
    Municipality:     { fill: "#f0fdf4", stroke: "#6ee7b7", text: "#065f46" },
    Lot:              { fill: "#fce7f3", stroke: "#ec4899", text: "#9d174d" },
    Valuation:        { fill: "#ede9fe", stroke: "#8b5cf6", text: "#5b21b6" },
    Adresse:          { fill: "#fff7ed", stroke: "#f97316", text: "#c2410c" },
    Constraint:       { fill: "#fef2f2", stroke: "#f87171", text: "#991b1b" },
    Source:           { fill: "#f0f9ff", stroke: "#0ea5e9", text: "#0369a1" },
    Signal:           { fill: "#ecfdf5", stroke: "#10b981", text: "#065f46" },
    concept:          { fill: "#f8fafc", stroke: "#94a3b8", text: "#475569" },
  };

  function typeColor(type: string): { fill: string; stroke: string; text: string } {
    return TYPE_COLORS[type] ?? TYPE_COLORS["concept"]!;
  }

  // ── State ────────────────────────────────────────────────────────────────
  export let citySlug: string = STUDIO_CITIES[0]?.slug ?? "salaberry-de-valleyfield";

  let loading = false;
  let graph: CityGraph | null = null;
  let loadError: string | null = null;
  let isEmpty = false;

  let hoveredNodeId: string | null = null;

  // ── Chargement ───────────────────────────────────────────────────────────
  async function load(slug: string): Promise<void> {
    loading = true;
    loadError = null;
    isEmpty = false;
    graph = null;
    const result = await fetchCityGraph(slug);
    loading = false;
    if (result.kind === "ok") {
      graph = result.graph;
    } else if (result.kind === "empty") {
      isEmpty = true;
    } else {
      loadError = result.detail;
    }
  }

  let loadedSlug: string | null = null;
  $: if (citySlug !== loadedSlug && !loading) {
    loadedSlug = citySlug;
    void load(citySlug);
  }

  onMount(() => {
    loadedSlug = citySlug;
    void load(citySlug);
  });

  // ── Positionnement des nœuds (grille par type) ───────────────────────────
  /**
   * Répartit les nœuds en rangées selon leur type (ordre TYPE_ORDER).
   * Chaque rangée contient les nœuds d'un même type, disposés en colonnes.
   * Retourne un tableau de nœuds avec leurs coordonnées SVG (x, y).
   */
  function positionNodes(nodes: GraphNode[]): PositionedNode[] {
    // Groupe par type
    const byType = new Map<string, GraphNode[]>();
    for (const n of nodes) {
      const arr = byType.get(n.type) ?? [];
      arr.push(n);
      byType.set(n.type, arr);
    }

    // Ordre des types présents
    const presentTypes = TYPE_ORDER.filter((t) => byType.has(t));
    // Ajouter les types non listés à la fin
    for (const t of byType.keys()) {
      if (!presentTypes.includes(t)) presentTypes.push(t);
    }

    const positioned: PositionedNode[] = [];
    let row = 0;
    for (const type of presentTypes) {
      const group = byType.get(type) ?? [];
      const y = TOP_MARGIN + row * ROW_HEIGHT;
      for (let col = 0; col < group.length; col++) {
        const x = LEFT_MARGIN + col * COL_WIDTH + COL_WIDTH / 2;
        positioned.push({ ...group[col]!, x, y });
      }
      row++;
    }
    return positioned;
  }

  $: positioned = graph ? positionNodes(graph.nodes) : [];
  $: nodeById = new Map<string, PositionedNode>(positioned.map((n) => [n.id, n]));

  // Compteurs pour la légende
  $: nodeCount = graph?.nodes.length ?? 0;
  $: edgeCount = graph?.edges.length ?? 0;
  $: typeGroups = (() => {
    if (!graph) return [];
    const m = new Map<string, number>();
    for (const n of graph.nodes) m.set(n.type, (m.get(n.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();

  // ── SVG viewBox adaptatif ─────────────────────────────────────────────────
  $: svgHeight = (() => {
    if (positioned.length === 0) return SVG_H;
    const maxY = Math.max(...positioned.map((n) => n.y));
    return Math.max(SVG_H, maxY + ROW_HEIGHT);
  })();

  // ── Label court pour l'arête (tronque à 18 chars) ─────────────────────────
  function edgeLabel(kind: string): string {
    return kind.length > 18 ? kind.slice(0, 16) + "…" : kind;
  }

  // ── Label court de nœud (tronque à 15 chars pour l'ellipse) ──────────────
  function shortLabel(label: string): string {
    return label.length > 14 ? label.slice(0, 12) + "…" : label;
  }
</script>

<!-- ── Vue : sous-graphe graphify par ville ──────────────────────────────────── -->
<div class="flex h-full flex-col bg-slate-50" data-testid="city-graph-view">
  <!-- En-tête interne -->
  <div class="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
    <div class="flex items-center gap-2">
      <Network class="h-4 w-4 text-teal-600" aria-hidden="true" />
      <span class="text-sm font-semibold text-slate-900">Sous-graphe graphify</span>
      {#if graph}
        <Badge tone="neutral">{nodeCount} nœuds</Badge>
        <Badge tone="neutral">{edgeCount} arêtes</Badge>
      {/if}
    </div>
    <button
      type="button"
      aria-label="Actualiser le graphe"
      class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
      onclick={() => void load(citySlug)}
      disabled={loading}
    >
      <RefreshCw
        class={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
    </button>
  </div>

  <!-- Contenu principal -->
  <div class="flex min-h-0 flex-1 flex-col overflow-auto p-5">
    {#if loading}
      <div
        class="flex flex-1 items-center justify-center rounded-lg border border-slate-200 bg-white py-16 text-sm text-slate-400"
        aria-live="polite"
        aria-label="Chargement du graphe"
      >
        Chargement du sous-graphe…
      </div>

    {:else if loadError}
      <Alert tone="warning" title="Erreur de chargement" message={loadError} />

    {:else if isEmpty}
      <EmptyState
        title="Aucun graphe pour cette ville"
        message="Le graphe graphify n'est pas encore calculé pour cette ville. Lancez l'exploitation des échantillons réels depuis l'onglet Réconciliation."
      />

    {:else if graph && positioned.length > 0}
      <!-- Légende types -->
      <div class="mb-3 flex flex-wrap gap-2" aria-label="Légende des types de nœuds">
        {#each typeGroups as [type, count] (type)}
          {@const c = typeColor(type)}
          <span
            class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
            style={`background:${c.fill};border-color:${c.stroke};color:${c.text}`}
          >
            {type}
            <span class="rounded-full bg-white/60 px-1">{count}</span>
          </span>
        {/each}
      </div>

      <!-- SVG du graphe -->
      <div class="overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <svg
          width={SVG_W}
          height={svgHeight}
          viewBox={`0 0 ${SVG_W} ${svgHeight}`}
          aria-label={`Sous-graphe graphify de ${citySlug} : ${nodeCount} nœuds, ${edgeCount} arêtes`}
          role="img"
          class="block"
        >
          <!-- Étiquettes de rangée (type de nœud) -->
          {#each (() => {
            const seen = new Set<string>();
            const rows: { type: string; y: number }[] = [];
            for (const n of positioned) {
              if (!seen.has(n.type)) {
                seen.add(n.type);
                rows.push({ type: n.type, y: n.y });
              }
            }
            return rows;
          })() as row (row.type)}
            <text
              x={8}
              y={row.y + 5}
              font-size="9"
              fill="#94a3b8"
              font-weight="600"
              letter-spacing="0.05em"
              text-anchor="start"
              font-family="ui-sans-serif, system-ui, sans-serif"
            >{row.type.toUpperCase()}</text>
          {/each}

          <!-- Arêtes -->
          {#each graph.edges as edge (edge.id ?? `${edge.srcId}-${edge.dstId}-${edge.kind}`)}
            {@const src = nodeById.get(edge.srcId)}
            {@const dst = nodeById.get(edge.dstId)}
            {#if src && dst}
              {@const mx = (src.x + dst.x) / 2}
              {@const my = (src.y + dst.y) / 2}
              <line
                x1={src.x}
                y1={src.y}
                x2={dst.x}
                y2={dst.y}
                stroke="#cbd5e1"
                stroke-width="1.2"
                stroke-dasharray={src.type !== dst.type ? "4 3" : "none"}
                opacity="0.7"
                aria-hidden="true"
              />
              <!-- Label de la relation -->
              {#if edge.kind}
                <text
                  x={mx}
                  y={my - 4}
                  font-size="8"
                  fill="#64748b"
                  text-anchor="middle"
                  font-family="ui-sans-serif, system-ui, sans-serif"
                  pointer-events="none"
                  aria-hidden="true"
                >{edgeLabel(edge.kind)}</text>
              {/if}
            {/if}
          {/each}

          <!-- Nœuds -->
          {#each positioned as node (node.id)}
            {@const c = typeColor(node.type)}
            {@const isHovered = hoveredNodeId === node.id}
            <g
              role="button"
              aria-label={`${node.type} : ${node.label}`}
              tabindex="0"
              onmouseenter={() => (hoveredNodeId = node.id)}
              onmouseleave={() => (hoveredNodeId = null)}
              onfocus={() => (hoveredNodeId = node.id)}
              onblur={() => (hoveredNodeId = null)}
              style="cursor:default"
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={isHovered ? NODE_R + 3 : NODE_R}
                fill={c.fill}
                stroke={c.stroke}
                stroke-width={isHovered ? 2.5 : 1.5}
                style="transition:r 0.1s,stroke-width 0.1s"
              />
              <!-- Label court dans le cercle -->
              <text
                x={node.x}
                y={node.y + 3}
                font-size="8"
                fill={c.text}
                text-anchor="middle"
                dominant-baseline="middle"
                font-weight="500"
                font-family="ui-sans-serif, system-ui, sans-serif"
                pointer-events="none"
              >{shortLabel(node.label)}</text>

              <!-- Tooltip au survol : label complet -->
              {#if isHovered}
                {@const tooltipX = Math.min(node.x + NODE_R + 4, SVG_W - 160)}
                {@const tooltipY = Math.max(node.y - 28, 8)}
                <rect
                  x={tooltipX}
                  y={tooltipY}
                  width={Math.min(node.label.length * 6.5 + 16, 240)}
                  height={22}
                  rx={4}
                  fill="#1e293b"
                  opacity="0.93"
                  pointer-events="none"
                />
                <text
                  x={tooltipX + 8}
                  y={tooltipY + 14}
                  font-size="10"
                  fill="#f1f5f9"
                  font-family="ui-sans-serif, system-ui, sans-serif"
                  pointer-events="none"
                >{node.label}</text>
              {/if}
            </g>
          {/each}
        </svg>
      </div>

      <!-- Note anti-PII -->
      <p class="mt-3 text-xs text-slate-400">
        <Info class="mr-1 inline-block h-3 w-3 align-text-bottom" aria-hidden="true" />
        Données issues des règlements et documents publics. Aucune information
        personnelle (Loi 25) — aucun propriétaire, aucun nom de personne.
      </p>
    {:else if graph && positioned.length === 0}
      <div class="rounded-lg border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-400">
        Aucun nœud dans le graphe de cette ville.
      </div>
    {/if}
  </div>
</div>
