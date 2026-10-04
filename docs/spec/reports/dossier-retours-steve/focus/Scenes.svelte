<script>
  // Une forme par contenu : matrice (scène 1), entité-relation (scène 2), architecture
  // en couloirs avec l'oracle en bande basse (scène 3) ; les composants (scènes 4 et 5)
  // gardent Flow.svelte de la chaîne existante (SvelteFlow, Dagre LR, carte A' 460 x 200).
  import Flow from '../../../../architecture/focus/Flow.svelte';
  import MatrixScene from './MatrixScene.svelte';
  import ErDiagram from './ErDiagram.svelte';
  import LaneDiagram from './LaneDiagram.svelte';
  let { graphs } = $props();
  const sceneInfo = {
    'criteres-steve': {
      badge: '§2 · ce que veut Steve',
      lede: "Une matrice : une ligne par critère de Steve et par exclusion transversale ; ce qu'il demande, ce que fait le radar aujourd'hui, la couverture (partiel ou absent) et le bruit que chaque écart laisse dans sa vue de travail (passe 1, 73 signaux).",
      note: "Les 24 signaux de bruit de la passe 1 se répartissent par critère : 3 hors résidentiel ou hors urbanisme, 4 resserrements, 6 sans effet sur la capacité, 8 autorisations individuelles, 3 points d'ordre du jour. Le radar filtre par nature d'instrument et par étape ; Steve demande un filtre par effet du règlement, sens et nombre d'unités, pour lequel aucune donnée n'existe encore (§2.3).",
    },
    'modele-donnees': {
      badge: '§6 · modèle M3 proposé',
      lede: "Un diagramme entité-relation : chaque boîte est une table avec ses colonnes clés (PK, FK, UK), chaque lien une relation avec sa cardinalité. Cinq couches de gauche à droite : sources immuables, référentiels de Steve, jugements versionnés, ancres durables, publication conforme au contrat sentropic. Seules graph_nodes et prospect_notes existent déjà ; les autres tables sont proposées (§6.3).",
      note: "Une ligne du classeur produit une évaluation versionnée, rattachée à 1 à N objets par des clés texte sans clé étrangère : une ré-extraction du graphe ne détruit rien, l'ancre passe en « disparue » et l'instantané observé reste lisible. La projection Comment ({kind:'record', recordType:'radar.*'}) suit le contrat sans élargir le port ; aucune suppression physique, conformément à la décision O1.",
    },
    'flux-import-oracle': {
      badge: '§6.5, §7, §9.3 · architecture et oracle',
      lede: "Une architecture en couloirs verticaux, de gauche à droite : les utilisateurs, les écrans de l'UI, les fonctions backend (collecte, détection de signal, import, rattachement, API), puis les données sur les composants réels, S3 et PostgreSQL. L'oracle est en bas, en bande transversale : un système d'évaluation hors ligne, alimenté par les annotations stockées en base.",
      note: "L'oracle de ciblage C et l'oracle d'extraction E restent séparés jusqu'au benchmark, où ils alimentent deux volets distincts. L'analyse du 21 septembre entre comme annotation distincte de l'adjudication : elle n'écrase pas les classes du tableur, qui font foi pour l'import. L'import est un acte owner distinct, sur l'image Node existante de l'API (§6.5).",
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
      {#if graph.kind === 'matrix'}
        <MatrixScene {graph} />
      {:else if graph.kind === 'er'}
        <ErDiagram {graph} />
      {:else if graph.kind === 'lanes'}
        <LaneDiagram {graph} />
      {:else}
        <Flow {graph} />
      {/if}
      <p class="scene-note">{sceneInfo[graph.id].note}</p>
      {#if graph.kind === 'matrix'}
        <p class="inventory">{graph.projection.rows.length} lignes · matrice tirée du tableau canonique de l’annexe B.</p>
      {:else if graph.kind === 'er'}
        <p class="inventory">{graph.entities.length} tables · {graph.relations.length} relations · diagramme entité-relation tiré du bloc <code>erDiagram</code> de l’annexe B.</p>
      {:else if graph.kind === 'lanes'}
        <p class="inventory">{graph.nodes.length} blocs · {graph.edges.length} liens · 4 couloirs, 2 magasins de données (S3, PostgreSQL), 1 bande oracle · grille explicite et routage orthogonal.</p>
      {:else}
        <p class="inventory">{graph.nodes.length} cartes · {graph.edges.length} liens · {graph.groups.length} conteneurs natifs <code>parentId</code> · gabarit A’ 460 × 200 à l’échelle 1 · Dagre <code>rankdir LR</code>.</p>
      {/if}
      <details><summary>Source canonique de cette scène</summary><pre>{graph.source}</pre></details>
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
