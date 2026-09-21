<script>
  // Un rendu unique de chaque scène, sur la description canonique (graphe Mermaid
  // et métadonnées) : xyflow placé par ELK.
  // ARCH-7 : le second rendu a été supprimé du dossier à la demande de l'owner
  // (« supprimer la visauliation grafphviz ») — supprimé aussi : la bascule entre
  // rendus, le bloc de source dépliable sous la scène, et la dépendance WASM.
  import ElkFlow from './ElkFlow.svelte';
  let { graphs, manifest } = $props();
  const renderer = 'elk';
  const metric = (graph, engine) => manifest.layoutMetrics[graph.id][engine];
  // Taille effective du plus petit texte, scène ajustée à la vue (geometry-check.mjs).
  const at = (graph, engine, format) => metric(graph, engine).legibility.formats.find(item => item.format === format);
  const num = (value, digits = 1) => value.toFixed(digits).replace('.', ',');
  const gate = manifest.legibility.gate;
  const derogation = manifest.legibility.derogation;
  import { STATES } from './scene-metadata.js';
  const legendOrder = ['active', 'dormant', 'suspended', 'not-applicable', 'manual', 'retained', 'unknown'];
  const sceneInfo = {
    'architecture-sauvegardes': {
      badge: '§4 · ARCH-1 à ARCH-6',
      legend: true,
      lede: "La mise en page que tu as donnée, bloc par bloc. Au nord, une case UTILISATEUR — le navigateur, hors cluster, même convention que le dossier d'architecture d'ensemble. Au sud, l'ADMINISTRATION ET LE COFFRE : toi, le rôle d'administrateur du cluster, le coffre sops/age, le jeton OVH. Entre les deux, cinq colonnes, de l'ouest vers l'est. (1) GITHUB, verticale à 100 % : les workflows pra.yml et pra-watch à créer, la CD armée, le ticket d'alerte — ce que GitHub exécute et ce que GitHub émet, et rien d'autre. (2) HORS GITHUB, verticale et nettement séparée de la précédente : le courriel TEM Scaleway, le DNS Cloudflare avec Let's Encrypt. (3) LE CLUSTER MKS poc-ca : immo au nord, sa préproduction à l'ouest et sa production à l'est ; geo au centre, même partage ; la plateforme partagée au sud, sur toute la largeur — scellés, cert-manager, Traefik, KEDA, IdP. (4) LES BUCKETS OVH : immo au nord (préproduction au nord du nord, production au sud du nord), geo au centre (préproduction au nord du centre, production au sud du centre), les identités S3 tout au sud. (5) LA RÉPLICATION EN AUTRE RÉGION OVH, verticale, à l'est de la zone est. Les six zones Z1–Z6 de la section 4 restent la taxonomie du contenu : elles ne sont plus six boîtes à plat, elles sont réparties sur ces colonnes. Chaque rangée garde sa paire préproduction / production (ARCH-1). La couleur et le trait de chaque carte disent son état.",
      note: "Ce que ce plan a rendu, mesuré. Le cadre passe de 10 455 × 5 992 à 7 289 × 4 391 et le plus petit texte de 2,45 px à 3,35 px à 1440 × 900 — la scène occupe 27 % de hauteur en moins, et le texte gagne 37 %. En A4 paysage, 1,55 pt → 2,22 pt. La part de la surface occupée par les cartes elles-mêmes passe de 7 % à 14 % : ce sont les vides qui ont reculé, pas les cartes qui ont grossi. Le plan est tenu sur le rendu, pas seulement voulu, et un test échoue si un bloc lâche : le navigateur est au-dessus de tout, l'administration en dessous de tout, les cinq colonnes se suivent d'ouest en est sans se chevaucher, immo est au nord de geo qui est au nord de la plateforme, la préproduction est à l'ouest de la production dans chaque tenant, les buckets immo sont au nord des buckets geo qui sont au nord des clés, la plateforme partagée est aussi large que le plus large des deux tenants, l'administration au sud est sur une seule rangée horizontale (le pendant sud de la case utilisateur), et aucune des trois colonnes verticales n'a deux cartes côte à côte. ELK place par le flux et non par les points cardinaux : on ne lui demande donc plus l'emplacement des blocs. Il reçoit l'ordre imposé et garde le routage ; il ne place que dans les conteneurs que le plan ne nomme pas. Ce que cela coûte, dit franchement : deux colonnes non voisines ne se voient pas, donc les cinq liaisons qui vont de GitHub au cluster ou aux buckets survolent toute la bande — le nombre de coudes passe de 133 à 374 et la longueur de trait de 123 000 à 186 000 px. C'est le prix de l'ordre des colonnes que tu as fixé. Et la porte de 12 px reste hors d'atteinte : à 48 cartes, 3,35 px est 3,6 fois sous le plancher ; le choix entre scinder, ouvrir à taille lisible ou garder la vue compacte reste entier, et t'appartient (section 13). Pour le reste : chaque écart préprod / prod est une carte « absent » motivée, jamais un trou (ARCH-5) — la préproduction geo n'a pas d'irremplaçables ni de PostGIS parce que tout y vient de la production, et pas de réplique parce qu'elle garde le palier quotidien seul (proposition à valider, Q5b). Les clés sont posées chacune dans sa colonne avec un lien vers ce qu'elles ouvrent (ARCH-3) : les deux clés de scellement dans le cluster, sans export trouvé et en rotation vers le 22/09 (A1) ; les identités S3 au sud des buckets ; le jeton API OVH, qui ouvre le projet entier (Q19) ; le coffre sops/age au sud. GitHub Actions figure comme déclencheur et comme exécutant (ARCH-6). Aucun rendu Graphviz : il est supprimé (ARCH-7).",
    },
    'sequence-bout-en-bout': {
      badge: '§5 · PROC-1 à PROC-8',
      legend: true,
      lede: "Les déclencheurs que tu demandais, et ce qu'ils exécutent, de la demande au reçu. À gauche, le plan : ta demande de restauration (b), le workflow pra.yml paramétré, le passage automatique restreint (encore ouvert : Q12 et Q1), puis le plan avec ses garde-fous et la saisie confirm. À droite, trois chemins : P-a, le passage en préprod (arrêt des écrivains, point de sécurité, restore-into, test de migration, miroir des objets, réouverture et reçu) ; P-bi, la perte totale du cluster (cluster neuf par tofu, plateforme et clés, tenants et kubeconfigs, DNS et certificats, données, applications par empreinte) ; P-bii et P-biii, les restaurations complète et partielle, geo d'abord puis immo.",
      note: "Chaque étape nomme son déclencheur et son exécutant réel — workflow GitHub, CronJob, administrateur du cluster, toi (PROC-1). Le rôle « Coordinateur immo » a disparu : ses cinq tâches de la v2 sont réattribuées à des exécutants réels, et sa suppression est une décision de la spec (F13), pas ta demande — tu avais demandé la clarté. Aucune étape ne requiert une IA (OPS-2). Deux points restent ouverts sur ce schéma et ne sont pas tranchés ici : la source du passage en préprod (Q1, ton « dernier snapshot de preprod » contre la phrase précédente) et qui déclenche (a) (Q12, dont la recommandation est plus faible que ton texte). La représentation BPMN que tu évoquais est répondue en section 13 : oui, un couloir par acteur — le contenu P1 à P9 est écrit, le rendu bpmn-js ne l'est pas encore.",
    },
    'mise-en-service': {
      badge: '§11 · conservatoire, lots, preuves',
      legend: false,
      lede: "Ce qui ne peut pas attendre, ce que j'attends de toi, et ce qui le prouvera. Lot 0 d'abord, avant toute réponse : A1, l'export des clés de scellement avant la rotation, et Q0, le GO pour activer la sauvegarde planifiée de la production avec le code actuel. Puis les six lots de questions, dans l'ordre. Puis les neuf exercices qui transforment les engagements en preuves mesurées : E1 la reconstruction en moins de 2 h, E2 la préprod qui récupère intégralement la prod, E3 les restaurations partielles et un refus, E4 les deux régimes, E5 le retour N1 en moins de 5 min, E6 la même opération sans GitHub, E7 la garde sans IA, E8 les alertes acquittées, E9 la restauration depuis la réplique.",
      note: "Rien de ce chemin n'est engagé : aucune étape n'est faite. A1 n'est pas une question mais une action, et elle est datée : la rotation des clés de scellement est active tous les 30 jours et la prochaine tombe vers le 22/09 ; l'outil de poc-k8s refuse toute situation autre que deux clés, donc l'export doit être pris pendant que le compte vaut deux. Sans Q0, le RPO de la production reste non borné et vieillit — le dernier point connu a 8 jours. Les exercices sont chaînés parce que chacun consomme la preuve du précédent, mais E1 à E4 portent en plus une assertion de RPO depuis ton exigence des 24 h (point source ≤ 24 h, réplique ≤ 14 h).",
    },
  };
