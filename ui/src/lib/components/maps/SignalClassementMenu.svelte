<script lang="ts">
  /**
   * SignalClassementMenu — classement icon in a signal card header.
   * Click opens a two-step menu: class first, then the Steve reason code.
   * Icons from @lucide/svelte, colours from DS semantic tokens only.
   */
  import { CircleDashed, Eye, EyeOff, Target } from "@lucide/svelte";
  import { Menu, type MenuItem } from "@sentropic/design-system-svelte";
  import {
    CLASSEMENT_META,
    reasonCodesForClass,
    SIGNAL_CLASSES,
    validateClassementChoice,
    type ReasonCodeEntry,
    type SignalClass,
  } from "$lib/signals/signal-classement.js";
  import { reasonEntryLabel } from "$lib/signals/signal-reason-labels.js";

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
    if (!open) return;
    // composedPath() reflects the tree at dispatch time. A click on a
    // class item re-renders the Menu mid-dispatch (reason step), which
    // can detach the clicked node; a live-tree contains() check would
    // then misread that same click as an outside click and close the
    // popover before the reason step is ever seen.
    const path = event.composedPath();
    if (rootEl && path.includes(rootEl)) return;
    if (popEl && path.includes(popEl)) return;
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

  // DS Menu items: neutral DS text (no colour on text); only the trigger
  // icon keeps a DS semantic token colour. Reason rows show the human
  // Steve label (UI dictionary, signal-reason-labels); the technical code
  // stays in the item value (not rendered).
  $: classItems = SIGNAL_CLASSES.map((candidate): MenuItem => ({
    label: CLASSEMENT_META[candidate].label,
    value: candidate,
    icon: ICONS[candidate],
  }));
  $: reasonItems = ([
    { label: "← Retour", value: "__back" },
    ...(pendingClass
      ? [{ kind: "group" as const, label: `${CLASSEMENT_META[pendingClass].label} — motif` }]
      : []),
    ...pendingReasons.map((entry): MenuItem => ({
      label: reasonEntryLabel(entry),
      value: entry.code,
    })),
    ...(reasonOptional ? [{ label: "Sans motif", value: "__none" }] : []),
  ]) as MenuItem[];

  function onMenuSelect(value: string): void {
    if (step === "class") {
      chooseClass(value as SignalClass);
      return;
    }
    if (value === "__back") {
      step = "class";
      pendingClass = null;
      return;
    }
    chooseReason(value === "__none" ? null : value);
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
    <span class="classement-pop" use:portalPop={step}>
      {#if step === "reason" && pendingReasons.length === 0}
        <span class="classement-empty" data-testid="classement-reasons-empty">Motifs indisponibles</span>
      {/if}
      <Menu
        label={step === "class" ? "Classement" : "Motif"}
        items={step === "class" ? classItems : reasonItems}
        open={true}
        dense
        onselect={onMenuSelect}
      />
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
  }
  .classement-empty {
    padding: 4px 8px;
    color: var(--st-semantic-text-secondary);
    font-size: 0.75rem;
  }
</style>
