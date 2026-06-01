<script lang="ts">
  import { onMount } from "svelte";
  import { MessageCircle, X, PanelRight, PanelBottom } from "@lucide/svelte";
  import PackageChatWidget from "@sentropic/chat-ui/components/ChatWidget.svelte";
  import RadarChatPanel from "$lib/components/RadarChatPanel.svelte";
  import {
    chatWidgetLayout,
    computeDockWidthCss,
    persistDisplayMode,
    readDisplayMode,
    type ChatWidgetDisplayMode,
  } from "$lib/chat/chat-widget-layout";

  // Docked by default per the ÉV9 intent.
  let displayMode: ChatWidgetDisplayMode = "docked";
  let isOpen = false;
  let dockWidthCss = "0px";
  let mounted = false;

  $: isDocked = displayMode === "docked";

  /** Publish the canonical layout store so the rest of the app can react. */
  const publishLayout = (): void => {
    chatWidgetLayout.set({
      mode: displayMode,
      isOpen,
      dockWidthCss: isDocked && isOpen ? dockWidthCss : "0px",
    });
  };

  const setDisplayMode = (next: ChatWidgetDisplayMode): void => {
    displayMode = next;
    persistDisplayMode(next);
    publishLayout();
  };

  const toggleOpen = (): void => {
    isOpen = !isOpen;
    publishLayout();
  };

  const close = (): void => {
    isOpen = false;
    publishLayout();
  };

  const onResize = (): void => {
    dockWidthCss = computeDockWidthCss();
    publishLayout();
  };

  onMount(() => {
    displayMode = readDisplayMode();
    dockWidthCss = computeDockWidthCss();
    mounted = true;
    publishLayout();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });
</script>

{#snippet renderChatPanel()}
  <RadarChatPanel />
{/snippet}

{#snippet header()}
  <div class="flex items-center gap-1">
    <button
      class="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      type="button"
      title={isDocked ? "Passer en fenetre flottante" : "Ancrer le chat"}
      aria-label={isDocked ? "Passer en fenetre flottante" : "Ancrer le chat"}
      on:click={() => setDisplayMode(isDocked ? "floating" : "docked")}
    >
      {#if isDocked}
        <PanelBottom class="h-4 w-4" aria-hidden="true" />
      {:else}
        <PanelRight class="h-4 w-4" aria-hidden="true" />
      {/if}
    </button>
    <button
      class="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      type="button"
      title="Fermer le chat"
      aria-label="Fermer le chat"
      on:click={close}
    >
      <X class="h-4 w-4" aria-hidden="true" />
    </button>
  </div>
{/snippet}

{#if mounted}
  {#if !isOpen}
    <button
      class="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-blue-700 text-white shadow-lg transition hover:bg-blue-800"
      type="button"
      title="Ouvrir l'assistant radar"
      aria-label="Ouvrir l'assistant radar"
      data-tour="chat"
      on:click={toggleOpen}
    >
      <MessageCircle class="h-5 w-5" aria-hidden="true" />
    </button>
  {:else if isDocked}
    <aside
      class="fixed right-0 top-0 z-40 flex h-screen flex-col border-l border-slate-200 bg-white shadow-xl"
      style={`width: ${dockWidthCss};`}
      aria-label="Assistant radar (ancre)"
    >
      <div class="flex items-center justify-end border-b border-slate-200 px-2 py-1">
        {@render header()}
      </div>
      <div class="min-h-0 flex-1">
        <PackageChatWidget
          widgetLabel="Assistant radar"
          chatTabLabel="Chat"
          queueTabLabel="Taches"
          showCommentsTab={false}
          {renderChatPanel}
        />
      </div>
    </aside>
  {:else}
    <div
      class="fixed bottom-5 right-5 z-40 flex h-[min(36rem,80vh)] w-[min(26rem,92vw)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
      aria-label="Assistant radar (flottant)"
    >
      <div class="flex items-center justify-end border-b border-slate-200 px-2 py-1">
        {@render header()}
      </div>
      <div class="min-h-0 flex-1">
        <PackageChatWidget
          widgetLabel="Assistant radar"
          chatTabLabel="Chat"
          queueTabLabel="Taches"
          showCommentsTab={false}
          {renderChatPanel}
        />
      </div>
    </div>
  {/if}
{/if}
