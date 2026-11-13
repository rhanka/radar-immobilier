<script lang="ts">
  /**
   * SignalClassementMenu — classement icon in a signal card header.
   * Cascade: class menu stays open, reason sub-menu opens beside it.
   * DS has no nested menu (MenuItem is flat item|divider|group), so
   * this composes two DS Menus. Icons from @lucide/svelte, colours
   * from DS semantic tokens only.
   */
  import { tick } from "svelte";
  import { CircleDashed, Eye, EyeOff, Target } from "@lucide/svelte";
  import { IconButton, Menu, type MenuItem } from "@sentropic/design-system-svelte";
  import {
    CLASSEMENT_META,
    reasonCodesForClass,
    SIGNAL_CLASSES,
    validateClassementChoice,
    type ReasonCodeEntry,
    type SignalClass,
  } from "$lib/signals/signal-classement.js";
  import { reasonEntryLabel } from "$lib/signals/signal-reason-labels.js";
  import { nextPanelMenuId, openPanelMenuId } from "$lib/components/maps/panel-menu.js";

  export let classe: SignalClass = "non_classe";
  export let reasonCodes: ReasonCodeEntry[] = [];
  export let disabled = false;
  export let restoreBlockedReason: string | null = null;
  export let onApply: (nextClass: SignalClass, reasonCode: string | null) => void = () => {};

  let open = false;
  let pendingClass: SignalClass | null = null;
  let subSide: "left" | "right" = "left";
  let drillDown = false;
  let backEl: HTMLButtonElement | null = null;
  let lastClassWidth = 192;
  let rootEl: HTMLElement | null = null;
  let popEl: HTMLElement | null = null;
  let classWrapEl: HTMLElement | null = null;
  let reasonWrapEl: HTMLElement | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  const panelMenuId = nextPanelMenuId("classement");
  $: if (disabled && open) closeAll(false);
  $: if (open && $openPanelMenuId !== null && $openPanelMenuId !== panelMenuId) closeAll(false);

  const SUBMENU_CLASSES: readonly SignalClass[] = ["pertinent", "a_surveiller", "ecarte"];

  function triggerButton(): HTMLButtonElement | null {
    return rootEl?.querySelector("button") ?? null;
  }
  function cancelHover(): void {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  }
  function closeAll(returnFocus = true): void {
    cancelHover();
    open = false;
    pendingClass = null;
    drillDown = false;
    openPanelMenuId.update((v) => (v === panelMenuId ? null : v));
    if (returnFocus) triggerButton()?.focus();
  }
  function closeSub(): void {
    cancelHover();
    const last = pendingClass;
    pendingClass = null;
    drillDown = false;
    void tick().then(() => {
      layout();
      if (last) focusClassItem(last);
    });
  }
  function classMenuEl(): HTMLElement | null {
    return (popEl?.querySelector(".cascade-class .st-menu") as HTMLElement | null) ?? null;
  }
  function reasonMenuEl(): HTMLElement | null {
    return (popEl?.querySelector(".cascade-reason .st-menu") as HTMLElement | null) ?? null;
  }
  function focusClassItem(target: SignalClass): void {
    const menu = classMenuEl();
    const idx = SIGNAL_CLASSES.indexOf(target);
    const btn = menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[idx];
    btn?.focus();
  }
  async function openSub(next: SignalClass, moveFocus = false): Promise<void> {
    if (restoreBlockedReason && next !== "ecarte") return;
    cancelHover();
    pendingClass = next;
    await tick();
    layout();
    await tick();
    layout();
    if (drillDown) {
      backEl?.focus();
    } else if (moveFocus) {
      const first = reasonMenuEl()?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
      first?.focus();
    }
  }

  function onWindowClick(event: MouseEvent): void {
    if (!open) return;
    // composedPath() reflects the tree at dispatch time. A click on a
    // class item re-renders mid-dispatch, which can detach the clicked
    // node; a live-tree contains() check would then misread that same
    // click as an outside click and close before the sub-menu is seen.
    const path = event.composedPath();
    if (rootEl && path.includes(rootEl)) return;
    if (popEl && path.includes(popEl)) return;
    closeAll(false);
  }

  function layout(): void {
    const btn = triggerButton();
    if (!btn || !popEl) return;
    const rect = btn.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const minHeight = 160;
    popEl.style.position = "fixed";
    popEl.style.zIndex = "1000";
    popEl.style.right = "auto";
    popEl.style.overflow = "visible";
    const classMenu = classMenuEl();
    if (classMenu?.offsetWidth) lastClassWidth = classMenu.offsetWidth;
    const classWidth = classMenu?.offsetWidth || lastClassWidth;
    const classHeight = classMenu?.offsetHeight || 160;
    const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const openAbove = spaceBelow < classHeight && spaceAbove > spaceBelow;
    const classMax = Math.min(Math.max(openAbove ? spaceAbove : spaceBelow, minHeight), Math.max(window.innerHeight - margin * 2, minHeight));
    classMenu?.style.setProperty("--st-menu-maxHeight", `${classMax}px`);
    popEl.style.setProperty("--st-menu-maxHeight", `${classMax}px`);
    popEl.style.maxHeight = `${window.innerHeight - margin * 2}px`;
    let top = openAbove ? rect.top - gap - classHeight : rect.bottom + gap;
    top = Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - margin - classHeight));
    const left = Math.min(Math.max(margin, rect.right - classWidth), Math.max(margin, window.innerWidth - classWidth - margin));
    popEl.style.top = `${top}px`;
    popEl.style.left = `${left}px`;
    popEl.style.width = `${classWidth}px`;
    popEl.dataset.side = subSide;
    decorate();
    const reasonMenu = reasonMenuEl();
    if (!pendingClass && drillDown) drillDown = false;
    if (reasonMenu && pendingClass && reasonWrapEl) {
      const reasonWidth = reasonMenu.offsetWidth || 192;
      const measured = (classMenu?.offsetWidth ?? 0) > 0 || rect.width > 0 || (drillDown && lastClassWidth > 0 && rect.width > 0);
      // Geometric threshold (Option A): drill-down when the space left of
      // the class menu cannot hold the reason menu width.
      const shouldDrill = measured && left - reasonWidth - gap < margin;
      if (shouldDrill !== drillDown) drillDown = shouldDrill;
      popEl.dataset.mode = drillDown ? "drill" : "cascade";
      reasonWrapEl.dataset.mode = drillDown ? "drill" : "cascade";
      if (drillDown) {
        subSide = "left";
        popEl.dataset.side = subSide;
        reasonWrapEl.dataset.side = subSide;
        const drillWidth = Math.min(reasonWidth, Math.max(window.innerWidth - margin * 2, 0));
        const drillLeft = Math.min(Math.max(margin, rect.right - drillWidth), Math.max(margin, window.innerWidth - drillWidth - margin));
        popEl.style.left = `${drillLeft}px`;
        popEl.style.width = `${drillWidth}px`;
        reasonMenu.style.setProperty("--st-menu-maxHeight", `${classMax}px`);
        reasonWrapEl.style.top = "0px";
        reasonWrapEl.style.left = "0px";
        reasonWrapEl.style.width = `${drillWidth}px`;
        return;
      }
      if (!classMenu) return;
      subSide = "left";
      popEl.dataset.side = subSide;
      reasonWrapEl.dataset.side = subSide;
      const reasonMax = Math.max(window.innerHeight - margin * 2, minHeight);
      reasonMenu.style.setProperty("--st-menu-maxHeight", `${reasonMax}px`);
      const classRect = (classMenu as HTMLElement).getBoundingClientRect();
      const buttons = classMenu?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      const selIdx = SIGNAL_CLASSES.indexOf(pendingClass);
      const selBtn = buttons?.[selIdx];
      const selRect = selBtn?.getBoundingClientRect();
      let subTop = selRect ? selRect.top - classRect.top : 0;
      const reasonHeight = Math.min(reasonMenu.offsetHeight || 160, reasonMax);
      const absoluteTop = top + subTop;
      if (absoluteTop + reasonHeight > window.innerHeight - margin) {
        subTop -= absoluteTop + reasonHeight - (window.innerHeight - margin);
      }
      if (top + subTop < margin) subTop = margin - top;
      reasonWrapEl.style.top = `${subTop}px`;
      reasonWrapEl.style.left = subSide === "left" ? `${-(reasonWidth + gap)}px` : `${classWidth + gap}px`;
      reasonWrapEl.style.width = `${reasonWidth}px`;
      decorate();
    }
  }

  function portalPop(node: HTMLElement, _dep: string): { update: (next: string) => void; destroy: () => void } {
    popEl = node;
    const target = node.closest<HTMLElement>("[data-st-theme]") ?? document.body;
    target.append(node);
    const raf = requestAnimationFrame(() => layout());
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => layout()) : null;
    observer?.observe(node);
    window.addEventListener("scroll", layout, true);
    window.addEventListener("resize", layout);
    return {
      update: () => { requestAnimationFrame(() => layout()); },
      destroy: () => {
        cancelAnimationFrame(raf);
        observer?.disconnect();
        window.removeEventListener("scroll", layout, true);
        window.removeEventListener("resize", layout);
        if (popEl === node) popEl = null;
        node.remove();
      },
    };
  }

  function decorate(): void {
    const menu = classMenuEl();
    if (!menu) return;
    const buttons = menu.querySelectorAll<HTMLElement>('[role="menuitem"]');
    buttons.forEach((btn, idx) => {
      const candidate = SIGNAL_CLASSES[idx];
      if (!candidate) return;
      btn.setAttribute("data-class", candidate);
      const selected = candidate === pendingClass;
      btn.classList.toggle("classement-item--selected", selected);
      if (selected) btn.setAttribute("aria-haspopup", "menu");
      else btn.removeAttribute("aria-haspopup");
      let chevron = btn.querySelector<HTMLElement>(".classement-chevron");
      if (!chevron) {
        chevron = document.createElement("span");
        chevron.className = "classement-chevron";
        chevron.setAttribute("aria-hidden", "true");
        btn.prepend(chevron);
      }
      chevron.textContent = selected && SUBMENU_CLASSES.includes(candidate) ? (subSide === "left" ? "‹" : "›") : "";
    });
  }

  function onWindowKey(event: KeyboardEvent): void {
    if (!open || event.key !== "Escape") return;
    if (pendingClass) { event.preventDefault(); closeSub(); }
    else closeAll(true);
  }

  const ICONS = { pertinent: Target, a_surveiller: Eye, ecarte: EyeOff, non_classe: CircleDashed } as const;

  $: CurrentIcon = ICONS[classe];
  $: pendingReasons = pendingClass ? reasonCodesForClass(reasonCodes, pendingClass) : [];
  $: reasonOptional = pendingClass === "pertinent" || pendingClass === "a_surveiller";

  function chooseClass(next: SignalClass): void {
    if (restoreBlockedReason && next !== "ecarte") return;
    if (next === "non_classe") {
      cancelHover();
      open = false;
      pendingClass = null;
      drillDown = false;
      openPanelMenuId.update((v) => (v === panelMenuId ? null : v));
      onApply("non_classe", null);
      triggerButton()?.focus();
      return;
    }
    void openSub(next, false);
  }

  function chooseReason(code: string | null): void {
    if (!pendingClass) return;
    const check = validateClassementChoice(pendingClass, code, reasonCodes);
    if (!check.ok) return;
    const chosen = pendingClass;
    cancelHover();
    open = false;
    pendingClass = null;
    drillDown = false;
    openPanelMenuId.update((v) => (v === panelMenuId ? null : v));
    onApply(chosen, code);
    triggerButton()?.focus();
  }

  async function toggle(): Promise<void> {
    if (open) { closeAll(false); return; }
    openPanelMenuId.set(panelMenuId);
    open = true;
    pendingClass = null;
    drillDown = false;
    await tick();
    layout();
    classMenuEl()?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }

  $: classItems = SIGNAL_CLASSES.map((candidate): MenuItem => ({
    label: CLASSEMENT_META[candidate].label,
    value: candidate,
    icon: ICONS[candidate],
    disabled: Boolean(restoreBlockedReason && candidate !== "ecarte"),
  }));
  $: reasonItems = ([
    ...(pendingClass
      ? [{ kind: "group" as const, label: `${CLASSEMENT_META[pendingClass].label} — motif` }]
      : []),
    ...(reasonOptional ? [{ label: "Sans motif", value: "__none" }] : []),
    ...pendingReasons.map((entry): MenuItem => ({
      label: reasonEntryLabel(entry),
      value: entry.code,
    })),
  ]) as MenuItem[];

  function onClassSelect(value: string): void {
    chooseClass(value as SignalClass);
  }
  function onReasonSelect(value: string): void {
    chooseReason(value === "__none" ? null : value);
  }

  function classFromEventTarget(target: EventTarget | null): SignalClass | null {
    const el = target as HTMLElement | null;
    const item = el?.closest?.('[role="menuitem"]') as HTMLElement | null;
    if (!item || !classWrapEl?.contains(item)) return null;
    const value = item.getAttribute("data-class");
    if (value && (SIGNAL_CLASSES as readonly string[]).includes(value)) return value as SignalClass;
    const menu = classMenuEl();
    if (!menu) return null;
    const idx = [...menu.querySelectorAll('[role="menuitem"]')].indexOf(item);
    return SIGNAL_CLASSES[idx] ?? null;
  }

  function onClassHover(event: MouseEvent): void {
    const candidate = classFromEventTarget(event.target);
    if (!candidate || !SUBMENU_CLASSES.includes(candidate)) { cancelHover(); return; }
    if (candidate === pendingClass) { cancelHover(); return; }
    cancelHover();
    hoverTimer = setTimeout(() => { void openSub(candidate, false); }, 150);
  }

  function onCascadeKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const inReason = Boolean(reasonWrapEl && target && reasonWrapEl.contains(target));
    const openKey = subSide === "left" ? "ArrowLeft" : "ArrowRight";
    const closeKey = subSide === "left" ? "ArrowRight" : "ArrowLeft";
    if (!inReason) {
      if (event.key === openKey) {
        const candidate = classFromEventTarget(event.target);
        if (candidate && SUBMENU_CLASSES.includes(candidate)) {
          event.preventDefault();
          event.stopPropagation();
          void openSub(candidate, true);
        }
      }
      return;
    }
    if (drillDown && target === backEl && event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      reasonMenuEl()?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
      return;
    }
    if (event.key === closeKey) {
      event.preventDefault();
      event.stopPropagation();
      closeSub();
    }
  }
