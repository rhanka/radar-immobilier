<script lang="ts">
  /**
   * SignalClassementMenu — classement icon in a signal card header.
   * Click opens a two-step menu: class first, then the Steve reason code.
   * Icons from @lucide/svelte, colours from DS semantic tokens only.
   */
  import { CircleDashed, Eye, EyeOff, Target } from "@lucide/svelte";
  import {
    CLASSEMENT_META,
    reasonCodesForClass,
    SIGNAL_CLASSES,
    validateClassementChoice,
    type ReasonCodeEntry,
    type SignalClass,
  } from "$lib/signals/signal-classement.js";

  export let classe: SignalClass = "non_classe";
  export let reasonCodes: ReasonCodeEntry[] = [];
  export let disabled = false;
  export let onApply: (nextClass: SignalClass, reasonCode: string | null) => void = () => {};

  let open = false;
  let step: "class" | "reason" = "class";
  let pendingClass: SignalClass | null = null;
  let rootEl: HTMLElement | null = null;
  let popEl: HTMLElement | null = null;
  $: if (disabled && open) open = false;

  function close(): void {
    open = false;
    step = "class";
    pendingClass = null;
  }
  function onWindowClick(event: MouseEvent): void {
    if (!open || !(event.target instanceof Node)) return;
    if (rootEl?.contains(event.target) || popEl?.contains(event.target)) return;
    close();
  }

  function portalPop(node: HTMLElement, _step: string): { update: (next: string) => void; destroy: () => void } {
    popEl = node;
    const target = node.closest<HTMLElement>("[data-st-theme]") ?? document.body;
    target.append(node);

    function position(): void {
      const btn = rootEl?.querySelector("button");
      if (!btn || !popEl) return;
      const rect = btn.getBoundingClientRect();
      const margin = 8;
      const gap = 4;
      popEl.style.position = "fixed";
      popEl.style.zIndex = "1000";
      popEl.style.maxHeight = `${Math.max(window.innerHeight - margin * 2, 160)}px`;
      popEl.style.overflowY = "auto";
      const width = popEl.offsetWidth;
      const height = popEl.offsetHeight;
      let top = rect.bottom + gap;
      if (top + height > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - gap - height);
      }
      const left = Math.min(
        Math.max(margin, rect.right - width),
        window.innerWidth - width - margin,
      );
      popEl.style.top = `${top}px`;
      popEl.style.left = `${left}px`;
    }
    const raf = requestAnimationFrame(position);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return {
      update: () => { requestAnimationFrame(position); },
      destroy: () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("scroll", position, true);
        window.removeEventListener("resize", position);
        if (popEl === node) popEl = null;
        node.remove();
      },
    };
  }
  function onWindowKey(event: KeyboardEvent): void {
    if (open && event.key === "Escape") close();
  }

  const ICONS = { pertinent: Target, a_surveiller: Eye, ecarte: EyeOff, non_classe: CircleDashed } as const;

  $: CurrentIcon = ICONS[classe];
  $: pendingReasons = pendingClass ? reasonCodesForClass(reasonCodes, pendingClass) : [];
  $: reasonOptional = pendingClass === "pertinent" || pendingClass === "a_surveiller";

  function chooseClass(next: SignalClass): void {
    if (next === "non_classe") {
      open = false;
      onApply("non_classe", null);
      return;
    }
    pendingClass = next;
    step = "reason";
  }

  function chooseReason(code: string | null): void {
    if (!pendingClass) return;
    const check = validateClassementChoice(pendingClass, code, reasonCodes);
    if (!check.ok) return;
    const chosen = pendingClass;
    open = false;
    step = "class";
    pendingClass = null;
    onApply(chosen, code);
  }

  function toggle(): void {
    open = !open;
    step = "class";
    pendingClass = null;
  }
</script>

<svelte:window on:click={onWindowClick} on:keydown={onWindowKey} />
<span class="classement-menu" bind:this={rootEl}>
  <button
    type="button"
    class="classement-btn classement-btn--{classe}"
    style="color: {CLASSEMENT_META[classe].token}"
    aria-label="Classement : {CLASSEMENT_META[classe].label}"
    title="Classement : {CLASSEMENT_META[classe].label}"
    data-testid="signal-classement-button"
    {disabled}
    on:click|stopPropagation={toggle}
  >
    <svelte:component this={CurrentIcon} size={15} aria-hidden="true" />
  </button>
  {#if open}
    <span class="classement-pop" role="menu" use:portalPop={step}>
      {#if step === "class"}
        {#each SIGNAL_CLASSES as candidate}
          {@const Icon = ICONS[candidate]}
          <button
            type="button"
            class="classement-choice"
            style="color: {CLASSEMENT_META[candidate].token}"
            data-testid="classement-class-{candidate}"
            on:click|stopPropagation={() => chooseClass(candidate)}
          >
            <svelte:component this={Icon} size={14} aria-hidden="true" />
            <span>{CLASSEMENT_META[candidate].label}</span>
          </button>
        {/each}
      {:else if pendingClass}
        <button
          type="button"
          class="classement-choice"
          data-testid="classement-back"
          on:click|stopPropagation={() => { step = "class"; pendingClass = null; }}
        >
          <span>← Retour</span>
        </button>
        <span class="classement-pop-title">{CLASSEMENT_META[pendingClass].label} — motif</span>
        {#if pendingReasons.length === 0}
          <span class="classement-empty" data-testid="classement-reasons-empty">Motifs indisponibles</span>
        {/if}
        {#each pendingReasons as entry}
          <button
            type="button"
            class="classement-choice"
            data-testid="classement-reason-{entry.code}"
            on:click|stopPropagation={() => chooseReason(entry.code)}
          >
            <span class="classement-reason-code">{entry.code}</span>
            {#if entry.label}<span class="classement-reason-label">{entry.label}</span>{/if}
          </button>
        {/each}
        {#if reasonOptional}
          <button
            type="button"
            class="classement-choice"
            data-testid="classement-reason-none"
            on:click|stopPropagation={() => chooseReason(null)}
          >
            <span>Sans motif</span>
          </button>
        {/if}
      {/if}
    </span>
  {/if}
</span>

<style>
  .classement-menu {
    position: relative;
    display: inline-flex;
  }
  .classement-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    border: none;
    background: transparent;
    cursor: pointer;
  }
  .classement-btn:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .classement-pop {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    min-width: 180px;
    padding: 4px;
    background: var(--st-semantic-surface-default);
    border: 1px solid var(--st-semantic-border-subtle);
    border-radius: var(--st-radius-sm, 4px);
    box-shadow: 0 8px 24px var(--st-semantic-border-subtle);
  }
  .classement-pop-title {
    padding: 4px 8px;
    color: var(--st-semantic-text-secondary);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .classement-choice {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border: none;
    background: transparent;
    color: var(--st-semantic-text-primary);
    text-align: left;
    cursor: pointer;
  }
  .classement-choice:hover {
    background: var(--st-semantic-surface-subtle);
  }
  .classement-empty {
    padding: 4px 8px;
    color: var(--st-semantic-text-secondary);
    font-size: 0.75rem;
  }
  .classement-reason-code {
    font-weight: 600;
    white-space: nowrap;
  }
  .classement-reason-label {
    color: var(--st-semantic-text-secondary);
  }
</style>
