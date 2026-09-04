<script lang="ts">
  /**
   * ChatWidgetHost — chrome de l'assistant radar. Increment 1 de la refonte chat :
   * le shell bulle/docked/floating **bricolé à la main** est remplacé par le
   * composant `ChatDock` de `@sentropic/chat-ui` (0.33.0), qui possède le chrome
   * générique (bulle, dialog docked/floating, open/close/toggle, scroll-lock
   * mobile, focus-trap, Ctrl+Shift+K) et **publie lui-même** `chatWidgetLayout`.
   *
   * UX reproduite (0 changement visé) : bulle bas-droit (MessageCircle), header
   * bascule ancré/flottant + « Fermer le chat », contenu = `ChatWidget`
   * (RadarChatPanel). `ChatWidget` reste le CONTENU (tabs/panneaux), pas un dock.
   */
  import { onMount } from "svelte";
  import { MessageCircle, X, PanelRight, PanelBottom } from "@lucide/svelte";
  import ChatDock from "@sentropic/chat-ui/components/ChatDock.svelte";
  import PackageChatWidget from "@sentropic/chat-ui/components/ChatWidget.svelte";
  import RadarChatPanel from "$lib/components/RadarChatPanel.svelte";
  import {
    persistDisplayMode,
    readDisplayMode,
    type ChatWidgetDisplayMode,
  } from "$lib/chat/chat-widget-layout";

  // Ancré par défaut (ÉV9). `displayMode` reste piloté par l'hôte pour
  // readDisplayMode/persistDisplayMode ; ChatDock le consomme + publie le layout.
  let displayMode: ChatWidgetDisplayMode = "docked";
  const isBrowser = typeof window !== "undefined";
  // Instance ChatDock : seul close() est appelé impérativement (bouton header).
  let dock: { close: () => void } | undefined;

  onMount(() => {
    displayMode = readDisplayMode();
  });

  const setDisplayMode = (next: ChatWidgetDisplayMode): void => {
    displayMode = next;
    persistDisplayMode(next);
  };
</script>

{#snippet renderChatPanel()}
  <RadarChatPanel />
{/snippet}

{#snippet renderBubble({ toggle }: { toggle: () => void; isOpen: boolean })}
  <button
    class="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-blue-700 text-white shadow-lg transition hover:bg-blue-800"
    type="button"
    title="Ouvrir l'assistant radar"
    aria-label="Ouvrir l'assistant radar"
    on:click={toggle}
  >
    <MessageCircle class="h-5 w-5" aria-hidden="true" />
  </button>
{/snippet}

{#snippet renderContent({ isDocked }: { isDocked: boolean; isMobileViewport: boolean })}
  <div class="flex h-full min-h-0 flex-col bg-white">
    <div class="flex items-center justify-end border-b border-slate-200 px-2 py-1">
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
          on:click={() => dock?.close()}
        >
          <X class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
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
{/snippet}

<ChatDock
  bind:this={dock}
  {displayMode}
  {isBrowser}
  onDisplayModeChange={setDisplayMode}
  dialogAriaLabel="Assistant radar"
  {renderBubble}
  {renderContent}
/>