</script>

<svelte:window on:click={onWindowClick} on:keydown={onWindowKey} />
<span class="classement-menu" bind:this={rootEl}>
  <IconButton
    size="sm"
    variant="ghost"
    style="color: {CLASSEMENT_META[classe].token}"
    aria-label="Classement : {CLASSEMENT_META[classe].label}"
    aria-haspopup="menu"
    aria-expanded={open}
    title="Classement : {CLASSEMENT_META[classe].label}"
    data-testid="signal-classement-button"
    {disabled}
    onclick={(event: MouseEvent) => { event.stopPropagation(); void toggle(); }}
  >
    <svelte:component this={CurrentIcon} size={15} aria-hidden="true" />
  </IconButton>
  {#if open}
    <span class="classement-pop" data-testid="classement-pop" data-side={subSide} data-mode={drillDown && pendingClass ? "drill" : "cascade"} use:portalPop={pendingClass ?? "class"}>
      <span class="cascade" role="presentation" on:keydown={onCascadeKeydown}>
        {#if restoreBlockedReason}
          <span class="classement-empty" role="status">{restoreBlockedReason}</span>
        {/if}
        {#if !(drillDown && pendingClass)}
          <span class="cascade-class" data-testid="classement-class-menu" bind:this={classWrapEl} role="presentation" on:mouseover={onClassHover}>
            <Menu label="Classement" items={classItems} open={true} dense onselect={onClassSelect} />
          </span>
        {/if}
        {#if pendingClass}
          <span class="cascade-reason" class:cascade-reason--drill={drillDown} data-testid="classement-reason-menu" data-side={subSide} data-mode={drillDown ? "drill" : "cascade"} bind:this={reasonWrapEl}>
            {#if drillDown}
              <button type="button" class="drill-back" data-testid="classement-reason-back" bind:this={backEl} on:click={(event: MouseEvent) => { event.stopPropagation(); closeSub(); }}>
                <span aria-hidden="true">‹</span><span>{CLASSEMENT_META[pendingClass].label}</span>
              </button>
            {/if}
            {#if pendingReasons.length === 0}
              <span class="classement-empty" data-testid="classement-reasons-empty">Motifs indisponibles</span>
            {/if}
            <Menu label="Motif" items={reasonItems} open={true} dense onselect={onReasonSelect} />
          </span>
        {/if}
      </span>
    </span>
  {/if}
</span>

<style>
  .classement-menu { position: relative; display: inline-flex; }
  .classement-pop { position: absolute; top: calc(100% + 4px); right: 0; z-index: 30; display: block; border-radius: var(--st-component-popover-radius, var(--st-radius-lg, 0.5rem)); box-shadow: var(--st-component-popover-shadow, var(--st-shadow-floating)); }
  .cascade { position: relative; display: block; }
  .cascade-class { display: block; }
  .cascade-class :global(.st-menu) { box-shadow: var(--st-component-popover-shadow, var(--st-shadow-floating)); }
  .cascade-reason { position: absolute; display: block; }
  .cascade-reason--drill { position: relative; background: var(--st-semantic-surface-raised); border-radius: var(--st-component-popover-radius, var(--st-radius-lg, 0.5rem)); }
  .cascade-reason :global(.st-menu) { box-shadow: var(--st-component-popover-shadow, var(--st-shadow-floating)); }
  .drill-back { display: flex; align-items: center; gap: var(--st-spacing-2, 0.5rem); width: 100%; box-sizing: border-box; border: 0; border-bottom: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-raised); color: var(--st-semantic-text-primary); font: inherit; font-weight: 600; text-align: left; padding: var(--st-spacing-2, 0.5rem) var(--st-spacing-3, 0.75rem); cursor: pointer; border-radius: var(--st-component-popover-radius, var(--st-radius-lg, 0.5rem)) var(--st-component-popover-radius, var(--st-radius-lg, 0.5rem)) 0 0; }
  .drill-back:hover { background: var(--st-semantic-surface-hover); }
  .drill-back:focus-visible { outline: 2px solid var(--st-semantic-action-primary); outline-offset: -2px; }
  :global(.classement-item--selected) { background: var(--st-component-selectableRow-selectedBackground, var(--st-semantic-surface-subtle)); color: var(--st-component-selectableRow-selectedText, var(--st-semantic-text-primary)); font-weight: 600; }
  :global(.classement-chevron) { display: inline-flex; align-items: center; justify-content: center; width: 1rem; min-width: 1rem; font-size: 1rem; line-height: 1; color: var(--st-semantic-text-secondary); flex: 0 0 1rem; }
  :global(.st-menu [data-class] svg) { color: var(--st-component-iconButton-text, var(--st-semantic-text-primary)); }
  .classement-empty { display: block; padding: 4px 8px; color: var(--st-semantic-text-secondary); font-size: 0.75rem; background: var(--st-semantic-surface-raised); }
</style>
