<script lang="ts">
  import type { mountUiStateSync } from "$lib/sync/svelte-adapters.js";
  import type { UiContext } from "$lib/sync/ui-state-contract.js";
  export let sync: ReturnType<typeof mountUiStateSync>;
  const peers = sync.peers;
  let error = "";
  let adopting = false;
  async function resume(context: UiContext) {
    adopting = true; error = "";
    if (!await sync.adopt(context)) error = "Ce contexte a expiré ou son accès a changé.";
    adopting = false;
  }
</script>

{#if $peers.length}
  <details class="border-b border-slate-200 bg-white px-4 py-2 text-sm">
    <summary>Reprendre un contexte ({$peers.length})</summary>
    <p>La reprise remplace la navigation de cet onglet.</p>
    {#each $peers as context (context.tabId + context.workspaceId)}
      <div class="flex items-center gap-2 py-1">
        <span>{context.payload.target.kind === "page" ? context.payload.target.view
          : context.payload.target.route.level === "region" ? "Québec" : context.payload.target.route.citySlug}</span>
        {#if context.payload.partial}<span>Contexte partiel : recherches et éléments exclus non repris.</span>{/if}
        <button type="button" disabled={adopting} class="rounded border px-2 py-1"
          on:click={() => resume(context)}>Reprendre ce contexte</button>
      </div>
    {/each}
    {#if error}<p role="alert">{error}</p>{/if}
  </details>
{/if}
