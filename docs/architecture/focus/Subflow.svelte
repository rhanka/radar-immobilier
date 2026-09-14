<script>
  import ServiceIcon from './ServiceIcon.svelte';
  let { data } = $props();
</script>
<div class="subflow-box" data-node-kind="cluster" data-id={data.entity.id} data-parent-id={data.parentId ?? ''}
  data-evidence-class={data.evidenceClass} data-runtime-state={data.runtimeState} data-depth={data.depth}
  data-repo={data.provenance.repo.join(' + ')} data-kind={data.kind} data-label={data.label}>
  <header>
    <ServiceIcon kind={data.provenance.icon} />
    <div><strong data-text-role="subflow-title">{data.title}</strong>
      <span data-text-role="status">{data.statusLabel}</span><b class="repo-label" data-text-role="repo">{data.provenance.repoLabel}</b></div>
  </header>
</div>
<style>
  .subflow-box { width: 100%; height: 100%; border: 2px solid var(--st-semantic-border-strong); background: var(--st-semantic-surface-subtle); }
  .subflow-box[data-depth='1'] { background: var(--st-semantic-surface-default); border-color: var(--st-semantic-data-category1); }
  .subflow-box[data-depth='2'] { background: var(--st-semantic-surface-subtle); border-color: var(--st-semantic-data-category2); }
  .subflow-box[data-depth='3'] { background: var(--st-semantic-surface-default); border-color: var(--st-semantic-data-category7); }
  header { padding: 8px; border-bottom: 1px solid var(--st-semantic-border-subtle); display: flex; align-items: center; gap: 6px; }
  header div { display: grid; grid-template-columns: auto auto; gap: 4px 16px; min-width: 0; }
  strong { grid-column: 1 / -1; font-size: 36px; line-height: 1.2; color: var(--st-semantic-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  span { font-size: 22px; line-height: 1.2; color: var(--st-semantic-text-secondary); }
  .repo-label { font-size: 24px; line-height: 1.2; color: var(--st-semantic-text-primary); }
</style>
