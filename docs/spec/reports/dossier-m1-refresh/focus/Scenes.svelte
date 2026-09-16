<script>
  // Rendu natif : Flow.svelte de la chaîne existante (SvelteFlow, Dagre LR,
  // carte unique A' 460 x 200, fitView, zoom, 1:1, minimap, routeur du kit h2a).
  import Flow from '../../../../architecture/focus/Flow.svelte';
  let { graphs } = $props();
  const sceneInfo = {
    'chaine-de-mesure': {
      badge: '§3 · les six couches',
      lede: "Six conteneurs de gauche à droite : transport, JSON, structure, profil, provenance, accepté. Une porte fermée arrête tout — les suivantes ne sont pas évaluées et valent N-A. Chaque conteneur porte trois cartes : ce qu'on vérifie, le refus réellement observé sur la campagne v100 avec sa classe et son effectif, et un exemple réel tiré des reçus.",
      note: "Les trois premières couches ne refusent plus rien sur 100 documents : 100 HTTP 200, 98 réponses sur 100 arrivent dans un bloc Markdown que le normalisateur absorbe, et l'extraction passe 100/100. Les 13 refus se concentrent sur le profil (7 documents) et sur la provenance (6 documents). Les libellés d'arête portent le passage mesuré d'une couche à la suivante.",
    },
    'resultats-v4-v100': {
      badge: '§4 et §6 · campagnes et options',
      lede: "Une carte par campagne, dans l'ordre chronologique : contrat, modèle, plafond, acceptés, latence moyenne et F1 — ou les deux juges aveugles pour v100. Les conteneurs sont les cinq époques de la lane, reliées par ce qui a débloqué la suivante. Le dernier conteneur porte les quatre options de §6, chacune avec son plafond mesuré.",
      note: "La colonne F1 n'est pas comparable ligne à ligne : le scoreur ne note que les sorties acceptées, donc chaque campagne porte sur une population de documents différente. Les plafonds mesurés des options se lisent en série : A laisse le taux à 87 %, B′ vise les six refus d'ancrage (87 → 93 %), C′ vise les neuf refus tenant à un seul enregistrement (87 → 96 %), D′ ne corrige aucune cause et mesure la variance.",
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
      <p class="inventory">{graph.nodes.length} cartes · {graph.edges.length} liens · {graph.groups.length} conteneurs natifs <code>parentId</code> · gabarit A’ 460 × 200 à l’échelle 1 · Dagre <code>rankdir LR</code>.</p>
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
