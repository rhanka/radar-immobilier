<script>
  // Mini-schéma d'une option : barres avant / après, ou lignes de graph_nodes avec leur clé.
  // HTML et jetons du thème : lisible en clair comme en sombre, sans carte de composant.
  let { spec, id } = $props();
  const max = $derived(spec.type === 'bars' ? Math.max(...spec.rows.map(row => row.value), 1) : 1);
</script>

<figure class="mini" data-mini={id} data-mini-type={spec.type}>
  <figcaption>{spec.title}</figcaption>
  {#if spec.type === 'bars'}
    <div class="bars">
      {#each spec.rows as row}
        <div class="bar-row" data-tone={row.tone}>
          <span class="bar-label">{row.label}</span>
          <span class="bar-track"><span class="bar" style={`width:${Math.max(row.value / max * 100, 1.5)}%`}></span></span>
          <span class="bar-value"><strong>{row.value}</strong>{#if row.note}{' · '}<em>{row.note}</em>{/if}</span>
        </div>
      {/each}
    </div>
  {:else}
    <table>
      <thead><tr><th class:key={spec.key.includes('city_slug')}>city_slug</th><th class="key">id</th><th>contenu</th></tr></thead>
      <tbody>
        {#each spec.rows as [nodeId, city, content]}
          <tr><td>{city}</td><td><code>{nodeId}</code></td><td>{content}</td></tr>
        {/each}
      </tbody>
    </table>
    <p class="table-note" data-tone={spec.tone}>Clé : <code>{spec.key}</code> · {spec.note}</p>
  {/if}
</figure>

<style>
  .mini { margin: 10px 0; padding: 10px 12px; border: 1px dashed var(--st-semantic-border-strong); background: var(--st-semantic-surface-subtle); min-width: 0; }
  figcaption { font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--st-semantic-text-secondary); margin-bottom: 6px; }
  .bars { display: grid; gap: 5px; }
  .bar-row { display: grid; grid-template-columns: 5.6rem minmax(0, 1fr); gap: 2px 8px; align-items: center; font-size: .8rem; }
  .bar-label { color: var(--st-semantic-text-primary); }
  .bar-track { display: block; height: 12px; background: var(--st-semantic-surface-default); border: 1px solid var(--st-semantic-border-subtle); }
  .bar { display: block; height: 100%; background: var(--st-semantic-data-category1); }
  .bar-row[data-tone='alert'] .bar { background: var(--mini-alert); }
  .bar-row[data-tone='good'] .bar { background: var(--mini-good); }
  .bar-value { grid-column: 2; font-size: .78rem; color: var(--st-semantic-text-secondary); overflow-wrap: anywhere; }
  .bar-value strong { color: var(--st-semantic-text-primary); }
  table { width: 100%; border-collapse: collapse; font-size: .78rem; table-layout: fixed; }
  th, td { padding: 4px 6px; border: 1px solid var(--st-semantic-border-subtle); text-align: left; overflow-wrap: anywhere; color: var(--st-semantic-text-primary); }
  th { background: var(--st-semantic-surface-default); }
  th.key { text-decoration: underline; }
  th.key::after { content: ' · clé'; font-weight: 400; color: var(--st-semantic-text-secondary); }
  .table-note { margin: 6px 0 0; font-size: .78rem; font-weight: 650; }
  .table-note[data-tone='warn'] { color: var(--mini-alert-text); }
  .table-note[data-tone='good'] { color: var(--mini-good-text); }
  .mini { --mini-alert: #c4402f; --mini-good: #1f7a45; --mini-alert-text: #a3271a; --mini-good-text: #17633a; }
  @media (prefers-color-scheme: dark) {
    .mini { --mini-alert: #ff8a7a; --mini-good: #5fd08e; --mini-alert-text: #ff9c8f; --mini-good-text: #7ddda4; }
  }
</style>
