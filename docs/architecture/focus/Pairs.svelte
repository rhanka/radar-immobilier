<script>
  import Flow from './Flow.svelte';
  import Mermaid from './Mermaid.svelte';
  let { graphs } = $props();
  const pairInfo = {
    A: { title: 'Série A · hébergement', scope: 'Trois états',
      labels: ['Scaleway pur · avant décision OVH', 'OVH ≈ 90 % · MinIO encore en place', 'OVH préprod + prod · sans MinIO'] },
    B: { title: 'Série B · pipeline', scope: 'Avant / après intégration cluster',
      labels: ['Graphify 2.3 local · orchestration manuelle', 'Préprod acceptée · production dormante jusqu’à PR #682'] },
  };
</script>

<section class="architecture-pairs" aria-label="Deux paires architecture avant après">
  {#each ['A', 'B'] as pair}
    <section class="pair" data-pair={pair}>
      <header class="pair-heading"><div><span class="eyebrow">Transition autonome</span><h2>{pairInfo[pair].title}</h2></div><span class="badge">{pairInfo[pair].scope}</span></header>
      <div class="pair-grid">
        {#each graphs.filter(graph => graph.pair === pair) as graph, index}
          <article class="scene" data-scene={graph.id} data-scene-hash={graph.sceneHash}>
            <header><div><span class="date">{graph.date}</span><h3>{pair === 'A' ? ['JUILLET', 'AU 10 AOÛT', "AUJOURD'HUI"][index] : index === 0 ? 'AVANT' : 'APRÈS'}</h3></div>
              <span class="badge" class:warning={index > 0}>{pairInfo[pair].labels[index]}</span></header>
            <p class="scene-id"><code>{graph.id}</code> · <code>{graph.sceneHash.slice(0, 12)}…</code></p>
            <Flow {graph} />
            <Mermaid {graph} />
            {#if graph.id === 'pipeline-after-20260913'}
              <p class="acceptance-note">Préproduction acceptée : CronJob autonome à 05:17 UTC, Graphify en bibliothèque, llm-mesh in-process et keyring radar chiffré. Production dormante jusqu'à promotion de la PR #682.</p>
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
  .pair-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; }
  .scene { min-width: 0; overflow-x: auto; border-top: 4px solid var(--st-semantic-data-category1); padding-top: 14px; }
  .scene-id, .inventory { font-size: .78rem; color: var(--st-semantic-text-secondary); overflow-wrap: anywhere; }
  .date { font-size: .8rem; font-weight: 700; }
  .acceptance-note { padding: 12px; border-left: 5px solid var(--st-semantic-data-category2); background: var(--st-semantic-surface-subtle); font-weight: 650; }
</style>
