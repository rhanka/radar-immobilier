<script>
  // Rendu natif : Flow.svelte de la chaîne existante (SvelteFlow, Dagre LR,
  // carte unique A' 460 x 200, fitView, zoom, 1:1, minimap, routeur du kit h2a).
  import Flow from '../../../../architecture/focus/Flow.svelte';
  let { graphs } = $props();
  import { STATES } from './scene-metadata.js';
  const legendOrder = ['active', 'dormant', 'suspended', 'not-applicable', 'manual'];
  const sceneInfo = {
    'architecture-sauvegardes': {
      badge: '§2, §3, §5 · immo + geo',
      legend: true,
      lede: "Six conteneurs : immo préproduction et immo production (bases PostgreSQL et CronJobs de sauvegarde), les sauvegardes immo sur S3 OVH bhs (buckets par environnement, préfixes, verrou, cycle de vie), les trois identités S3 et les clés du propriétaire, la surveillance, et le volet geo (bucket source, irremplaçables, copie, bucket de reprise). La couleur et le trait de chaque carte disent son état : existant, livré dans la PR mais non actif, provisionné mais gelé, ou inexistant.",
      note: "Chaque identité ne peut qu'une chose : l'écrivain dépose, le lecteur lit, le purgeur supprime l'objet courant ; les clés d'administration restent chez le propriétaire, hors cluster (R1). Les défauts ouverts sont portés sur les cartes : reçus signés par l'écrivain (B1), aucune rétention par défaut (B2), cycle de vie qui ne couvre pas sets/ (G4), alerte dès l'activation (G2). Le volet geo n'existe encore que sur le papier : ni job de copie, ni bucket de reprise.",
    },
    'sequence-bout-en-bout': {
      badge: '§7 · exigence 2',
      legend: true,
      lede: "La sauvegarde d'un cycle, de gauche à droite : identifiant commun et T0, gel des écritures côté immo seulement, instantané et dump PostgreSQL dans la même transaction, copie des objets immo, copie geo sans gel puisque ses irremplaçables sont immuables, marqueur commun publié en dernier, dégel. Puis la restauration, dans l'ordre inverse de la dépendance : geo avant immo. Chaque carte dit qui exécute l'étape et ce qui prouve qu'elle a réussi.",
      note: "Seule l'étape S-3 est livrée : le chemin PostgreSQL garantit son propre instantané cohérent sans gel, et ses manifestes portent scope: postgres-only. Tout le reste attend le coordinateur de cycle (réserve R4). Point ouvert entre les deux plans (Fable I13) : le sort de exports/immo/ et de normalized/, réécrits en place côté geo.",
    },
    'mise-en-service': {
      badge: '§8 · exigences 3 et 4',
      legend: false,
      lede: "La preuve avant la fusion, puis l'activation simultanée de la préproduction et de la production. Chaque carte nomme l'acteur et le garde-fou de l'étape ; l'arête sortante porte sa preuve de sortie. L'acte de production — provisionner la production, fusionner, activer — est soumis à ton feu vert direct, dans la session de la lane qui l'exécute.",
      note: "Rien de ce chemin n'est engagé : toutes les étapes sont à faire. La première dépend des corrections demandées par les deux revues, la deuxième de ta décision D2. La fraîcheur est appliquée suspendue et ne reprend qu'après les deux premiers reçus vérifiés, pour ne pas réveiller l'astreinte à l'activation.",
    },
  };
</script>

<section class="scenes" aria-label="Trois scènes du dossier de décision">
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
  /* États des cartes et des conteneurs : couleur du filet gauche et trait. */
  .scene :global([data-node-kind="ordinary"][data-runtime-state="active"]) { border-left-color: #2f6f4f; }
  .scene :global([data-node-kind="ordinary"][data-runtime-state="dormant"]) { border-left-color: #2b5fb4; }
  .scene :global([data-node-kind="ordinary"][data-runtime-state="suspended"]) { border-left-color: #c77700; border-style: solid; background: #fff7e8; }
  .scene :global([data-node-kind="ordinary"][data-runtime-state="not-applicable"]) { border-left-color: #8a8f98; border-style: dashed; background: #f4f5f7; }
  .scene :global([data-node-kind="ordinary"][data-runtime-state="manual"]) { border-left-color: #7a3fa0; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 20px; list-style: none; padding: 0; margin: 8px 0 14px; font-size: .85rem; }
  .legend li { display: flex; align-items: center; gap: 8px; }
  .swatch { width: 22px; height: 14px; border: 2px solid #6b7280; border-left-width: 8px; }
  .legend [data-state="active"] .swatch { border-left-color: #2f6f4f; }
  .legend [data-state="dormant"] .swatch { border-left-color: #2b5fb4; }
  .legend [data-state="suspended"] .swatch { border-left-color: #c77700; background: #fff7e8; }
  .legend [data-state="not-applicable"] .swatch { border-left-color: #8a8f98; border-style: dashed; background: #f4f5f7; }
  .legend [data-state="manual"] .swatch { border-left-color: #7a3fa0; }
</style>
