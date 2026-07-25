<script lang="ts">
  import { onMount } from "svelte";
  import { Drawer } from "@sentropic/design-system-svelte";
  import { PanelLeft, PanelRight } from "@lucide/svelte";

  export let controlsWidth: string = "w-72";
  export let fullWidth: boolean = false;
  export let stickyControlsFooter: boolean = false;
  export let selWidth: string = "w-80";
  export let controlsDrawerTitle: string = "Filtres";
  export let selDrawerTitle: string = "Selection";

  let isCompact = false;
  let leftDrawerOpen = false;
  let rightDrawerOpen = false;

  onMount(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(max-width: 899px)");
    isCompact = mql.matches;
    const handler = (e: MediaQueryListEvent) => {
      isCompact = e.matches;
      if (!e.matches) {
        leftDrawerOpen = false;
        rightDrawerOpen = false;
      }
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  });
</script>

{#if fullWidth}
  <div class="flex min-h-0 flex-1 overflow-auto">
    <slot />
  </div>
{:else}
  <div class="flex min-h-0 flex-1 overflow-auto">
    {#if $$slots.controls}
      <div class="flex h-full w-full">
        {#if isCompact}
          <div class="relative flex min-h-0 flex-1 flex-col">
            <div class="flex-1 overflow-auto min-h-0">
              <slot />
            </div>
            <button
              type="button"
              class="absolute left-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-slate-50"
              onclick={() => (leftDrawerOpen = true)}
              aria-label={controlsDrawerTitle}
            >
              <PanelLeft size={18} aria-hidden="true" />
            </button>
            {#if $$slots.sel}
              <button
                type="button"
                class="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-slate-50"
                onclick={() => (rightDrawerOpen = true)}
                aria-label={selDrawerTitle}
              >
                <PanelRight size={18} aria-hidden="true" />
              </button>
            {/if}
          </div>

          <Drawer
            open={leftDrawerOpen}
            side="left"
            title={controlsDrawerTitle}
            closeLabel="Fermer"
            onclose={() => (leftDrawerOpen = false)}
          >
            {#snippet children()}
              <slot name="controls" />
              {#if stickyControlsFooter && $$slots['controls-footer']}
                <div class="border-t border-slate-100 mt-4 pt-2">
                  <slot name="controls-footer" />
                </div>
              {/if}
            {/snippet}
          </Drawer>

          {#if $$slots.sel}
            <Drawer
              open={rightDrawerOpen}
              side="right"
              title={selDrawerTitle}
              closeLabel="Fermer"
              onclose={() => (rightDrawerOpen = false)}
            >
              {#snippet children()}
                <slot name="sel" />
              {/snippet}
            </Drawer>
          {/if}
        {:else}
          {#if stickyControlsFooter}
            <aside class={`${controlsWidth} shrink-0 border-r border-slate-200 bg-white flex flex-col min-h-0`}>
              <div class="flex-1 overflow-y-auto">
                <slot name="controls" />
              </div>
              {#if $$slots['controls-footer']}
                <div class="shrink-0 border-t border-slate-100">
                  <slot name="controls-footer" />
                </div>
              {/if}
            </aside>
          {:else}
            <aside class={`${controlsWidth} shrink-0 border-r border-slate-200 bg-white overflow-y-auto`}>
              <slot name="controls" />
            </aside>
          {/if}
          <div class="flex min-h-0 flex-1 overflow-auto">
            <div class="flex-1 overflow-auto min-h-0">
              <slot />
            </div>
            {#if $$slots.sel}
              <aside class={`${selWidth} shrink-0 border-l border-slate-200 bg-white flex flex-col min-h-0`}>
                <slot name="sel" />
              </aside>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <div class="mx-auto w-full max-w-screen-2xl px-6 py-4">
        <slot />
      </div>
    {/if}
  </div>
{/if}
