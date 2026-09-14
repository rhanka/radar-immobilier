<script>
  import { Handle, Position } from '@xyflow/svelte';
  import ServiceIcon from './ServiceIcon.svelte';
  let { data } = $props();
  const slots = Array.from({ length: 10 }, (_, i) => ({ i, percent: (i + 1) / 11 * 100 }));
  const sides = [['left', Position.Left], ['right', Position.Right], ['top', Position.Top], ['bottom', Position.Bottom]];
</script>

<div class="architecture-node service-node" data-node-kind="ordinary" data-id={data.entity.id}
  data-parent-id={data.parentId ?? ''} data-evidence-class={data.evidenceClass}
  data-runtime-state={data.runtimeState} data-repo={data.provenance.repo.join(' + ')}
  data-kind={data.kind} data-label={data.label} title={data.label}>
  <!-- Preserve the Focus router's exact side/slot handle contract. -->
  {#each ['target', 'source'] as type}
    {#each sides as [side, position]}
      {#each slots as slot}
        <Handle id={`${type}-${side}-${slot.i}`} {type} {position} class="connection-handle" style={`${side === 'left' || side === 'right' ? 'top' : 'left'}:${slot.percent}%`} />
      {/each}
    {/each}
  {/each}
  <header>
    <ServiceIcon kind={data.provenance.icon} />
    <strong class="service-name" data-text-role="service-title">{data.title}</strong>
  </header>
  <span class="node-status" data-text-role="status">{data.statusLabel} · {data.provenance.role}</span>
  <strong class="repo-label" data-text-role="repo">{data.provenance.repoLabel}</strong>
</div>
<style>
  .service-node { width: 100%; height: 100%; padding: 8px; display: flex; flex-direction: column; gap: 4px; overflow: hidden; border: 2px solid var(--st-semantic-border-strong); border-left: 8px solid var(--st-semantic-data-category1); background: var(--st-semantic-surface-raised, #fff); color: var(--st-semantic-text-primary); text-align: left; }
  header { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .service-name { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 32px; line-height: 1.4; }
  .node-status, .repo-label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.4; }
  .node-status { font-size: 22px; color: var(--st-semantic-text-secondary); }
  .repo-label { font-size: 24px; }
  :global(.connection-handle) { opacity: 0; pointer-events: none; }
</style>
