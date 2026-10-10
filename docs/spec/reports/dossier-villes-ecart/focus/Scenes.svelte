<script>
  // Rendu natif : Flow.svelte de la chaîne existante (SvelteFlow, Dagre LR,
  // carte unique A' 460 x 200, fitView, zoom, 1:1, minimap, routeur du kit h2a).
  import Flow from '../../../../architecture/focus/Flow.svelte';
  let { graphs } = $props();
  const sceneInfo = {
    'architecture-ecart': {
      badge: '§2.2 · composants réels',
      lede: "Cinq couloirs verticaux, de gauche à droite : les utilisateurs, les écrans, les déclencheurs (rafraîchissement, jobs CD, ancien flux), les traitements, puis les données. Chaque carte est un composant réel. L'application ne lit que PG (couloir 5, graph_nodes) ; S3 garde un fichier latest.json par ville.",
      note: "L'écart naît à deux endroits : quand la projection upsertGraphAtomic refuse une ville (S3 avance, PG reste en arrière : G2, G4, G5, G6), et quand l'ancien flux écrit dans PG sans passer par S3 (G1). La collision se produit sur la flèche « ON CONFLICT id · collision » : graph_nodes n'a qu'une clé id pour toutes les villes, et graph_edges n'a pas de ville du tout (Figure 2).",
    },
  };
</script>

<section class="scenes" aria-label="Scène d'architecture du dossier de décision">
  {#each graphs as graph}
    <article class="scene" data-scene={graph.id} data-scene-hash={graph.sceneHash}>
      <header class="flex-row">
        <div><span class="eyebrow">{graph.date} · dossier de décision</span><h2>{graph.title}</h2></div>
        <span class="badge warning">{sceneInfo[graph.id].badge}</span>
      </header>
      <p class="scene-id"><code>{graph.id}</code> · <code>{graph.sceneHash.slice(0, 12)}…</code></p>
      <p class="lede">{sceneInfo[graph.id].lede}</p>
      <Flow {graph} />
      <p class="scene-note">{sceneInfo[graph.id].note}</p>
      <p class="inventory">{graph.nodes.length} cartes · {graph.edges.length} liens · {graph.groups.length} couloirs natifs <code>parentId</code> · gabarit A’ 460 × 200 à l’échelle 1 · Dagre <code>rankdir LR</code>.</p>
      <details><summary>Source Mermaid canonique de cette scène</summary><pre>{graph.source}</pre></details>
    </article>
  {/each}
</section>

<style>
  .scenes { display: grid; gap: 40px; margin-block: 36px; }
  .scene { border-top: 4px solid var(--st-semantic-data-category1); padding-top: 16px; min-width: 0; }
  .scene h2 { margin: 4px 0; }
  .scene-id, .inventory { font-size: .78rem; color: var(--st-semantic-text-secondary); overflow-wrap: anywhere; }
  .scene-note { padding: 12px 14px; border-left: 5px solid var(--st-semantic-data-category2); background: var(--st-semantic-surface-subtle); font-size: .9rem; line-height: 1.55; }
</style>
