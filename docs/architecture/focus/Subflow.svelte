<script>
  let { data } = $props();
</script>
<div class="subflow-box" data-depth={data.depth}>
  <header><span>SOUS-FLOW · {data.entity.id}</span><strong>{data.label}</strong></header>
</div>
<style>
  .subflow-box { width: 100%; height: 100%; border: 2px solid var(--st-semantic-border-strong); background: var(--st-semantic-surface-subtle); }
  .subflow-box[data-depth='1'] { background: var(--st-semantic-surface-default); border-color: var(--st-semantic-data-category1); }
  .subflow-box[data-depth='2'] { background: var(--st-semantic-surface-subtle); border-color: var(--st-semantic-data-category2); }
  .subflow-box[data-depth='3'] { background: var(--st-semantic-surface-default); border-color: var(--st-semantic-data-category7); }
  header { height: 62px; padding: 8px 18px; border-bottom: 1px solid var(--st-semantic-border-subtle); display: flex; flex-direction: column; gap: 5px; }
  span { font-size: 11px; color: var(--st-semantic-text-secondary); letter-spacing: .08em; }
  strong { font-size: 18px; color: var(--st-semantic-text-primary); white-space: nowrap; }
</style>
