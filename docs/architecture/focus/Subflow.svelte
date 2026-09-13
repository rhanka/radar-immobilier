<script>
  import ServiceIcon from './ServiceIcon.svelte';
  let { data } = $props();
</script>
<div class="subflow-box" data-depth={data.depth}>
  <header>
    <ServiceIcon kind={data.provenance.icon} />
    <div><span>{data.provenance.service} · SOUS-FLOW {data.entity.id}</span><strong>{data.label}</strong>
      <b class="repo-label">{data.provenance.repoLabel}</b><small>{data.provenance.role}</small></div>
  </header>
</div>
<style>
  .subflow-box { width: 100%; height: 100%; border: 2px solid var(--st-semantic-border-strong); background: var(--st-semantic-surface-subtle); }
  .subflow-box[data-depth='1'] { background: var(--st-semantic-surface-default); border-color: var(--st-semantic-data-category1); }
  .subflow-box[data-depth='2'] { background: var(--st-semantic-surface-subtle); border-color: var(--st-semantic-data-category2); }
  .subflow-box[data-depth='3'] { background: var(--st-semantic-surface-default); border-color: var(--st-semantic-data-category7); }
  header { height: 102px; padding: 10px 18px; border-bottom: 1px solid var(--st-semantic-border-subtle); display: flex; align-items: center; gap: 16px; }
  header div { display: flex; flex-direction: column; gap: 4px; }
  span, small { font-size: 11px; color: var(--st-semantic-text-secondary); }
  strong { font-size: 18px; color: var(--st-semantic-text-primary); }
  .repo-label { font-size: 12px; color: var(--st-semantic-text-primary); }
</style>
