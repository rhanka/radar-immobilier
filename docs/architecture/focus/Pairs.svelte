<script>
  import Flow from './Flow.svelte';
  import Mermaid from './Mermaid.svelte';
  let { graphs } = $props();
  const pairInfo = {
    A: { title: 'Paire A · production', scope: 'Stockage et registre',
      before: 'MinIO + restes SCW/registre déclarés', after: 'OVH S3 + GHCR; aucun runtime SCW hors TEM' },
    B: { title: 'Paire B · refresh', scope: 'PV vers Signal',
      before: 'Orchestration manuelle depuis le poste', after: 'CronJob autonome intégré; PROD dormante; modèle en attente' },
  };
</script>

<section class="architecture-pairs" aria-label="Deux paires architecture avant après">
  {#each ['A', 'B'] as pair}
    <section class="pair" data-pair={pair}>
      <header class="pair-heading"><div><span class="eyebrow">Transition autonome</span><h2>{pairInfo[pair].title}</h2></div><span class="badge">{pairInfo[pair].scope}</span></header>
      <div class="pair-grid">
        {#each graphs.filter(graph => graph.pair === pair) as graph, index}
          <article class="scene" data-scene={graph.id} data-scene-hash={graph.sceneHash}>
            <header><div><span class="date">{graph.date}</span><h3>{index === 0 ? 'AVANT' : 'APRÈS'}</h3></div>
              <span class="badge" class:warning={index === 1}>{index === 0 ? pairInfo[pair].before : pairInfo[pair].after}</span></header>
            <p class="scene-id"><code>{graph.id}</code> · <code>{graph.sceneHash.slice(0, 12)}…</code></p>
            <Flow {graph} />
            <Mermaid {graph} />
            {#if graph.id === 'refresh-after-20260913'}
              <p class="acceptance-note">Préproduction acceptée : trial Luna high, Signal/PDF et rejeu exact. Production dormante jusqu'à promotion; modèle encore à ratifier par M1.</p>
            {/if}
            <p class="inventory">{graph.nodes.length} cartes · {graph.edges.length} relations · {graph.groups.length} sous-flux natifs <code>parentId</code> · icônes et provenance <code>repo:</code>.</p>
          </article>
        {/each}
      </div>
    </section>
  {/each}
</section>

<style>
  .architecture-pairs { display: grid; gap: 40px; }
  .pair { border: 1px solid var(--st-semantic-border-subtle); padding: 20px; }
  .pair-heading, .scene > header { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
  .pair-heading h2, .scene h3 { margin: 4px 0; }
  .pair-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
  .scene { min-width: 0; border-top: 4px solid var(--st-semantic-data-category1); padding-top: 14px; }
  .scene-id, .inventory { font-size: .78rem; color: var(--st-semantic-text-secondary); overflow-wrap: anywhere; }
  .date { font-size: .8rem; font-weight: 700; }
  .acceptance-note { padding: 12px; border-left: 5px solid var(--st-semantic-data-category2); background: var(--st-semantic-surface-subtle); font-weight: 650; }
  @media (max-width: 1100px) { .pair-grid { grid-template-columns: 1fr; } }
</style>
