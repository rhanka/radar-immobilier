<script lang="ts">
  /**
   * MrcGraphView — Studio de réconciliation : sous-graphe graphify agrégé par MRC.
   *
   * Affiche le sous-graphe agrégé d'une MRC (municipalités régionales de comté)
   * sous forme de rendu SVG pur — même approche que CityGraphView mais multi-villes.
   *
   * Sélecteur de MRC (avec nodeCount) chargé depuis GET /api/graph/mrcs.
   * Rendu SVG : nœuds par type, arêtes, couleurs et tooltip identiques à CityGraphView.
   * Affiche les villes de la MRC (citySlugs) sous le sélecteur.
   *
   * Anti-PII (Loi 25) : aucune donnée propriétaire. Les libellés de nœuds
   * viennent exclusivement des docs publics (règlements, zones, avis).
   * Aucun champ owner n'est jamais rendu — filtré à la source par le graph-store.
   *
   * Pas de nouvelle dépendance graphe (SVG pur — même approche que CityGraphView).
   */
  import { onMount } from "svelte";
  import { Network, RefreshCw, Info, MapPin } from "@lucide/svelte";
  import { Badge, Alert, EmptyState, Select } from "@sentropic/design-system-svelte";
  import {
    fetchMrcs,
    fetchMrcGraph,
    type MrcGraph,
    type MrcSummary,
    type GraphNode,
    type GraphEdge,
  } from "$lib/graph/graph-client.js";

  // ── Types internes ────────────────────────────────────────────────────────
  interface PositionedNode extends GraphNode {
    x: number;
    y: number;
  }

  // ── Configuration du rendu (identique à CityGraphView) ───────────────────
  const SVG_W = 760;
  const SVG_H = 520;
  const NODE_R = 22;
  const ROW_HEIGHT = 90;
  const COL_WIDTH = 110;
  const TOP_MARGIN = 50;
  const LEFT_MARGIN = 60;

  /** Ordre d'affichage par type (même ordre que CityGraphView). */
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

  // ── State : liste de MRCs ────────────────────────────────────────────────
  let mrcs: MrcSummary[] = [];
  let mrcsLoading = true;
  let mrcsError: string | null = null;
  let selectedMrc: string = "";

  // ── State : graphe MRC ───────────────────────────────────────────────────
  let graphLoading = false;
  let graph: MrcGraph | null = null;
  let graphError: string | null = null;
  let graphEmpty = false;

  let hoveredNodeId: string | null = null;

  // ── Chargement de la liste des MRCs ──────────────────────────────────────
  async function loadMrcs(): Promise<void> {
    mrcsLoading = true;
    mrcsError = null;
    const result = await fetchMrcs();
    mrcsLoading = false;
    if (result.kind === "ok") {
      mrcs = result.mrcs;
      if (mrcs.length > 0 && !selectedMrc) {
        selectedMrc = mrcs[0]!.mrc;
      }
    } else if (result.kind === "empty") {
      mrcs = [];
    } else {
      mrcsError = result.detail;
    }
  }

  // ── Chargement du graphe MRC ──────────────────────────────────────────────
  async function loadGraph(mrc: string): Promise<void> {
    if (!mrc) return;
    graphLoading = true;
    graphError = null;
    graphEmpty = false;
    graph = null;
    const result = await fetchMrcGraph(mrc);
    graphLoading = false;
    if (result.kind === "ok") {
      graph = result.graph;
    } else if (result.kind === "empty") {
      graphEmpty = true;
    } else {
      graphError = result.detail;
    }
  }

  // Recharge le graphe quand la MRC sélectionnée change
  let loadedMrc: string | null = null;
  $: if (selectedMrc && selectedMrc !== loadedMrc && !graphLoading) {
    loadedMrc = selectedMrc;
    void loadGraph(selectedMrc);
  }

  onMount(() => {
    void loadMrcs();
  });

  // ── Positionnement des nœuds (grille par type — identique à CityGraphView) ─
  function positionNodes(nodes: GraphNode[]): PositionedNode[] {
    const byType = new Map<string, GraphNode[]>();
    for (const n of nodes) {
      const arr = byType.get(n.type) ?? [];
      arr.push(n);
      byType.set(n.type, arr);
    }

    const presentTypes = TYPE_ORDER.filter((t) => byType.has(t));
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
  $: nodeCount = graph?.nodeCount ?? 0;
  $: edgeCount = graph?.edgeCount ?? 0;
  $: citySlugs = graph?.citySlugs ?? [];
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

  // ── Label court de l'arête (tronque à 18 chars) ───────────────────────────
  function edgeLabel(kind: string): string {
    return kind.length > 18 ? kind.slice(0, 16) + "…" : kind;
  }

  // ── Label court de nœud (tronque à 15 chars pour l'ellipse) ──────────────
  function shortLabel(label: string): string {
    return label.length > 14 ? label.slice(0, 12) + "…" : label;
  }

  // ── MRC summary (pour le sélecteur) ──────────────────────────────────────
  $: selectedMrcSummary = mrcs.find((m) => m.mrc === selectedMrc) ?? null;
</script>

<!-- ── Vue : sous-graphe graphify agrégé par MRC ─────────────────────────────── -->
<div class="flex h-full flex-col bg-slate-50" data-testid="mrc-graph-view">
  <!-- En-tête interne : sélecteur de MRC + badges -->
  <div class="flex shrink-0 flex-col gap-2 border-b border-slate-200 bg-white px-5 py-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Network class="h-4 w-4 text-teal-600" aria-hidden="true" />
        <span class="text-sm font-semibold text-slate-900">Graphe agrégé MRC</span>
        {#if graph}
          <Badge tone="neutral">{nodeCount} nœuds</Badge>
          <Badge tone="neutral">{edgeCount} arêtes</Badge>
        {/if}
      </div>
      <button
        type="button"
        aria-label="Actualiser le graphe MRC"
        class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
        onclick={() => selectedMrc && void loadGraph(selectedMrc)}
        disabled={graphLoading || !selectedMrc}
      >
        <RefreshCw
          class={`h-4 w-4 ${graphLoading ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
      </button>
    </div>

    <!-- Sélecteur de MRC -->
    {#if mrcsLoading}
      <div class="text-xs text-slate-400" aria-live="polite">Chargement des MRCs…</div>
    {:else if mrcsError}
      <div class="text-xs text-red-500" role="alert">{mrcsError}</div>
    {:else if mrcs.length === 0}
      <div class="text-xs text-slate-400">Aucune MRC indexée.</div>
    {:else}
      <div class="flex items-center gap-3">
        <Select
          id="mrc-selector"
          label="MRC"
          bind:value={selectedMrc}
          class="max-w-xs"
        >
          {#each mrcs as m (m.mrc)}
            <option value={m.mrc}>{m.mrc} ({m.nodeCount} nœuds)</option>
          {/each}
        </Select>

        <!-- Villes de la MRC sélectionnée -->
        {#if selectedMrcSummary && selectedMrcSummary.citySlugs.length > 0}
          <div class="flex flex-wrap items-center gap-1.5" aria-label="Villes de la MRC">
            <MapPin class="h-3 w-3 text-slate-400" aria-hidden="true" />
            {#each selectedMrcSummary.citySlugs as slug (slug)}
              <span
                class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
              >
                {slug}
              </span>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Contenu principal -->
  <div class="flex min-h-0 flex-1 flex-col overflow-auto p-5">
    {#if graphLoading}
      <div
        class="flex flex-1 items-center justify-center rounded-lg border border-slate-200 bg-white py-16 text-sm text-slate-400"
        aria-live="polite"
        aria-label="Chargement du graphe MRC"
      >
        Chargement du graphe MRC…
      </div>

    {:else if graphError}
      <Alert tone="warning" title="Erreur de chargement" message={graphError} />

    {:else if graphEmpty}
      <EmptyState
        title="Aucun graphe pour cette MRC"
        message="Le graphe graphify n'est pas encore calculé pour cette MRC. Lancez l'exploitation depuis les villes membres."
      />

    {:else if !selectedMrc}
      <div class="rounded-lg border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-400">
        Sélectionnez une MRC pour afficher le sous-graphe agrégé.
      </div>

    {:else if graph && positioned.length > 0}
      <!-- Villes de la MRC chargées (peut différer du sélecteur si MRC a changé) -->
      {#if citySlugs.length > 0}
        <div class="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <MapPin class="h-3 w-3 text-teal-500" aria-hidden="true" />
          <span class="font-medium">Villes :</span>
          {#each citySlugs as slug (slug)}
            <span class="rounded-full bg-teal-50 px-2 py-0.5 text-teal-700">{slug}</span>
          {/each}
        </div>
      {/if}

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

      <!-- SVG du graphe MRC -->
      <div class="overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <svg
          width={SVG_W}
          height={svgHeight}
          viewBox={`0 0 ${SVG_W} ${svgHeight}`}
          aria-label={`Sous-graphe graphify MRC ${selectedMrc} : ${nodeCount} nœuds, ${edgeCount} arêtes`}
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

              <!-- Tooltip au survol : label complet + ville -->
              {#if isHovered}
                {@const tooltipX = Math.min(node.x + NODE_R + 4, SVG_W - 180)}
                {@const tooltipY = Math.max(node.y - 28, 8)}
                {@const tooltipText = node.citySlug ? `${node.label} (${node.citySlug})` : node.label}
                <rect
                  x={tooltipX}
                  y={tooltipY}
                  width={Math.min(tooltipText.length * 6 + 16, 260)}
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
                >{tooltipText}</text>
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
        Aucun nœud dans le graphe de cette MRC.
      </div>
    {/if}
  </div>
</div>
