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
  // Feature-flag chat (décision owner 2026-09-07) : DÉFAUT OFF. Quand OFF, ce host
  // ne rend RIEN (ni dock, ni dialog, ni bulle) → le chat est retiré de la vue.
  // ON (VITE_CHAT_ENABLED="true") ré-active tout le chrome Lot 2, à l'identique.
  import { isChatEnabled } from "$lib/chat/chat-feature";
  const chatEnabled = isChatEnabled();

  // Ancré par défaut (ÉV9). `displayMode` reste piloté par l'hôte pour
  // readDisplayMode/persistDisplayMode ; ChatDock le consomme + publie le layout.
  let displayMode: ChatWidgetDisplayMode = "docked";
  const isBrowser = typeof window !== "undefined";

  // ── §5 R2 (fix #579) — COEXISTENCE avec le pane droit sur la vue carte ───────
  // Quand un hôte fournit son propre déclencheur (`$chatBubbleSuppressed` = vue
  // Signaux/carte), on FORCE le mode ANCRÉ (`docked`). Raison : seul le mode ancré
  // réserve sa largeur (App.svelte `padding-right: dockWidthCss`) ⇒ le chat
  // COEXISTE avec le pane droit (§3) au lieu de le RECOUVRIR ; le pane reste
  // visible ET cliquable et le bouton carré de la rangée reste atteignable (donc
  // re-clic = ferme). Le mode FLOTTANT, lui, se superpose (overlay bas-droit +
  // backdrop) et masque le pane ET son propre déclencheur → régression #579.
  // Hors carte (bulle), la préférence utilisateur `displayMode` reste intacte.
  $: effectiveDisplayMode = $chatBubbleSuppressed ? "docked" : displayMode;
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
      data-testid="chat-bubble-trigger"
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
        {#if !$chatBubbleSuppressed}
          <!-- §5 R2 (fix #579) — la bascule ancré/flottant est MASQUÉE sur la vue
               carte : le chat y est FORCÉ en ancré pour coexister avec le pane
               droit (le flottant se superposerait + masquerait le déclencheur).
               Hors carte, la bascule reste disponible (préférence utilisateur). -->
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
        {/if}
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

<!-- GATE (décision owner 2026-09-07) : chat DÉSACTIVÉ par défaut → aucun rendu
     (bouton/bulle/widget absents). Le code Lot 2 ci-dessus est GARDÉ, seulement
     gaté ici ; flag ON ré-active tout. App.svelte monte toujours ce host : quand
     OFF il rend simplement rien (aucune modif d'App.svelte nécessaire). -->
{#if chatEnabled}
  <ChatDock
    bind:this={dock}
    displayMode={effectiveDisplayMode}
    {isBrowser}
    onDisplayModeChange={setDisplayMode}
    dialogAriaLabel="Assistant radar"
    {renderBubble}
    {renderContent}
  />
{/if}
