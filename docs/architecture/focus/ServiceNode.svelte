<script>
  import { Handle, Position } from '@xyflow/svelte';
  import ServiceIcon from './ServiceIcon.svelte';
  let { data } = $props();
  // The icon is exactly as tall as the first two lines: code (22px) and role
  // title (32px), both at line-height 1.3 — 28.6 + 41.6 = 70.2 px.
  const ICON = 70;
  const slots = Array.from({ length: 10 }, (_, i) => ({ i, percent: (i + 1) / 11 * 100 }));
  const sides = [['left', Position.Left], ['right', Position.Right], ['top', Position.Top], ['bottom', Position.Bottom]];
</script>

<!--
  Single card template A' (v10) — 5 text lines: a square icon as tall as the two
  first lines, then code · rôle (≤ 2 segments de ≤ 2 mots) beside it, a short gap,
  nom, un détail métier, un filet, repo. No status line: an exceptional state is
  said in the detail. The code appears once and is never repeated in the name.
-->
<div class="architecture-node service-node" data-node-kind="ordinary" data-id={data.entity.id}
  data-card={data.card} data-parent-id={data.parentId ?? ''} data-evidence-class={data.evidenceClass}
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
    <ServiceIcon kind={data.provenance.icon} size={ICON} />
    <div class="card-head">
      <span class="card-code" data-text-role="code">{data.code}</span>
      <strong class="service-name" data-text-role="service-title">{data.roleTitle}</strong>
    </div>
  </header>
  <span class="card-gap" aria-hidden="true"></span>
  <span class="card-name" data-text-role="name">{data.name}</span>
  <span class="card-detail" data-text-role="detail">{data.detail}</span>
  <span class="card-rule" aria-hidden="true"></span>
  <strong class="repo-label" data-text-role="repo">{data.provenance.repoLabel}</strong>
</div>
<style>
  .service-node { width: 100%; height: 100%; padding: 8px; display: flex; flex-direction: column; overflow: hidden; border: 2px solid var(--st-semantic-border-strong); border-left: 8px solid var(--st-semantic-data-category1); background: var(--st-semantic-surface-raised, #fff); color: var(--st-semantic-text-primary); text-align: left; }
  header { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 0 0 auto; }
  .card-head { display: flex; flex-direction: column; justify-content: center; min-width: 0; flex: 1 1 auto; }
  .card-code, .card-name, .card-detail, .repo-label, .service-name { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-code { font-size: 22px; line-height: 1.3; color: var(--st-semantic-text-secondary); letter-spacing: .04em; }
  .service-name { font-size: 32px; line-height: 1.3; }
  .card-gap { display: block; height: 6px; flex: 0 0 6px; }
  .card-name, .card-detail { font-size: 24px; line-height: 1.3; }
  .card-detail { color: var(--st-semantic-text-secondary); }
  .card-rule { display: block; height: 1px; flex: 0 0 1px; margin: 4px 0; background: var(--st-semantic-border-subtle, #bdcad0); }
  .repo-label { font-size: 24px; line-height: 1.3; }
  :global(.connection-handle) { opacity: 0; pointer-events: none; }
</style>
