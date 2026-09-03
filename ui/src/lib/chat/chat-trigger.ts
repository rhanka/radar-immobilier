/**
 * Pont Immo entre un déclencheur de chat fourni par l'HÔTE (p.ex. le cluster de
 * contrôles de la carte) et le `ChatWidgetHost` global — SANS modifier chat-ui.
 *
 * Motif « map-contextuel » (réconcilié avec chat-ui) : sur la carte, le chat est
 * une icône carrée dans le cluster de contrôles (pas de bulle flottante qui
 * chevauche la carte) ; hors carte, la bulle globale du `ChatWidgetHost` reste.
 *
 *  - `chatBubbleSuppressed` : dérivé `true` dès qu'AU MOINS un hôte fournit son
 *    propre déclencheur ; le `ChatWidgetHost` MASQUE alors sa bulle flottante.
 *    REF-COMPTÉ (via {@link acquireChatTrigger}) pour rester correct si une
 *    transition de route monte la nouvelle carte AVANT de détruire l'ancienne
 *    (chevauchement mount/unmount) ou si un 2ᵉ consommateur s'ajoute un jour.
 *  - `requestChatToggle()` : commande d'ouverture/fermeture émise par le
 *    déclencheur hôte ; le `ChatWidgetHost` s'y abonne et bascule son `isOpen`
 *    existant (le `ChatWidget` chat-ui ne rend aucun trigger — il est 100 % hôte).
 */
import { writable, derived, type Readable } from "svelte/store";

/** Nombre d'hôtes fournissant actuellement leur propre déclencheur de chat. */
const suppressionCount = writable(0);

/** `true` tant qu'au moins un hôte fournit un déclencheur (⇒ bulle masquée). */
export const chatBubbleSuppressed: Readable<boolean> = derived(
  suppressionCount,
  (n) => n > 0,
);

/**
 * Un hôte prend la main sur le déclencheur de chat (à appeler au mount) : la
 * bulle globale est masquée. Renvoie une fonction de libération IDEMPOTENTE (à
 * appeler au unmount) qui décrémente sans jamais passer sous zéro.
 */
export const acquireChatTrigger = (): (() => void) => {
  suppressionCount.update((n) => n + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    suppressionCount.update((n) => Math.max(0, n - 1));
  };
};

/** Nonce monotone incrémenté à chaque demande de bascule (canal de commande). */
const toggleNonce = writable(0);

/** Abonnement lecture seule : le `ChatWidgetHost` bascule le chat à chaque bump. */
export const chatToggleNonce = { subscribe: toggleNonce.subscribe };

/** Demande une bascule d'ouverture du chat depuis un déclencheur hôte. */
export const requestChatToggle = (): void => toggleNonce.update((n) => n + 1);
