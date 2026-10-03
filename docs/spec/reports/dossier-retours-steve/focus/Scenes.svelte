<script>
  // Rendu natif : Flow.svelte de la chaîne existante (SvelteFlow, Dagre LR,
  // carte unique A' 460 x 200, fitView, zoom, 1:1, minimap, routeur du kit h2a).
  import Flow from '../../../../architecture/focus/Flow.svelte';
  let { graphs } = $props();
  const sceneInfo = {
    'criteres-steve': {
      badge: '§2 · ce que veut Steve',
      lede: "Quatre conteneurs, un par critère de Steve (et un pour ses deux exclusions transversales) : à gauche ce qu'il demande, chiffré sur son tableur ; à droite ce que fait le radar aujourd'hui, couvert, partiel ou absent. Le dernier conteneur porte l'effet mesuré sur sa vue de travail.",
      note: "Les 24 signaux de bruit de la passe 1 se répartissent par critère : 3 hors résidentiel ou hors urbanisme, 4 resserrements, 6 sans effet sur la capacité, 11 hors portée (8 autorisations individuelles, 3 points d'ordre du jour). Le radar filtre par nature d'instrument et par étape ; Steve demande un filtre par effet du règlement, sens et nombre d'unités, pour lequel aucune donnée n'existe encore.",
    },
    'modele-donnees': {
      badge: '§6 · modèle M3 proposé',
      lede: "Cinq conteneurs de gauche à droite : les octets reçus et toutes leurs cellules, les référentiels de Steve (codes, règles, constats), les jugements versionnés, les ancres durables, puis la publication conforme au contrat sentropic. Les tables sont des propositions ; seule prospect_notes existe déjà.",
      note: "Une ligne du classeur produit une évaluation versionnée, rattachée à 1 à N objets par des clés texte sans clé étrangère : une ré-extraction du graphe ne détruit rien, l'ancre passe en « disparue » et l'instantané observé reste lisible. La projection Comment ({kind:'record', recordType:'radar.*'}) suit le contrat sans élargir le port ; aucune suppression physique, conformément à la décision O1.",
    },
    'flux-import-oracle': {
      badge: '§6.5, §7, §9.3 · de l’entrée à la mesure',
      lede: "Six conteneurs : les deux fichiers de Steve, l'import idempotent en dry-run par défaut, le rattachement sur snapshot avec sa file manuelle, l'annotation visible dans le panneau et le rail, les deux oracles, puis la mesure.",
      note: "L'oracle de ciblage C et l'oracle d'extraction E restent séparés jusqu'au benchmark, où ils alimentent deux volets distincts. L'analyse du 21 septembre entre comme annotation distincte de l'adjudication : elle n'écrase pas les classes du tableur, qui font foi pour l'import.",
    },
    'architecture-ui': {
      badge: '§8 · état mesuré sur main 27891b10',
      lede: "Trois conteneurs : l'UI (Vite + Svelte 5), l'API Hono et les paquets sentropic. Les cartes pleines sont constatées dans le code ; les cartes « nouveau » et « nouvelle » sont les ajouts proposés pour la première livraison.",
      note: "La carte Signaux reste un MapLibre local de 2 761 lignes ; les composants geo partagés ne servent qu'au pilote #/geo et le moteur 3D est désactivé. L'avis de Steve se monte dans le panneau et le rail avec les composants DS déjà adoptés : la première livraison n'attend pas la migration geo.",
    },
    'affichage-abc': {
      badge: '§9.5 · D12 et D13 ouverts',
      lede: "Quatre conteneurs : un inventaire commun, les trois profils calculés côté serveur, les trois états de C, puis la mesure qui mène au seuil de bascule. B reste le défaut ; A est une référence gelée ; C est calculée en parallèle.",
      note: "Une absence de donnée n'est jamais une exclusion : l'indéterminé et le mixte restent visibles dans l'état « à instruire ». L'exposition de la comparaison (UAT seulement ou sélecteur visible) et le seuil chiffré de bascule sont laissés à Farid.",
    },
  };
</script>

<section class="scenes" aria-label="Cinq scènes du dossier de décision">
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
