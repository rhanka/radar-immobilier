<script lang="ts">
  import { appendSignalNote, mcpBadge, type SignalAnnotations } from "$lib/signals/signal-mcp-client.js";
  export let annotations: SignalAnnotations;
  export let workspaceId: string;
  export let target: { citySlug: string; type: string; id: string };
  export let onAdded: () => void = () => {};
  let text = "";
  let saving = false;
  let error = "";
  async function submit() {
    if (saving || !text.trim() || text.length > 2000) return;
    saving = true;
    error = "";
    try {
      annotations = await appendSignalNote(workspaceId, target, text, annotations.version);
      text = "";
      onAdded();
    } catch (cause) { error = cause instanceof Error ? cause.message : "Échec de l’enregistrement."; }
    finally { saving = false; }
  }
</script>

<section aria-label="Notes du signal" class="signal-notes">
  {#each annotations.notes as note (note.id)}
    <p><small>{note.source === "mcp" ? mcpBadge(note) : "Note utilisateur"}</small><br />{note.text}</p>
  {/each}
  <form aria-label="Ajouter une note" on:submit|preventDefault={submit}>
    <label>Note libre<textarea bind:value={text} maxlength="2000" rows="2" disabled={saving}></textarea></label>
    <button type="submit" disabled={saving || !text.trim()}>Ajouter la note</button>
    {#if error}<p role="alert">{error}</p>{/if}
  </form>
</section>

<style>
  .signal-notes { display: grid; gap: var(--st-spacing-2, .5rem); padding: var(--st-spacing-2, .5rem); }
  p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  small { color: var(--st-semantic-text-muted); }
  form, label { display: grid; gap: var(--st-spacing-1, .25rem); }
  textarea { color: inherit; background: var(--st-semantic-surface-default); border: 1px solid var(--st-semantic-border-default); border-radius: var(--st-radius-sm, .25rem); }
  button { justify-self: start; }
</style>