</script>

<section class="scenes" aria-label="Trois scènes du dossier de décision">
  <aside class="renderer-note" data-graphify-note>
    <strong>Un seul rendu, une seule description.</strong> Chaque scène se lit en xyflow placé par ELK
    (elkjs 0.12.0, algorithme par couches). <strong>Le rendu Graphviz <code>dot</code> a été supprimé</strong> du dossier,
    comme demandé (ARCH-7) : plus de bascule, plus de source <code>dot</code>, plus de dépendance WASM.
    <br><strong>Placement choisi par la lisibilité.</strong> Pour chaque scène, un balayage borné des réglages natifs
    d'ELK (672 candidats par scène) ; parmi les placements qui passent les contrôles géométriques, celui dont le plus
    petit texte est le plus grand une fois la scène ajustée à la vue. Portes ratifiées : {gate.minPx} px à 1440 × 900 ;
    en A4 paysage, {gate.minPt} pt pour le texte de lecture et {gate.minPtAnnotation} pt pour l'annotation secondaire
    (étiquette de liaison).
    {#if derogation}<strong class="legibility-gap">Aucune scène ne les tient</strong> : cette page est produite par
      dérogation explicite au build (« {derogation} ») ; la valeur mesurée est affichée sous chaque scène.
      C'est la mesure établie — au-delà d'une dizaine de cartes par vue, aucun placement ne tient le plancher. Les trois
      options de vue (scinder par domaine, ouvrir à taille lisible, garder la vue compacte) sont présentées en
      section 13 et <strong>attendent la décision de l'owner</strong> : ce dossier ne choisit pas à sa place.{/if}
    <br><strong>Le taux de remplissage n'est plus un critère contractuel</strong> : il reste publié comme indicateur. La
    règle ratifiée est qu'un libellé ne s'affiche que s'il tient sans troncature à la taille minimale.
    <br><strong>La chaîne graphify a été évaluée et écartée</strong> : c'est un moteur de graphe de connaissance à
    placement par forces, sans cadre de conteneur ni diagramme de séquence, et son export SVG relie les centres de
    cercles, sans ancrage sur les bords ni étiquette portée par le trait.
  </aside>
  {#each graphs as graph}
    <article class="scene" data-scene={graph.id} data-scene-hash={graph.sceneHash}>
      <header class="flex-row">
        <div><span class="eyebrow">{graph.date} · dossier de décision</span><h2>{graph.title}</h2></div>
        <span class="badge warning">{sceneInfo[graph.id].badge}</span>
      </header>
      <p class="scene-id"><code>{graph.id}</code> · <code>{graph.sceneHash.slice(0, 12)}…</code></p>
      <p class="lede">{sceneInfo[graph.id].lede}</p>
      {#if sceneInfo[graph.id].legend}
        <ul class="legend" aria-label="Légende des états">
          {#each legendOrder as state}<li data-state={state}><span class="swatch"></span>{STATES[state]}</li>{/each}
        </ul>
      {/if}
      <div class="renderer-toggle" role="group" aria-label={`Rendu de la scène ${graph.id}`}>
        <span class="renderer-metrics">rapport largeur / hauteur {metric(graph, renderer).ratio.toFixed(2).replace('.', ',')} ·
          {metric(graph, renderer).bends} coudes · extrémités hors bord {metric(graph, renderer).offBorder} ·
          croisements {metric(graph, renderer).crossings} · étiquettes détachées {metric(graph, renderer).detachedLabels}</span>
        <span class="renderer-metrics" data-legibility={renderer}>plus petit texte, ajusté à la vue :
          {num(at(graph, renderer, '1440x900').minPx)} px à 1440 × 900 · {num(at(graph, renderer, '1920x1080').minPx)} px à 1920 × 1080 ·
          {num(at(graph, renderer, 'A4-paysage').minPt)} pt en A4 · remplissage {Math.round(metric(graph, renderer).legibility.fill.blocks * 100)} % (indicatif)
          {#if metric(graph, renderer).legibility.formats.some(item => item.faults.length)} · <strong class="legibility-gap">sous les portes
            ({gate.minPx} px ; {gate.minPt} pt lecture, {gate.minPtAnnotation} pt annotation)</strong>{/if}</span>
      </div>
      <ElkFlow {graph} />
      <p class="scene-note">{sceneInfo[graph.id].note}</p>
      <p class="inventory">{graph.nodes.length} cartes · {graph.edges.length} liens · {graph.groups.length} conteneurs natifs <code>parentId</code> · gabarit A’ 460 × 200 à l’échelle 1 · ELK <code>layered</code>.</p>
      <details><summary>Source Mermaid canonique de cette scène</summary><pre>{graph.source}</pre></details>
    </article>
  {/each}
</section>

<style>
  .scenes { display: grid; gap: 40px; margin-block: 36px; }
  .renderer-note { padding: 14px 16px; border-left: 5px solid var(--st-semantic-data-category3, #6b7280); background: var(--st-semantic-surface-subtle); font-size: .88rem; line-height: 1.55; }
  .renderer-toggle { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 0; }
  .renderer-metrics { font-size: .78rem; color: var(--st-semantic-text-secondary); }
  .legibility-gap { color: #b42318; }
  @media print {
    .renderer-toggle, .renderer-note { break-inside: avoid; }
    .scene { break-before: page; }
    /* Le schéma occupe sa propre page, entier. */
    .scene :global(.flow) { break-before: page; break-inside: avoid; width: 26cm; height: 17.5cm; min-height: 0; }
    .scene :global(.svelte-flow__controls), .scene :global(.svelte-flow__minimap), .scene :global(.actual-size-control) { display: none; }
  }
  .scene { border-top: 4px solid var(--st-semantic-data-category1); padding-top: 16px; min-width: 0; }
  .scene h2 { margin: 4px 0; }
  .scene-id, .inventory { font-size: .78rem; color: var(--st-semantic-text-secondary); overflow-wrap: anywhere; }
  .scene-note { padding: 12px 14px; border-left: 5px solid var(--st-semantic-data-category2); background: var(--st-semantic-surface-subtle); font-size: .9rem; line-height: 1.55; }
  /* États des cartes et des conteneurs : couleur du filet gauche et trait. */
  .scene :global([data-node-kind="ordinary"][data-runtime-state="active"]) { border-left-color: #2f6f4f; }
  .scene :global([data-node-kind="ordinary"][data-runtime-state="dormant"]) { border-left-color: #2b5fb4; }
  .scene :global([data-node-kind="ordinary"][data-runtime-state="suspended"]) { border-left-color: #c77700; border-style: solid; background: #fff7e8; }
  .scene :global([data-node-kind="ordinary"][data-runtime-state="not-applicable"]) { border-left-color: #8a8f98; border-style: dashed; background: #f4f5f7; }
  .scene :global([data-node-kind="ordinary"][data-runtime-state="manual"]) { border-left-color: #7a3fa0; }
  .scene :global([data-node-kind="ordinary"][data-runtime-state="retained"]) { border-left-color: #0f766e; border-style: dashed; background: #ecfdf5; }
  .scene :global([data-node-kind="ordinary"][data-runtime-state="unknown"]) { border-left-color: #b42318; border-style: dotted; background: #fff1f0; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 20px; list-style: none; padding: 0; margin: 8px 0 14px; font-size: .85rem; }
  .legend li { display: flex; align-items: center; gap: 8px; }
  .swatch { width: 22px; height: 14px; border: 2px solid #6b7280; border-left-width: 8px; }
  .legend [data-state="active"] .swatch { border-left-color: #2f6f4f; }
  .legend [data-state="dormant"] .swatch { border-left-color: #2b5fb4; }
  .legend [data-state="suspended"] .swatch { border-left-color: #c77700; background: #fff7e8; }
  .legend [data-state="not-applicable"] .swatch { border-left-color: #8a8f98; border-style: dashed; background: #f4f5f7; }
  .legend [data-state="manual"] .swatch { border-left-color: #7a3fa0; }
  .legend [data-state="retained"] .swatch { border-left-color: #0f766e; border-style: dashed; background: #ecfdf5; }
  .legend [data-state="unknown"] .swatch { border-left-color: #b42318; border-style: dotted; background: #fff1f0; }
</style>
