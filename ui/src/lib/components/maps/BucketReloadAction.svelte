<script lang="ts">
  /**
   * BucketReloadAction — reload affordance for a SignauxSelPanel bucket
   * header (Signaux / Règlement et Normes / Zones / Lots).
   *
   * Owner contract: when a section fails to load, its header shows an
   * exclamation trigger at the top right, in place of the counter (« n/d »
   * removed). The trigger is the standard DS `IconButton` (`variant="ghost"`,
   * `size="sm"` — same as the signal classement trigger) and opens a DS menu
   * (`MenuPopover`) with a single « Recharger » action. While the
   * reload runs, a spinning wheel replaces the exclamation. On success the
   * parent renders the counter again; on a new failure this trigger comes
   * back. DS components and DS tokens only.
   */
  import { tick } from "svelte";
  import { IconButton, MenuPopover } from "@sentropic/design-system-svelte";
  import { LoaderCircle, TriangleAlert } from "@lucide/svelte";

  export let error: string | null = null;
  export let loading = false;
  export let onRetry: () => void = () => {};
  /** Unique menu id (aria-controls target), one per bucket. */
  export let menuId: string;
  /** Test-id prefix: `<prefix>-reload-trigger|action|spinner`. */
  export let testId: string;
  /** Accessible name of the DS menu. */
  export let menuLabel: string;

  let menuOpen = false;
  let anchor: HTMLElement | null = null;
  let menuList: HTMLElement | null = null;

  function menuItems(): HTMLButtonElement[] {
    if (!menuList) return [];
    return Array.from(menuList.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  }

  function focusFirstItem(): void {
    menuItems()[0]?.focus();
  }

  function focusTrigger(): void {
    anchor?.querySelector("button")?.focus();
  }

  function openMenu(): void {
    menuOpen = true;
    void tick().then(() => focusFirstItem());
  }

  function closeMenu(restoreFocus = false): void {
    menuOpen = false;
    if (restoreFocus) focusTrigger();
  }

  function toggleMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (menuOpen) closeMenu();
    else openMenu();
  }

  function handleTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (!menuOpen) openMenu();
      else focusFirstItem();
    } else if (event.key === "Escape" && menuOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    }
  }

  function handleMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    const items = menuItems();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(current + 1 + items.length) % items.length].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length].focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1].focus();
    }
  }

  function selectReload(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    onRetry();
    closeMenu(true);
  }
</script>

{#if loading}
  <span
    class="reload-spinner"
    role="status"
    aria-label="Rechargement en cours"
    data-testid="{testId}-reload-spinner"
  >
    <LoaderCircle size={16} aria-hidden="true" />
  </span>
{:else if error}
  <!-- The trigger lives inside a <summary>: every click/keydown stops
       propagation so using it never toggles the bucket open/closed. -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions (Wrapper only stops summary-toggle propagation; the DS button inside owns keyboard interaction.) -->
  <span
    class="reload-anchor"
    bind:this={anchor}
    role="presentation"
    on:click|stopPropagation|preventDefault
  >
    <!-- Standard DS icon button (ghost: transparent, light hover darkening,
         no border) — same component/size as the signal classement trigger. -->
    <IconButton
      aria-label="Rechargement impossible, ouvrir les actions"
      aria-controls={menuId}
      aria-expanded={menuOpen}
      aria-haspopup="menu"
      size="sm"
      variant="ghost"
      data-testid="{testId}-reload-trigger"
      onclick={toggleMenu}
      onkeydown={handleTriggerKeydown}
    >
      <span class="reload-icon">
        <TriangleAlert size={16} aria-hidden="true" />
      </span>
    </IconButton>
  </span>
  <MenuPopover
    id={menuId}
    bind:open={menuOpen}
    trigger={anchor}
    placement="bottom-end"
    label={menuLabel}
    closeOnEscape={false}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions (Keyboard navigation is handled by handleMenuKeydown, mirroring the DS basemap menu in GeoCityMapBase.) -->
    <div
      class="reload-menu"
      role="menu"
      aria-label={menuLabel}
      bind:this={menuList}
      tabindex="-1"
      on:keydown={handleMenuKeydown}
      on:click|stopPropagation
    >
      <button
        type="button"
        class="reload-menu__item"
        role="menuitem"
        data-testid="{testId}-reload-action"
        on:click={selectReload}
      >
        Recharger
      </button>
    </div>
  </MenuPopover>
{/if}

<style>
  .reload-anchor {
    display: inline-flex;
    flex-shrink: 0;
  }

  .reload-icon {
    display: inline-flex;
    color: var(--st-semantic-warning-text);
  }

  .reload-spinner {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--st-semantic-text-muted);
    animation: reload-spin 1s linear infinite;
  }

  @keyframes reload-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .reload-spinner {
      animation: none;
    }
  }

  .reload-menu {
    display: flex;
    flex-direction: column;
    min-width: 9rem;
    padding: 0.25rem;
  }

  .reload-menu__item {
    display: flex;
    align-items: center;
    min-height: 2rem;
    padding: 0.25rem 0.5rem;
    border-radius: var(--st-radius-sm);
    background: transparent;
    color: var(--st-semantic-text-primary);
    font-size: var(--st-font-size-sm, 0.875rem);
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .reload-menu__item:hover,
  .reload-menu__item:focus-visible {
    background: var(--st-semantic-surface-subtle);
  }
</style>
