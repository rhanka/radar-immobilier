<script>
  // Rendu natif : Flow.svelte de la chaîne existante (SvelteFlow, Dagre LR,
  // carte unique A' 460 x 200, fitView, zoom, 1:1, minimap, routeur du kit h2a).
  import Flow from '../../../../architecture/focus/Flow.svelte';
  let { graphs } = $props();
  const sceneInfo = {
    'way-of-working': {
      badge: 'Q1 · §2.2 et §2.3',
      lede: "Neuf conteneurs de gauche à droite : les 8 colonnes demandées par l'owner, puis la valeur terminale « En prod (clos) » qu'impose l'automatisation de fermeture. Chaque conteneur porte cinq cartes : la colonne owner et sa borne de WIP, le critère d'entrée, le critère de sortie, la main qui déplace — dont l'état de l'automatisation — et l'artefact attendu.",
      note: "Deux automatisations intégrées seulement : l'auto-ajout en colonne 1 et la fermeture vers la colonne 9. Les colonnes 6 et 7 attendent une action GitHub à écrire (lot T12) ; les colonnes 2 à 5 et 8 ne bougent que par le script kanban-move. Les arêtes portent les transitions ; la flèche pointillée est le retour « UAT KO » vers le dev.",
    },
    'iteration-15-jours': {
      badge: 'Q2 · §4.2 et §4.3',
      lede: "Les items recommandés sont posés dans leur colonne de départ : le jour 0 de déblocage, les cinq livrables qui entrent en design dès la semaine 1, les deux qui n'y entrent qu'en semaine 2 — l'échelonnement qui tient le WIP design à 3 —, les deux chantiers qui entrent en dev, et l'armement prod qui attend en « À déployer prod ».",
      note: "Le détail de chaque carte donne l'ordre et la semaine. Les arêtes sont les dépendances de §4.3 ; la circularité O1 ↔ O2 dépend de la définition du hold, tranchée en §7.",
    },
  };
</script>

<section class="scenes" aria-label="Deux scènes du dossier de décision">
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
      <p class="inventory">{graph.nodes.length} cartes · {graph.edges.length} transitions · {graph.groups.length} conteneurs natifs <code>parentId</code> · gabarit A’ 460 × 200 à l’échelle 1 · Dagre <code>rankdir LR</code>.</p>
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
