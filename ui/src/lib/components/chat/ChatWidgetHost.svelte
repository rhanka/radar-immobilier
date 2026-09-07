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
  import ChatDock, {
    type ChatDockInstance,
  } from "@sentropic/chat-ui/components/ChatDock.svelte";
  import PackageChatWidget from "@sentropic/chat-ui/components/ChatWidget.svelte";
  import RadarChatPanel from "$lib/components/RadarChatPanel.svelte";
  import {
    persistDisplayMode,
    readDisplayMode,
    type ChatWidgetDisplayMode,
  } from "$lib/chat/chat-widget-layout";
  // §5 R2 (store #564) — pont hôte↔chat : un déclencheur fourni par l'hôte (le
  // bouton carré de la rangée de contrôles carte) MASQUE la bulle ronde locale
  // (`chatBubbleSuppressed`) et pilote l'ouverture/fermeture via le canal de
  // commande à nonce (`chatToggleNonce`), en RÉUTILISANT le `toggle()` existant
  // du dock. Aucune nouvelle instance de widget, 0 modification de chat-ui.
  import {
    chatBubbleSuppressed,
    chatToggleNonce,
  } from "$lib/chat/chat-trigger";

  // Ancré par défaut (ÉV9). `displayMode` reste piloté par l'hôte pour
  // readDisplayMode/persistDisplayMode ; ChatDock le consomme + publie le layout.
  let displayMode: ChatWidgetDisplayMode = "docked";
  const isBrowser = typeof window !== "undefined";
  // Instance ChatDock : close() (bouton header) et toggle() (déclencheur hôte
  // #564) sont appelés impérativement ; open() reste disponible mais inutilisé.
  let dock: ChatDockInstance | undefined;

  onMount(() => {
    displayMode = readDisplayMode();
    // Canal de commande #564 : chaque bump du nonce = une bascule demandée par un
    // déclencheur hôte. On IGNORE la valeur courante rejouée à l'abonnement, puis
    // on réutilise le toggle() existant du dock (aucune ouverture/fermeture
    // parallèle). L'unsub est rendu à onDestroy.
    let primed = false;
    return chatToggleNonce.subscribe(() => {
      if (!primed) {
        primed = true;
        return;
      }
      void dock?.toggle();
    });
  });

  const setDisplayMode = (next: ChatWidgetDisplayMode): void => {
    displayMode = next;
    persistDisplayMode(next);
  };
</script>

{#snippet renderChatPanel()}
  <RadarChatPanel />
{/snippet}

{#snippet renderBubble({ toggle, isOpen }: { toggle: () => void; isOpen: boolean })}
  <!-- §5 R2 (store #564) — la bulle ronde locale n'est rendue que si AUCUN hôte
       ne fournit son propre déclencheur (`!$chatBubbleSuppressed`) : sur la vue
       Signaux, le déclencheur est le bouton carré de la rangée de contrôles carte
       → pas de double trigger. Sur les autres vues, la bulle reste inchangée.
       `!isOpen` : cohérent avec la bulle par défaut de ChatDock (masquée à
       l'ouverture). ChatDock rend TOUJOURS ce snippet (ouvert/fermé). -->
  {#if !isOpen && !$chatBubbleSuppressed}
    <button
      class="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-blue-700 text-white shadow-lg transition hover:bg-blue-800"
      type="button"
      title="Ouvrir l'assistant radar"
      aria-label="Ouvrir l'assistant radar"
      on:click={toggle}
    >
      <MessageCircle class="h-5 w-5" aria-hidden="true" />
    </button>
  {/if}
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
