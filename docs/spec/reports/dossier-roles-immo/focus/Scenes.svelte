<script>
  // Rendu natif : Flow.svelte de la chaîne existante (SvelteFlow, Dagre LR,
  // carte unique A' 460 x 200, fitView, zoom, 1:1, minimap, routeur du kit h2a).
  import Flow from '../../../../architecture/focus/Flow.svelte';
  let { graphs } = $props();
  const sceneInfo = {
    'roles-perimetres': {
      badge: '§5 · affectation des personnes',
      lede: "Quatre conteneurs : les personnes (identité stable), les fonctions du cadre owner, le rôle h2a (un seul PRINCIPAL, Fabien, et les agents sous mandat), puis les périmètres de décision. Chaque personne exerce une fonction ; seule la fonction porte des droits.",
      note: "Farid, Mathieu et Steve sont des humains décideurs sans rôle h2a : leur fonction et leurs droits sont déclarés dans le profil du dépôt, pas dans le protocole. L'option « Steve PRINCIPAL client:radar » est en pointillé barré : réservée par le quorum, fermée tant que la DEC h2a sur le scope des signataires n'est pas appliquée. Le droit de décision de Mathieu sur l'orientation est en pointillé : non vérifié (D7, D17).",
    },
    'matrice-decide-valide': {
      badge: '§6 · matrice par type de décision',
      lede: "Les dix-sept lignes de la matrice §6, regroupées en treize cartes et trois familles (client et coût, produit, technique et opérations), chaque carte portant son décideur et ses validations. Les liens vont vers les deux validations nommées : Validation PO (Farid) et Validation AI Builder (Fabien).",
      note: "Quatre domaines portent les deux validations sur la même version : itération, recette, sémantique, release. Les liens en pointillé sont les déclencheurs conditionnels de la Validation PO sur une décision technique (D4). product.orientation porte « dernier mot unknown » : Mathieu oriente (fonction du cadre), Farid valide la traduction en backlog, et le décideur du dernier mot n'est inscrit qu'après la réponse de Steve et de Mathieu (D7, Q17.1).",
    },
    'circuit-validation': {
      badge: '§7 · validation PO puis AI Builder',
      lede: "Six étapes : un agent prépare (dossier, preuves, empreinte) ; le présentateur publie le bloc « qui décide » et sollicite les consultés ; le décideur nommé tranche ; Farid valide (PO) ; Fabien valide (AI Builder) ; l'autorisation n'existe que si tout tient, puis un agent sous mandat exécute.",
      note: "Les garde-fous sont en pointillé : une révision invalide l'accord antérieur ; un délai expiré n'est jamais un GO ; l'urgence suit une procédure préautorisée et bornée (D8), avec revue de Farid après intervention qui ne vaut pas validation rétroactive ; le compte qui relaie ne prouve pas le décideur. Quand Fabien est à la fois décideur et valideur, sa réponse couvre les deux si elle les nomme, jamais comme deux validations indépendantes.",
    },
    'deux-branches-d10': {
      badge: '§5.3 · décision h2a D10, ouverte',
      lede: "La décision h2a D10 n'est pas prise : invariant protocolaire (branche A) ou règle de profil par défaut (branche B). Le conteneur du milieu montre que l'affectation immo est identique sous les deux branches ; le dernier, ce qui diffère.",
      note: "Sous A, la règle « seuls PRINCIPAL et EXECUTIF sont humains » est portée par h2a et le profil immo la répète ; sous B, c'est le profil immo qui la porte et le contrôle statique qui la vérifie. D2 (écrire la règle dans le profil maintenant) tient dans les deux cas. L'option Steve PRINCIPAL reste réservée sous les deux branches.",
    },
    'immo-vs-geo': {
      badge: '§9 · immo et geo côte à côte',
      lede: "Une même personne, Fabien, PRINCIPAL des deux dépôts. À immo, quatre humains et un GO production validé par deux personnes ; à geo, un seul humain (owner, PO, mainteneur), des fonctions tenues par des agents sous mandat (l'attribution de la fonction de mainteneur à Fabien est non vérifiée), et un GO autorisé par Fabien, exécuté par geo-cond, tenants consultés.",
      note: "Le même modèle sépare des personnes à immo et des actes d'une même personne à geo. La rupture d'un contrat servi geo → immo pose deux questions distinctes même quand Fabien répond aux deux : geo adopte-t-il la rupture (PO geo) ? immo l'accepte-t-il (owner immo, via i-cond) ? L'autorité plateforme k8s reste à nommer.",
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
