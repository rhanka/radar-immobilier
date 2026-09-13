<script>
  import { Handle, Position } from '@xyflow/svelte';
  import ServiceIcon from './ServiceIcon.svelte';
  let { data } = $props();
  const slots = Array.from({ length: 10 }, (_, i) => ({ i, percent: (i + 1) / 11 * 100 }));
  const sides = [['left', Position.Left], ['right', Position.Right], ['top', Position.Top], ['bottom', Position.Bottom]];
</script>

<div class="architecture-node service-node" data-repo={data.provenance.repos?.join(' + ') ?? 'unassigned'}>
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
    <div><span class="node-kind">{data.kind}</span><strong class="service-name">{data.provenance.service}</strong></div>
  </header>
  <div class="node-description">
    <strong>{data.title}</strong>
    {#if data.function}<span>{data.function}</span>{/if}
    {#if data.detail}<span>{data.detail}</span>{/if}
  </div>
  <footer>
    <strong class="repo-label">{data.provenance.repoLabel}</strong>
    <span class="repo-role">{data.provenance.role}</span>
  </footer>
</div>
<style>
  .service-node { width: 100%; height: 100%; padding: 16px; display: grid; grid-template-rows: auto 1fr auto; gap: 10px; border: 1px solid var(--st-semantic-border-strong); border-left: 4px solid var(--st-semantic-data-category1); background: var(--st-semantic-surface-raised, #fff); color: var(--st-semantic-text-primary); text-align: left; }
  header { display: flex; align-items: center; gap: 13px; }
  header div { min-width: 0; }
  .node-kind { display: block; font-size: 11px; letter-spacing: .06em; color: var(--st-semantic-text-secondary); }
  .service-name { display: block; font-size: 16px; line-height: 1.25; margin-top: 3px; }
  .node-description { display: flex; flex-direction: column; gap: 5px; overflow-wrap: anywhere; font-size: 12px; line-height: 1.35; }
  .node-description strong { font-size: 13px; font-weight: 650; }
  footer { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--st-semantic-border-subtle); padding-top: 9px; line-height: 1.3; }
  .repo-label { font-size: 12px; }
  .repo-role { font-size: 11px; color: var(--st-semantic-text-secondary); }
  :global(.connection-handle) { opacity: 0; pointer-events: none; }
</style>
