<script lang="ts">
  import { Button, IconButton, Modal, Select, Textarea } from "@sentropic/design-system-svelte";
  import { ThumbsUp, ThumbsDown } from "@lucide/svelte";
  import { CLASSEMENT_META, reasonCodesForClass, type ReasonCodeEntry, type SignalClass } from "$lib/signals/signal-classement.js";
  import { reasonEntryLabel } from "$lib/signals/signal-reason-labels.js";
  import type { FeedbackChoice } from "$lib/signals/class-feedback-client.js";

  export let classe: SignalClass;
  export let reasonCodes: ReasonCodeEntry[] = [];
  export let disabled = false;
  export let restoreBlockedReason: string | null = null;
  export let onSubmit: (choice: FeedbackChoice) => Promise<boolean> = async () => false;
  export let onBeginCorrection: () => typeof onSubmit = () => onSubmit;
  let correctionSubmit: typeof onSubmit | null = null;
  let judgedClass: SignalClass = classe;
  let negative = false;
  let nextClass = "";
  let reason = "";
  let comment = "";
  $: choices = (["pertinent", "a_surveiller", "ecarte"] as const).filter((value) => value !== (negative ? judgedClass : classe));
  $: reasons = nextClass ? reasonCodesForClass(reasonCodes, nextClass as SignalClass) : [];
  $: if (!reasons.some((entry) => entry.code === reason)) reason = "";
  async function submit(choice: FeedbackChoice) {
    const send = choice.verdict === "down" ? correctionSubmit ?? onSubmit : onSubmit;
    if (await send(choice)) negative = false;
  }
</script>

<div class="feedback-control"><span class="feedback-actions">
  <IconButton size="sm" variant="ghost" aria-label="Valider l’annotation IA" title="Valider l’annotation IA"
    disabled={disabled || negative} onclick={() => void submit({ verdict: "up" })}><ThumbsUp size={15} /></IconButton>
  <IconButton size="sm" variant="ghost" aria-label="Corriger l’annotation IA" title="Corriger l’annotation IA"
    disabled={disabled || negative} onclick={() => { judgedClass = classe; correctionSubmit = onBeginCorrection(); negative = true; }}><ThumbsDown size={15} /></IconButton>
</span>
{#if negative}
  <Modal open={true} title="Reclassement obligatoire" dismissible={false}>
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
    <Textarea label="Commentaire facultatif" bind:value={comment} maxlength={2000} {disabled} />
    <span>
      <Button size="sm" type="submit" disabled={disabled || !nextClass || !reason}>Reclasser</Button>
      <Button size="sm" variant="secondary" disabled={disabled} onclick={() => { negative = false; nextClass = ""; reason = ""; comment = ""; }}>Annuler</Button>
    </span>
  </form>
  </Modal>
{/if}
</div>

<style>
  .feedback-actions { display: inline-flex; }
  .feedback-control { display: inline-flex; }
  .feedback-form { display: grid; gap: var(--st-spacing-2, 0.5rem); padding: var(--st-spacing-3, 0.75rem); background: var(--st-semantic-surface-raised); color: var(--st-semantic-text-primary); border: 1px solid var(--st-semantic-border-subtle); border-radius: var(--st-radius-md, 0.375rem); }
</style>
