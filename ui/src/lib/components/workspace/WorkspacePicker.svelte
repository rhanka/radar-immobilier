<script lang="ts">
  /**
   * 6H app-chrome workspace picker. Shown only when the account belongs to
   * several workspaces: the choice is explicit, never defaulted. Switching
   * changes the live scoped context, which invalidates in-flight reads.
   */
  import { workspaceContext } from "$lib/signals/workspace-client.js";

  $: state = $workspaceContext;
  $: visible = state.workspaces.length > 1;

  function handleChange(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value) workspaceContext.select(value);
  }
</script>

{#if visible}
  <div
    class="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-1 text-sm"
    data-testid="workspace-picker"
  >
    <label for="workspace-picker-select" class="text-slate-600">Espace de travail</label>
    <select
      id="workspace-picker-select"
      class="rounded border border-slate-300 px-2 py-0.5"
      value={state.context.workspaceId ?? ""}
      on:change={handleChange}
    >
      {#if state.context.workspaceId === null}
        <option value="" disabled>Choisir…</option>
      {/if}
      {#each state.workspaces as workspace (workspace.id)}
        <option value={workspace.id}>{workspace.label}</option>
      {/each}
    </select>
  </div>
{/if}
