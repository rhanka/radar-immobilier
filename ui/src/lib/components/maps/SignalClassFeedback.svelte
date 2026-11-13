<script lang="ts">
  import { Button, IconButton, Select } from "@sentropic/design-system-svelte";
  import { ThumbsUp, ThumbsDown } from "@lucide/svelte";
  import { CLASSEMENT_META, reasonCodesForClass, type ReasonCodeEntry, type SignalClass } from "$lib/signals/signal-classement.js";
  import { reasonEntryLabel } from "$lib/signals/signal-reason-labels.js";
  import type { FeedbackChoice } from "$lib/signals/class-feedback-client.js";

  export let classe: SignalClass;
  export let reasonCodes: ReasonCodeEntry[] = [];
  export let disabled = false;
  export let restoreBlockedReason: string | null = null;
  export let onSubmit: (choice: FeedbackChoice) => Promise<boolean> = async () => false;
  let negative = false;
  let nextClass = "";
  let reason = "";
  let comment = "";
  $: choices = (["pertinent", "a_surveiller", "ecarte"] as const).filter((value) => value !== classe);
  $: reasons = nextClass ? reasonCodesForClass(reasonCodes, nextClass as SignalClass) : [];
  $: if (!reasons.some((entry) => entry.code === reason)) reason = "";
  async function submit(choice: FeedbackChoice) {
    if (await onSubmit(choice)) negative = false;
  }
</script>

<span class="feedback-actions">
  <IconButton size="sm" variant="ghost" aria-label="Valider l’annotation IA" title="Valider l’annotation IA"
    {disabled} onclick={() => void submit({ verdict: "up" })}><ThumbsUp size={15} /></IconButton>
  <IconButton size="sm" variant="ghost" aria-label="Corriger l’annotation IA" title="Corriger l’annotation IA"
    {disabled} onclick={() => { negative = true; }}><ThumbsDown size={15} /></IconButton>
</span>
{#if negative}
  <form class="feedback-form" aria-label="Reclassement obligatoire" on:submit|preventDefault={() => {
    if (nextClass && reason) void submit({ verdict: "down", nextClass: nextClass as SignalClass, reasonCode: reason, ...(comment ? { comment } : {}) });
  }}>
    <p>Choisissez une autre classe et un motif.</p>
    <Select label="Nouvelle classe" size="sm" bind:value={nextClass} disabled={disabled}>
      <option value="" disabled>Choisir une classe</option>
      {#each choices as value}<option value={value} disabled={!!restoreBlockedReason && value !== "ecarte"}>{CLASSEMENT_META[value].label}</option>{/each}
    </Select>
    <Select label="Motif du reclassement" size="sm" bind:value={reason} disabled={disabled || !nextClass}>
      <option value="" disabled>Choisir un motif</option>
      {#each reasons as entry}<option value={entry.code}>{reasonEntryLabel(entry)}</option>{/each}
    </Select>
    <label>Commentaire facultatif<textarea bind:value={comment} maxlength={2000} disabled={disabled}></textarea></label>
    <span>
      <Button size="sm" type="submit" disabled={disabled || !nextClass || !reason}>Reclasser</Button>
      <Button size="sm" variant="secondary" disabled={disabled} onclick={() => { negative = false; nextClass = ""; reason = ""; comment = ""; }}>Annuler</Button>
    </span>
  </form>
{/if}

<style>
  .feedback-actions { display: inline-flex; }
  .feedback-form { display: grid; gap: var(--st-spacing-2, 0.5rem); padding: var(--st-spacing-3, 0.75rem); background: var(--st-semantic-surface-raised); color: var(--st-semantic-text-primary); border: 1px solid var(--st-semantic-border-subtle); border-radius: var(--st-radius-md, 0.375rem); }
  .feedback-form label { display: grid; }
  textarea { color: var(--st-semantic-text-primary); background: var(--st-semantic-surface-raised); border: 1px solid var(--st-semantic-border-subtle); }
</style>
