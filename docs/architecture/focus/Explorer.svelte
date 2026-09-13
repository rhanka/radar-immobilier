<script>
  import { Button, Badge, Flex } from '@sentropic/design-system-svelte';
  import Flow from './Flow.svelte';
  let { graphs } = $props();
  let graphId = $state('asis-1'), scope = $state(null), selected = $state(null), expanded = $state(false);
  let graph = $derived(graphs.find(g => g.id === graphId));
  let trail = $derived.by(() => {
    const result = []; let current = graph.groups.find(g => g.id === scope);
    while (current) { result.unshift(current); current = graph.groups.find(g => g.id === current.parent); }
    return result;
  });
  function open(id) { scope = id; selected = null; }
  function change(id) { graphId = id; scope = null; selected = null; }
  function locate(id) {
    const item = graph.nodes.find(n => n.id === id);
    if (item) { scope = item.parent; selected = item; }
  }
  let related = $derived(selected ? graph.edges.filter(e => e.source === selected.id || e.target === selected.id) : []);
</script>

<svelte:window onkeydown={event => { if (event.key === 'Escape') expanded = false; }} />
<section class:expanded class="explorer" aria-label="Architecture interactive">
  <Flex justify="between" align="center" wrap gap={2}>
    <label>Vue <select aria-label="Vue architecture" value={graphId} onchange={event => change(event.currentTarget.value)}>
      {#each graphs as item}<option value={item.id}>{item.title}</option>{/each}
    </select></label>
    <Badge tone={graphId.startsWith('target') ? 'warning' : 'neutral'}>{graphId.startsWith('target') ? 'PROPOSÉ · non déployé' : 'AS-IS · preuves datées'}</Badge>
    <Button variant="secondary" size="sm" onclick={() => expanded = !expanded}>{expanded ? 'Réduire' : 'Plein écran'}</Button>
  </Flex>
  <nav class="breadcrumbs" aria-label="Sous-flows">
    <button onclick={() => open(null)}>Schéma intégral</button>
    {#each trail as item}<span aria-hidden="true">/</span><button onclick={() => open(item.id)}>{item.label.split('·')[0]}</button>{/each}
  </nav>
  <div class="explorer-tools">
    <label>Zoomer sur une boîte <select aria-label="Zoomer sur un sous-flow" value={scope ?? ''} onchange={event => open(event.currentTarget.value || null)}>
      <option value="">Schéma intégral · toutes les boîtes ouvertes</option>
      {#each graph.groups as item}<option value={item.id}>{item.label}</option>{/each}
    </select></label>
    <label>Retrouver le même composant <select aria-label="Retrouver un composant" value="" onchange={event => locate(event.currentTarget.value)}>
      <option value="">Choisir une identité…</option>
      {#each graph.nodes.filter(n => n.resource) as item}<option value={item.id}>{item.resource}</option>{/each}
    </select></label>
  </div>
  <div class="graph-layout" class:inspecting={selected}>
    <Flow {graph} {scope} {open} focusId={selected?.edge ? null : selected?.id} select={item => selected = item} />
    {#if selected}<aside class="inspector" aria-label="Identité du composant">
      <button class="close" aria-label="Fermer le détail" onclick={() => selected = null}>×</button>
      <Badge tone="neutral">{selected.resource ?? selected.id}</Badge>
      <h3>{selected.label}</h3>
      <p>Source Mermaid : ligne {selected.line}. Une autre vue ne crée pas une autre ressource.</p>
      {#if selected.edge}<p>{selected.edge.label || 'Relation non étiquetée dans la source.'}</p>{/if}
      {#if selected.resource}<h4>Autres vues de cette identité</h4>
        {#each graphs.filter(g => g.id !== graph.id && g.nodes.some(n => n.resource === selected.resource)) as other}
          <button class="cross-link" onclick={() => { const id = selected.resource; change(other.id); locate(other.nodes.find(n => n.resource === id).id); }}>{other.title}</button>
        {/each}
      {/if}
      {#if related.length}<h4>Relations exactes</h4><ul>{#each related as edge}<li><code>{edge.source} {edge.both ? '↔' : '→'} {edge.target}</code><br>{edge.label || 'Sans étiquette'}{edge.dashed ? ' · conditionnel / non vérifié' : ''}</li>{/each}</ul>{/if}
    </aside>{/if}
  </div>
  <p class="caption">Tous les sous-flows sont emboîtés et affichés dans le même schéma. Cliquer sur une boîte zoome dessus sans masquer les autres composants ni leurs liens.
    {graph.nodes.length} composants · {graph.edges.length} relations · {graph.groups.length} sous-flows. Flèches READ : consommateur → store.</p>
  <details><summary>Source Mermaid exacte · mapping intégral</summary><pre>{graph.source}</pre></details>
</section>
